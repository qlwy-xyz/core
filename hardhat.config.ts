import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";
import hardhatVerify from "@nomicfoundation/hardhat-verify";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable } from "hardhat/config";
const config: HardhatUserConfig = {
  plugins: [hardhatToolboxViemPlugin, hardhatVerify],
  chainDescriptors: {
    56: {
      name: "Binance Smart Chain",
      blockExplorers: {
        etherscan: {
          name: "BscScan",
          url: "https://bscscan.com",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
    97: {
      name: "Binance Smart Chain Testnet",
      blockExplorers: {
        etherscan: {
          name: "BscScan",
          url: "https://testnet.bscscan.com",
          apiUrl: "https://api-testnet.bscscan.com/v2/api",
        },
      },
    },
    8453: {
      name: "Base",
      blockExplorers: {
        etherscan: {
          name: "BaseScan",
          url: "https://basescan.org",
          apiUrl: "https://api.etherscan.io/v2/api",
        },
      },
    },
    84532: {
      name: "Base Sepolia",
      blockExplorers: {
        etherscan: {
          name: "BaseScan",
          url: "https://sepolia.basescan.org",
          apiUrl: "https://api-sepolia.basescan.org/v2/api",
        },
      },
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("BSC_ETHERSCAN_API_KEY"),
    },
    blockscout: {
      enabled: false,
    },
  },
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: true,
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1,
          },
          viaIR: true,
        },
      },
    },
  },

  networks: {
    default: {
      type: "edr-simulated",
      allowUnlimitedContractSize: true,
    },
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
      allowUnlimitedContractSize: true,
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
      allowUnlimitedContractSize: true,
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    baseSepolia: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_RPC_URL"),
      chainId: 84532,
      accounts: [configVariable("BASE_PRIVATE_KEY")],
    },
    base: {
      type: "http",
      chainType: "op",
      url: configVariable("BASE_RPC_URL"),
      chainId: 8453,
      accounts: [configVariable("BASE_PRIVATE_KEY")],
    },
    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://localhost:8545",
    },
    bscTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("BSC_RPC_URL"),
      chainId: 97,
      accounts: [configVariable("BSC_PRIVATE_KEY")],
    },
    bsc: {
      type: "http",
      chainType: "l1",
      url: configVariable("BSC_RPC_URL"),
      chainId: 56,
      accounts: [configVariable("BSC_PRIVATE_KEY")],
    },
  },
};

export default config;
