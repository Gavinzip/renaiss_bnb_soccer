#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { Contract, JsonRpcProvider, Wallet, ethers } from 'ethers'

const ARTIFACT_FILE = new URL('../artifacts/contracts/RenaissLuckyDraw.sol/RenaissLuckyDraw.json', import.meta.url)

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function loadEnvFile(envFilePath) {
  const envFile = new URL(`../${envFilePath}`, import.meta.url)
  if (!existsSync(envFile)) return {}
  return Object.fromEntries(
    readFileSync(envFile, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

function required(env, key) {
  const value = env[key]
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function addressValue(value, label) {
  if (!ethers.isAddress(value)) throw new Error(`${label} must be a valid EVM address.`)
  return ethers.getAddress(value)
}

function addressListValue(value, label) {
  if (!value) return []
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => addressValue(item, `${label}[${index}]`))
}

async function readAdminState(contract, address) {
  try {
    return Boolean(await contract.isAdmin(address))
  } catch {
    return null
  }
}

const envFilePath = argValue('--env-file') || process.env.DEPLOY_ENV_FILE || 'config/draw-contract.env.local'
const env = { ...loadEnvFile(envFilePath), ...process.env }
const broadcast = process.argv.includes('--broadcast')
const acceptOwnership = process.argv.includes('--accept-ownership')

const contractAddress = addressValue(
  argValue('--contract') || env.DRAW_CONTRACT_ADDRESS || env.VITE_DRAW_CONTRACT,
  'contract',
)
const requestedTargetOperator = argValue('--operator') || env.DRAW_OPERATOR_ADDRESS || ''
const requestedTargetOwner = argValue('--owner') || env.DRAW_OWNER_ADDRESS || ''
const targetAdminAdds = addressListValue(argValue('--admin') || env.DRAW_ADMIN_ADDRESSES, 'admin')
const targetAdminRemoves = addressListValue(argValue('--remove-admin') || env.DRAW_ADMIN_REMOVE_ADDRESSES, 'remove-admin')

const expectedChainId = BigInt(env.BSC_CHAIN_ID || 56)
const provider = new JsonRpcProvider(required(env, 'BSC_RPC_URL'), Number(expectedChainId))
const wallet = new Wallet(required(env, 'BSC_DEPLOYER_PRIVATE_KEY'), provider)
const network = await provider.getNetwork()
if (network.chainId !== expectedChainId) {
  throw new Error(`RPC chainId ${network.chainId} does not match expected ${expectedChainId}.`)
}

const targetOperator = addressValue(requestedTargetOperator || wallet.address, 'operator')
const targetOwner = addressValue(requestedTargetOwner || wallet.address, 'owner')
const artifact = JSON.parse(readFileSync(ARTIFACT_FILE, 'utf8'))
const raffle = new Contract(contractAddress, artifact.abi, wallet)
const currentOwner = ethers.getAddress(await raffle.owner())
const currentOperator = ethers.getAddress(await raffle.drawOperator())
const adminPlans = await Promise.all(
  [
    ...targetAdminAdds.map((admin) => ({ admin, allowed: true })),
    ...targetAdminRemoves.map((admin) => ({ admin, allowed: false })),
  ].map(async (change) => ({
    ...change,
    currentAllowed: await readAdminState(raffle, change.admin),
  })),
)
const txs = []

const planned = {
  ok: true,
  broadcast,
  envFile: envFilePath,
  network: network.name || `chain-${network.chainId}`,
  chainId: network.chainId.toString(),
  contract: contractAddress,
  signer: wallet.address,
  currentOwner,
  currentOperator,
  targetOwner,
  targetOperator,
  adminPlans,
  willSetOperator: currentOperator.toLowerCase() !== targetOperator.toLowerCase(),
  willTransferOwner: currentOwner.toLowerCase() !== targetOwner.toLowerCase(),
  willSetAdmins: adminPlans.some((change) => change.currentAllowed !== change.allowed),
  willAcceptOwnership: acceptOwnership,
}

if (!broadcast) {
  console.log(
    JSON.stringify(
      {
        ...planned,
        message: 'No transaction sent. Rerun with --broadcast to apply role changes.',
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (planned.willSetOperator) {
  if (wallet.address.toLowerCase() !== currentOwner.toLowerCase()) {
    throw new Error(`Only current owner ${currentOwner} can set drawOperator. Signer is ${wallet.address}.`)
  }
  const tx = await raffle.setDrawOperator(targetOperator)
  txs.push({ step: 'setDrawOperator', operator: targetOperator, hash: tx.hash })
  await tx.wait()
}

for (const change of adminPlans) {
  if (change.currentAllowed === change.allowed) continue
  if (change.currentAllowed === null) {
    throw new Error(`Contract ${contractAddress} does not support setAdmin/isAdmin. Deploy the multi-admin contract first.`)
  }
  if (wallet.address.toLowerCase() !== currentOwner.toLowerCase()) {
    throw new Error(`Only current owner ${currentOwner} can set draw admins. Signer is ${wallet.address}.`)
  }
  const tx = await raffle.setAdmin(change.admin, change.allowed)
  txs.push({ step: 'setAdmin', admin: change.admin, allowed: change.allowed, hash: tx.hash })
  await tx.wait()
}

if (planned.willTransferOwner) {
  if (wallet.address.toLowerCase() !== currentOwner.toLowerCase()) {
    throw new Error(`Only current owner ${currentOwner} can transfer ownership. Signer is ${wallet.address}.`)
  }
  const tx = await raffle.transferOwnership(targetOwner)
  txs.push({ step: 'transferOwnership', pendingOwner: targetOwner, hash: tx.hash })
  await tx.wait()
}

if (acceptOwnership) {
  const tx = await raffle.acceptOwnership()
  txs.push({ step: 'acceptOwnership', owner: wallet.address, hash: tx.hash })
  await tx.wait()
}

console.log(
  JSON.stringify(
    {
      ...planned,
      txs,
      finalOwner: ethers.getAddress(await raffle.owner()),
      finalOperator: ethers.getAddress(await raffle.drawOperator()),
      ownerTransferPending: planned.willTransferOwner && !acceptOwnership,
    },
    null,
    2,
  ),
)
