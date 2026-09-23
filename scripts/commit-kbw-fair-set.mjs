import { existsSync, readFileSync } from 'node:fs'
import { Contract, JsonRpcProvider, Wallet, ethers } from 'ethers'
import { loadContractEnv } from './lib/load-contract-env.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? '' : process.argv[index + 1] || ''
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`)
  return value
}

function bytes32(value, name) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value || '') || /^0x0{64}$/i.test(value)) {
    throw new Error(`${name} must be a nonzero bytes32 hex value`)
  }
  return value
}

const env = loadContractEnv(required(option('--env-file'), '--env-file'))
const expectedChainId = Number(required(env.BSC_CHAIN_ID, 'BSC_CHAIN_ID'))
if (![56, 97].includes(expectedChainId)) throw new Error('Only BSC mainnet and testnet are supported')
const periodId = required(option('--period-id'), '--period-id')
const packId = ethers.keccak256(ethers.toUtf8Bytes(periodId))
const address = ethers.getAddress(required(option('--contract'), '--contract'))
const setId = BigInt(required(option('--set-id'), '--set-id'))
const totalSlots = BigInt(required(option('--total-slots'), '--total-slots'))
if (setId < 1n || totalSlots < 1n) throw new Error('Set ID and total slots must be positive')
const root = bytes32(option('--root'), '--root')
const manifestSha256 = bytes32(option('--manifest-sha256'), '--manifest-sha256')
const artifactPath = new URL('../artifacts/contracts/KbwFairCheckout.sol/KbwFairCheckout.json', import.meta.url)
if (!existsSync(artifactPath)) throw new Error('Compile contracts before preparing commitment')
const abi = JSON.parse(readFileSync(artifactPath, 'utf8')).abi

const provider = new JsonRpcProvider(required(env.BSC_RPC_URL, 'BSC_RPC_URL'))
const network = await provider.getNetwork()
if (network.chainId !== BigInt(expectedChainId)) throw new Error(`RPC chain ${network.chainId} differs from ${expectedChainId}`)
if (await provider.getCode(address) === '0x') throw new Error('Contract has no bytecode at the selected address')
const wallet = new Wallet(required(env.BSC_DEPLOYER_PRIVATE_KEY, 'BSC_DEPLOYER_PRIVATE_KEY'), provider)
const contract = new Contract(address, abi, wallet)
const [chainPackId, owner, priorRoot, checkoutId, gasPrice, balance] = await Promise.all([
  contract.packId(), contract.owner(), contract.merkleRoots(packId, setId),
  contract.nextCheckoutId(), provider.getFeeData(), provider.getBalance(wallet.address),
])
if (chainPackId.toLowerCase() !== packId.toLowerCase()) throw new Error('Contract pack ID differs from period ID')
if (owner.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Signer is not the contract owner')
if (priorRoot !== ethers.ZeroHash) throw new Error('Set was already committed; cannot overwrite it')
if (checkoutId !== 1n) throw new Error('Contract has already had a checkout before this first set commitment')
const gas = await contract.commitSet.estimateGas(setId, root, manifestSha256, totalSlots)
const price = gasPrice.gasPrice ?? gasPrice.maxFeePerGas
if (price === null || price <= 0n) throw new Error('RPC did not provide a usable gas price')
const preview = {
  chainId: expectedChainId, contract: address, periodId, packId, setId: setId.toString(),
  root, manifestSha256, totalSlots: totalSlots.toString(), owner: wallet.address,
  estimatedGas: gas.toString(), estimatedCostBNB: ethers.formatEther(gas * price),
  balanceBNB: ethers.formatEther(balance),
}
if (!process.argv.includes('--broadcast')) {
  console.log(JSON.stringify({ ...preview, broadcast: false, next: 'No transaction sent' }, null, 2))
  process.exit(0)
}
if (option('--confirm-chain-id') !== String(expectedChainId) || option('--confirm-root')?.toLowerCase() !== root.toLowerCase()) {
  throw new Error('Broadcast requires matching --confirm-chain-id and --confirm-root')
}
if (balance < gas * price) throw new Error('Owner balance is below estimated commitment cost')
const tx = await contract.commitSet(setId, root, manifestSha256, totalSlots)
console.log(JSON.stringify({ ...preview, broadcast: true, transactionHash: tx.hash }, null, 2))
const receipt = await tx.wait()
if (!receipt || receipt.status !== 1) throw new Error('Commitment transaction was not confirmed')
const [onChainRoot, committedSet] = await Promise.all([
  contract.merkleRoots(packId, setId), contract.sets(setId),
])
if (onChainRoot.toLowerCase() !== root.toLowerCase() || committedSet[0].toLowerCase() !== manifestSha256.toLowerCase() ||
    committedSet[1] !== totalSlots || committedSet[2] !== 0n) throw new Error('On-chain commitment differs from preview')
console.log(JSON.stringify({ committed: true, transactionHash: tx.hash, blockNumber: receipt.blockNumber }, null, 2))
