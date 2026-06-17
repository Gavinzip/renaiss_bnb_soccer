import { existsSync, readFileSync } from 'node:fs'
import { Contract, ContractFactory, JsonRpcProvider, Wallet, ethers } from 'ethers'

const ARTIFACT_FILE = new URL('../artifacts/contracts/RenaissLuckyDraw.sol/RenaissLuckyDraw.json', import.meta.url)

const COORDINATOR_ABI = [
  'function createSubscription() external returns (uint64 subId)',
  'function deposit(uint64 subId) external payable',
  'function addConsumer(uint64 subId, address consumer) external',
  'function getSubscription(uint64 subId) view returns (uint96 balance, uint64 reqCount, address owner, address[] memory consumers)',
  'event SubscriptionCreated(uint64 indexed subId, address owner)',
]

const BINANCE_ORACLE_VRF = {
  56: {
    coordinator: '0x9632ADE542f12114f5E5AD4d6F8e47fB993955da',
    keyHash: '0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4',
  },
  97: {
    coordinator: '0xa2d23627bC0314f4Cbd08Ff54EcB89bb45685053',
    keyHash: '0x617abc3f53ae11766071d04ada1c7b0fbd49833b9542e9e91da4d3191c70cc80',
  },
}

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : ''
}

const envFilePath = argValue('--env-file') || process.env.DEPLOY_ENV_FILE || 'config/draw-contract.env.local'
const ENV_FILE = new URL(`../${envFilePath}`, import.meta.url)

function loadEnvFile() {
  if (!existsSync(ENV_FILE)) return {}
  return Object.fromEntries(
    readFileSync(ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      }),
  )
}

const fileEnv = loadEnvFile()
const env = { ...fileEnv, ...process.env }
const broadcast = process.argv.includes('--broadcast')

function required(key) {
  const value = env[key]
  if (!value) throw new Error(`${key} is required. Run npm run wallet:create first.`)
  return value
}

function optionalInt(key, fallback) {
  const value = env[key]
  return value ? Number(value) : fallback
}

function optionalAddress(key, fallback) {
  const value = env[key] || fallback
  if (!value) return ''
  if (!ethers.isAddress(value)) throw new Error(`${key} must be a valid EVM address.`)
  return ethers.getAddress(value)
}

function optionalAddressList(key) {
  const value = env[key]
  if (!value) return []
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => {
      if (!ethers.isAddress(item)) throw new Error(`${key}[${index}] must be a valid EVM address.`)
      return ethers.getAddress(item)
    })
}

function parseSubscriptionId(receipt, coordinator) {
  for (const log of receipt.logs) {
    try {
      const parsed = coordinator.interface.parseLog(log)
      if (parsed?.name === 'SubscriptionCreated') return parsed.args.subId
    } catch {
      // Ignore logs from other contracts in the same receipt.
    }
  }
  return 0n
}

const rpcUrl = required('BSC_RPC_URL')
const privateKey = required('BSC_DEPLOYER_PRIVATE_KEY')
const expectedChainId = BigInt(optionalInt('BSC_CHAIN_ID', 56))
const provider = new JsonRpcProvider(rpcUrl, Number(expectedChainId))
const wallet = new Wallet(privateKey, provider)

const network = await provider.getNetwork()
if (network.chainId !== expectedChainId) {
  throw new Error(`RPC chainId ${network.chainId} does not match expected ${expectedChainId}.`)
}

const binanceVrfDefaults = BINANCE_ORACLE_VRF[Number(expectedChainId)]
if (!binanceVrfDefaults) {
  throw new Error(`No Binance Oracle VRF defaults configured for chain ${expectedChainId}.`)
}

const balance = await provider.getBalance(wallet.address)
const coordinatorAddress = env.VRF_COORDINATOR || binanceVrfDefaults.coordinator
const keyHash = env.VRF_KEY_HASH || binanceVrfDefaults.keyHash
if (!ethers.isAddress(coordinatorAddress)) {
  throw new Error('VRF_COORDINATOR must be a valid EVM address.')
}
if (ethers.getAddress(coordinatorAddress) !== ethers.getAddress(binanceVrfDefaults.coordinator)) {
  throw new Error(`VRF_COORDINATOR must be Binance Oracle VRF coordinator ${binanceVrfDefaults.coordinator}.`)
}
if (keyHash.toLowerCase() !== binanceVrfDefaults.keyHash.toLowerCase()) {
  throw new Error(`VRF_KEY_HASH must be Binance Oracle VRF keyHash ${binanceVrfDefaults.keyHash}.`)
}
const requestConfirmations = optionalInt('VRF_REQUEST_CONFIRMATIONS', 3)
const callbackGasLimit = optionalInt('VRF_CALLBACK_GAS_LIMIT', 200000)
const initialPrizeSlotCount = optionalInt('INITIAL_PRIZE_SLOT_COUNT', 20)
const configuredSubscriptionId = env.VRF_SUBSCRIPTION_ID ? BigInt(env.VRF_SUBSCRIPTION_ID) : 0n
const targetDrawOperator = optionalAddress('DRAW_OPERATOR_ADDRESS', wallet.address)
const targetOwner = optionalAddress('DRAW_OWNER_ADDRESS', wallet.address)
const targetAdminAddresses = optionalAddressList('DRAW_ADMIN_ADDRESSES')

const safeConfig = {
  envFile: envFilePath,
  deployer: wallet.address,
  network: network.name || `chain-${network.chainId}`,
  chainId: network.chainId.toString(),
  balanceBNB: ethers.formatEther(balance),
  vrfCoordinator: coordinatorAddress,
  keyHash,
  vrfProvider: 'Binance Oracle VRF',
  configuredSubscriptionId: configuredSubscriptionId.toString(),
  requestConfirmations,
  callbackGasLimit,
  initialPrizeSlotCount,
  targetDrawOperator,
  targetOwner,
  targetAdminAddresses,
}

if (!broadcast) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        broadcast: false,
        message: 'No transaction sent. Fund the deployer and rerun this command with --broadcast to deploy.',
        ...safeConfig,
      },
      null,
      2,
    ),
  )
  process.exit(0)
}

if (balance === 0n) {
  throw new Error(`Deployment wallet has 0 BNB: ${wallet.address}`)
}

const coordinator = new Contract(coordinatorAddress, COORDINATOR_ABI, wallet)
let subscriptionId = configuredSubscriptionId
const txs = []

if (subscriptionId === 0n) {
  const createTx = await coordinator.createSubscription()
  txs.push({ step: 'createSubscription', hash: createTx.hash })
  const createReceipt = await createTx.wait()
  subscriptionId = parseSubscriptionId(createReceipt, coordinator)
  if (subscriptionId === 0n) throw new Error('Could not read SubscriptionCreated event from VRF coordinator.')

  const fundAmount = ethers.parseEther(env.VRF_NATIVE_FUND_BNB || '0.001')
  if (fundAmount > 0n) {
    const fundTx = await coordinator.deposit(subscriptionId, { value: fundAmount })
    txs.push({ step: 'depositSubscription', hash: fundTx.hash, amountBNB: ethers.formatEther(fundAmount) })
    await fundTx.wait()
  }
}

const artifact = JSON.parse(readFileSync(ARTIFACT_FILE, 'utf8'))
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet)
const raffle = await factory.deploy(
  coordinatorAddress,
  keyHash,
  subscriptionId,
  requestConfirmations,
  callbackGasLimit,
  initialPrizeSlotCount,
)
txs.push({ step: 'deployRenaissLuckyDraw', hash: raffle.deploymentTransaction()?.hash || '' })
await raffle.waitForDeployment()
const raffleAddress = await raffle.getAddress()

const addConsumerTx = await coordinator.addConsumer(subscriptionId, raffleAddress)
txs.push({ step: 'addConsumer', hash: addConsumerTx.hash })
await addConsumerTx.wait()

if (targetDrawOperator && targetDrawOperator.toLowerCase() !== wallet.address.toLowerCase()) {
  const operatorTx = await raffle.setDrawOperator(targetDrawOperator)
  txs.push({ step: 'setDrawOperator', operator: targetDrawOperator, hash: operatorTx.hash })
  await operatorTx.wait()
}

for (const adminAddress of targetAdminAddresses) {
  const adminTx = await raffle.setAdmin(adminAddress, true)
  txs.push({ step: 'setAdmin', admin: adminAddress, allowed: true, hash: adminTx.hash })
  await adminTx.wait()
}

let ownerTransferPending = false
if (targetOwner && targetOwner.toLowerCase() !== wallet.address.toLowerCase()) {
  const ownerTx = await raffle.transferOwnership(targetOwner)
  txs.push({ step: 'transferOwnership', pendingOwner: targetOwner, hash: ownerTx.hash })
  await ownerTx.wait()
  ownerTransferPending = true
}

console.log(
  JSON.stringify(
    {
      ok: true,
      broadcast: true,
      deployer: wallet.address,
      owner: ownerTransferPending ? wallet.address : targetOwner || wallet.address,
      pendingOwner: ownerTransferPending ? targetOwner : null,
      drawOperator: targetDrawOperator || wallet.address,
      drawAdmins: targetAdminAddresses,
      subscriptionId: subscriptionId.toString(),
      raffle: raffleAddress,
      frontendContractAddress: raffleAddress,
      frontendNote: 'Set VITE_DRAW_CONTRACT or DRAW_CONTRACT_ADDRESS to this deployment when it becomes the active draw contract.',
      txs,
    },
    null,
    2,
  ),
)
