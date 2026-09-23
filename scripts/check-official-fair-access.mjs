import { Contract, JsonRpcProvider, Wallet, ethers } from 'ethers'
import { loadContractEnv } from './lib/load-contract-env.mjs'

const OFFICIAL_TVM_PROXY = '0xd4d18607d6111c5fa2f93a4a5b2c0e28f1563f9f'
const GACHA_OPERATOR_ROLE = '0x4a3b593953eff66cd4ecd3630e0285d003149cf1b147e09c05ca18f716e7baaa'
const DEFAULT_ADMIN_ROLE = `0x${'0'.repeat(64)}`
const IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

function option(name) {
  const index = process.argv.indexOf(name)
  return index < 0 ? '' : process.argv[index + 1] || ''
}

const envFile = option('--env-file') || 'config/draw-contract.env.local'
const env = loadContractEnv(envFile)
if (!env.BSC_RPC_URL || !env.BSC_DEPLOYER_PRIVATE_KEY) {
  throw new Error('BSC_RPC_URL and BSC_DEPLOYER_PRIVATE_KEY are required in the selected env file')
}
const expectedChainId = Number(option('--chain-id') || env.BSC_CHAIN_ID)
if (expectedChainId !== 56) throw new Error('The identified official Fair TVM is on BSC mainnet (chain 56)')
const proxyAddress = ethers.getAddress(option('--contract') || OFFICIAL_TVM_PROXY)
const provider = new JsonRpcProvider(env.BSC_RPC_URL)
const network = await provider.getNetwork()
if (network.chainId !== 56n) throw new Error(`RPC connected to chain ${network.chainId}, not BSC mainnet`)
const wallet = new Wallet(env.BSC_DEPLOYER_PRIVATE_KEY)
const contract = new Contract(proxyAddress, [
  'function hasRole(bytes32,address) view returns (bool)',
  'function getRoleMemberCount(bytes32) view returns (uint256)',
  'function TRUSTED_CALLER_ROLE() view returns (bytes32)',
  'function TRUSTED_CHECKOUT_ORACLE_ROLE() view returns (bytes32)',
  'function merkleRoots(bytes32,uint256) view returns (bytes32)',
], provider)
const block = await provider.getBlockNumber()
const [code, storage, callerRole, checkoutOracleRole, hasOperatorRole, hasAdminRole, operatorCount] = await Promise.all([
  provider.getCode(proxyAddress, block),
  provider.getStorage(proxyAddress, IMPLEMENTATION_SLOT, block),
  contract.TRUSTED_CALLER_ROLE({ blockTag: block }),
  contract.TRUSTED_CHECKOUT_ORACLE_ROLE({ blockTag: block }),
  contract.hasRole(GACHA_OPERATOR_ROLE, wallet.address, { blockTag: block }),
  contract.hasRole(DEFAULT_ADMIN_ROLE, wallet.address, { blockTag: block }),
  contract.getRoleMemberCount(GACHA_OPERATOR_ROLE, { blockTag: block }),
])
const [hasTrustedCallerRole, hasCheckoutOracleRole] = await Promise.all([
  contract.hasRole(callerRole, wallet.address, { blockTag: block }),
  contract.hasRole(checkoutOracleRole, wallet.address, { blockTag: block }),
])
if (code === '0x') throw new Error('Official Fair TVM proxy has no code')
const implementation = ethers.getAddress(`0x${storage.slice(-40)}`)
const report = {
  chainId: 56,
  checkedBlock: block,
  officialTvmProxy: proxyAddress,
  implementation,
  walletAddress: wallet.address,
  gachaOperatorRole: GACHA_OPERATOR_ROLE,
  walletHasGachaOperatorRole: hasOperatorRole,
  walletHasDefaultAdminRole: hasAdminRole,
  walletHasTrustedCallerRole: hasTrustedCallerRole,
  walletHasTrustedCheckoutOracleRole: hasCheckoutOracleRole,
  gachaOperatorMemberCount: Number(operatorCount),
  canWriteOfficialRoot: hasOperatorRole,
  passesPermitFundCallerRoleGate: hasTrustedCallerRole,
  transactionSent: false,
}

const packId = option('--pack-id')
const setId = option('--set-id')
if (Boolean(packId) !== Boolean(setId)) throw new Error('Provide both --pack-id and --set-id to inspect a root')
if (packId) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(packId)) throw new Error('--pack-id must be bytes32')
  const set = BigInt(setId)
  if (set < 1n) throw new Error('--set-id must be positive')
  report.packId = packId
  report.setId = set.toString()
  report.currentMerkleRoot = await contract.merkleRoots(packId, set, { blockTag: block })
}

console.log(JSON.stringify(report, null, 2))
