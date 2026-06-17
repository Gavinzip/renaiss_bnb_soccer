import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Wallet } from 'ethers'

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

const envFilePath = argValue('--out') || 'config/draw-contract.env.local'
const envPath = new URL(`../${envFilePath}`, import.meta.url)
const force = process.argv.includes('--force')

function readEnvValue(source, key) {
  const line = source
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith(`${key}=`))
  return line ? line.slice(line.indexOf('=') + 1).trim() : ''
}

if (existsSync(envPath) && !force) {
  const existing = readFileSync(envPath, 'utf8')
  const privateKey = readEnvValue(existing, 'BSC_DEPLOYER_PRIVATE_KEY')
  if (!privateKey) {
    throw new Error(`${envFilePath} exists but BSC_DEPLOYER_PRIVATE_KEY is missing.`)
  }

  const wallet = new Wallet(privateKey)
  console.log(
    JSON.stringify(
      {
        ok: true,
        reused: true,
        address: wallet.address,
        envFile: envFilePath,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

const wallet = Wallet.createRandom()

mkdirSync(dirname(fileURLToPath(envPath)), { recursive: true })
writeFileSync(
  envPath,
  [
    '# Local deploy secret. Do not commit or paste this file into chat.',
    'BSC_RPC_URL=https://bsc-dataseed.binance.org',
    'BSC_CHAIN_ID=56',
    `BSC_DEPLOYER_PRIVATE_KEY=${wallet.privateKey}`,
    '',
    '# Binance Oracle VRF on BNB Smart Chain mainnet.',
    'VRF_COORDINATOR=0x9632ADE542f12114f5E5AD4d6F8e47fB993955da',
    'VRF_KEY_HASH=0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4',
    'VRF_REQUEST_CONFIRMATIONS=3',
    'VRF_CALLBACK_GAS_LIMIT=200000',
    'VRF_NATIVE_FUND_BNB=0.001',
    '',
    'INITIAL_PRIZE_SLOT_COUNT=20',
    '',
    'LUCKY_DRAW_LEDGER_PATH=public/lucky-draw-ledger.json',
    'DRAW_BATCH_SIZE=1',
    '',
  ].join('\n'),
)

console.log(
  JSON.stringify(
      {
        ok: true,
        reused: false,
        address: wallet.address,
        envFile: envFilePath,
      },
      null,
      2,
  ),
)
