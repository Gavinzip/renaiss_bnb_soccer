import hardhatToolboxMochaEthersPlugin from '@nomicfoundation/hardhat-toolbox-mocha-ethers'
import { configVariable, defineConfig } from 'hardhat/config'

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: '0.8.24',
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: 'edr-simulated',
      chainType: 'l1',
    },
    bsc: {
      type: 'http',
      chainType: 'l1',
      chainId: 56,
      url: configVariable('BSC_RPC_URL'),
    },
    bscTestnet: {
      type: 'http',
      chainType: 'l1',
      chainId: 97,
      url: configVariable('BSC_RPC_URL'),
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable('BSCSCAN_API_KEY'),
    },
  },
})
