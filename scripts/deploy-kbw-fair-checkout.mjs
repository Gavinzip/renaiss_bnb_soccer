import { existsSync, readFileSync } from 'node:fs'
import { ContractFactory, JsonRpcProvider, Wallet, ethers } from 'ethers'
import { loadContractEnv } from './lib/load-contract-env.mjs'

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? '' : process.argv[index + 1] || ''
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required`)
  return value
}

const envFile = required(option('--env-file'), '--env-file')
const env = loadContractEnv(envFile)
const expectedChainId = Number(required(env.BSC_CHAIN_ID, 'BSC_CHAIN_ID'))
if (![56, 97].includes(expectedChainId)) throw new Error('Only BSC mainnet and testnet are supported')
const periodId = required(option('--period-id'), '--period-id')
const publicKey = required(option('--vrf-public-key'), '--vrf-public-key')
if (!/^0x[0-9a-fA-F]{64}$/.test(publicKey) || /^0x0{64}$/i.test(publicKey)) {
  throw new Error('--vrf-public-key must be a nonzero 32-byte hex value')
}
const artifactPath = new URL('../artifacts/contracts/KbwFairCheckout.sol/KbwFairCheckout.json', import.meta.url)
if (!existsSync(artifactPath)) throw new Error('Compile contracts before preparing deployment')

const provider = new JsonRpcProvider(required(env.BSC_RPC_URL, 'BSC_RPC_URL'))
const network = await provider.getNetwork()
if (network.chainId !== BigInt(expectedChainId)) {
  throw new Error(`RPC chain ${network.chainId} differs from BSC_CHAIN_ID ${expectedChainId}`)
}
const wallet = new Wallet(required(env.BSC_DEPLOYER_PRIVATE_KEY, 'BSC_DEPLOYER_PRIVATE_KEY'), provider)
const operator = ethers.getAddress(required(option('--operator'), '--operator'))
const packId = ethers.keccak256(ethers.toUtf8Bytes(periodId))
const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet)
const transaction = await factory.getDeployTransaction(packId, publicKey, operator)
const [gasEstimate, feeData, balance] = await Promise.all([
  provider.estimateGas({ from: wallet.address, data: transaction.data }),
  provider.getFeeData(),
  provider.getBalance(wallet.address),
])
const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas
if (gasPrice === null || gasPrice <= 0n) throw new Error('RPC did not provide a usable gas price')
const preview = {
  chainId: expectedChainId,
  periodId,
  packId,
  vrfPublicKey: publicKey,
  deployer: wallet.address,
  operator,
  balanceBNB: ethers.formatEther(balance),
  estimatedGas: gasEstimate.toString(),
  estimatedCostBNB: ethers.formatEther(gasEstimate * gasPrice),
  contract: 'KbwFairCheckout',
  existingFootballContracts: 'unchanged',
}

if (!process.argv.includes('--broadcast')) {
  console.log(JSON.stringify({ ...preview, broadcast: false, next: 'No transaction sent' }, null, 2))
  process.exit(0)
}

if (option('--confirm-chain-id') !== String(expectedChainId) || option('--confirm-pack-id') !== packId) {
  throw new Error('Broadcast requires matching --confirm-chain-id and --confirm-pack-id')
}
if (balance < gasEstimate * gasPrice) throw new Error('Deployer balance is below estimated deployment cost')

const contract = await factory.deploy(packId, publicKey, operator)
const deploymentTx = contract.deploymentTransaction()
if (!deploymentTx) throw new Error('No deployment transaction was submitted')
console.log(JSON.stringify({ ...preview, broadcast: true, transactionHash: deploymentTx.hash }, null, 2))
await contract.waitForDeployment()
const address = await contract.getAddress()
const receipt = await provider.getTransactionReceipt(deploymentTx.hash)
if (!receipt || receipt.status !== 1 || await provider.getCode(address) === '0x') {
  throw new Error('Deployment was not confirmed with bytecode on-chain')
}
console.log(JSON.stringify({ deployedAddress: address, transactionHash: deploymentTx.hash, blockNumber: receipt.blockNumber }, null, 2))
