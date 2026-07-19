import { existsSync, readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { ethers } from 'ethers'

const DEFAULT_ENV_FILES = [
  '.env.local',
  'config/lucky-draw.env.local',
  'config/draw-contract.env.local',
]

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function loadEnvFile(pathname) {
  if (!existsSync(pathname)) return {}
  return Object.fromEntries(
    readFileSync(pathname, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

function readEnv() {
  const envFile = argValue('--env-file')
  const files = envFile
    ? ['.env.local', 'config/lucky-draw.env.local', envFile]
    : DEFAULT_ENV_FILES
  return files.reduce((env, file) => ({ ...env, ...loadEnvFile(file) }), { ...process.env })
}

function required(env, key) {
  const value = String(env[key] || '').trim()
  if (!value) throw new Error(`${key} is required.`)
  return value
}

function requiredAddress(env, key) {
  const value = required(env, key)
  if (!ethers.isAddress(value)) throw new Error(`${key} must be a valid EVM address.`)
  return ethers.getAddress(value)
}

function requiredUint(env, key) {
  const value = required(env, key)
  if (!/^\d+$/.test(value)) throw new Error(`${key} must be an unsigned integer.`)
  return value
}

function requiredBytes32(env, key) {
  const value = required(env, key)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${key} must be bytes32 hex.`)
  return value
}

const env = readEnv()
const chainId = Number(requiredUint(env, 'BSC_CHAIN_ID'))
const network = argValue('--network') || (chainId === 97 ? 'bscTestnet' : 'bsc')
if (!['bsc', 'bscTestnet'].includes(network)) {
  throw new Error('--network must be bsc or bscTestnet.')
}
if ((network === 'bsc' && chainId !== 56) || (network === 'bscTestnet' && chainId !== 97)) {
  throw new Error(`BSC_CHAIN_ID ${chainId} does not match Hardhat network ${network}.`)
}

const overrideContract = argValue('--contract')
const contractAddress = overrideContract
  ? ethers.getAddress(overrideContract)
  : requiredAddress(env, 'DRAW_CONTRACT_ADDRESS')
const constructorArgs = [
  requiredAddress(env, 'VRF_COORDINATOR'),
  requiredBytes32(env, 'VRF_KEY_HASH'),
  requiredUint(env, 'VRF_SUBSCRIPTION_ID'),
  requiredUint(env, 'VRF_REQUEST_CONFIRMATIONS'),
  requiredUint(env, 'VRF_CALLBACK_GAS_LIMIT'),
  requiredUint(env, 'INITIAL_PRIZE_SLOT_COUNT'),
]

required(env, 'BSC_RPC_URL')
required(env, 'BSCSCAN_API_KEY')

const hardhatArgs = [
  'hardhat',
  'verify',
  'etherscan',
  '--network',
  network,
  '--contract',
  'contracts/RenaissLuckyDraw.sol:RenaissLuckyDraw',
  contractAddress,
  ...constructorArgs,
]

const safePreview = {
  submit: hasFlag('--submit'),
  network,
  chainId,
  contract: contractAddress,
  contractSource: 'contracts/RenaissLuckyDraw.sol:RenaissLuckyDraw',
  constructorArgs,
  command: `npx ${hardhatArgs.map((item) => JSON.stringify(item)).join(' ')}`,
  notes: [
    'Dry-run only unless --submit is present.',
    'Verification sends source metadata to BscScan and does not send an on-chain transaction.',
    'No private key is required.',
  ],
}

if (!hasFlag('--submit')) {
  console.log(JSON.stringify(safePreview, null, 2))
  process.exit(0)
}

console.log(JSON.stringify({ ...safePreview, command: 'npx hardhat verify ...' }, null, 2))

const child = spawn('npx', hardhatArgs, {
  stdio: 'inherit',
  env,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
