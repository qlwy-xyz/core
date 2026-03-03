import hre from "hardhat";
import QLWYSpiritAgent from "../ignition/modules/QLWYSpiritAgent.js";
import QLWYSpiritLogic from "../ignition/modules/QLWYSpiritLogic.js";

// -------------------------
// Contract addresses (BSC Mainnet)
// -------------------------

// QLWY Token address
const qlwyTokenAddress = "0x2e591b13d3caf27adf1db47d75278315d0754444";

// Core contract address (deployed QLWYFortuneCore)
const fortuneCoreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

// Battle contract address (deployed QLWYBattle)
const battleContractAddress = "0x55FC9B38BC070f8Bc3212E64EB39E16971baECbE";

async function main() {

  console.log("=".repeat(60));
  console.log("Deploying Spirit Agent System (BAP-578)");
  console.log("=".repeat(60));
  console.log("");

  // Step 1: Deploy SpiritAgent with a placeholder logic address (address(0))
  // We'll update it after deploying SpiritLogic
  console.log("Step 1: Deploying QLWYSpiritAgent...");
  console.log("-----------------------------------");
  console.log("Configuration:");
  console.log(`  FortuneCore: ${fortuneCoreAddress}`);
  console.log(`  Default Logic: 0x0 (will be updated after SpiritLogic deployment)`);
  console.log("-----------------------------------");

  const connection = await hre.network.connect();
  
  const { spiritAgent } = await connection.ignition.deploy(QLWYSpiritAgent, {
    parameters: {
      QLWYSpiritAgentModule: {
        fortuneCoreAddress,
        defaultLogicAddress: "0x0000000000000000000000000000000000000000",
        qlwyTokenAddress,
      },
    },
  });

  console.log(`✅ QLWYSpiritAgent deployed to: ${spiritAgent.address}`);
  console.log("");

  // Step 2: Deploy SpiritLogic with the SpiritAgent address
  console.log("Step 2: Deploying QLWYSpiritLogic...");
  console.log("-----------------------------------");
  console.log("Configuration:");
  console.log(`  SpiritAgent: ${spiritAgent.address}`);
  console.log(`  Battle Contract: ${battleContractAddress}`);
  console.log(`  QLWY Token: ${qlwyTokenAddress}`);
  console.log("-----------------------------------");

  const { spiritLogic } = await connection.ignition.deploy(QLWYSpiritLogic, {
    parameters: {
      QLWYSpiritLogicModule: {
        spiritAgentAddress: spiritAgent.address,
        battleContractAddress,
        qlwyTokenAddress,
      },
    },
  });

  console.log(`✅ QLWYSpiritLogic deployed to: ${spiritLogic.address}`);
  console.log("");

  // Step 3: Update SpiritAgent's default logic address
  console.log("Step 3: Setting default logic address on SpiritAgent...");
  
  const [signer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();
  
  const hash = await signer.writeContract({
    address: spiritAgent.address as `0x${string}`,
    abi: [{
      inputs: [{ internalType: "address", name: "_logic", type: "address" }],
      name: "setDefaultLogic",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    }],
    functionName: "setDefaultLogic",
    args: [spiritLogic.address as `0x${string}`],
  });
  
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✅ Default logic address set to: ${spiritLogic.address}`);
  console.log("");

  // Summary
  console.log("=".repeat(60));
  console.log("Deployment Complete!");
  console.log("=".repeat(60));
  console.log("");
  console.log("Deployed Contracts:");
  console.log(`  QLWYSpiritAgent: ${spiritAgent.address}`);
  console.log(`  QLWYSpiritLogic: ${spiritLogic.address}`);
  console.log("");
  console.log("Next steps:");
  console.log("1. Update frontend .env with:");
  console.log(`   VITE_SPIRIT_AGENT_ADDRESS=${spiritAgent.address}`);
  console.log("");
  console.log("2. Verify contracts on BscScan:");
  console.log(`   npx hardhat verify --network bsc ${spiritAgent.address} ${fortuneCoreAddress} 0x0000000000000000000000000000000000000000 ${qlwyTokenAddress}`);
  console.log(`   npx hardhat verify --network bsc ${spiritLogic.address} ${spiritAgent.address} ${battleContractAddress} ${qlwyTokenAddress}`);
  console.log("");
  console.log("3. (Optional) Update subgraph to index Spirit events");
}

main().catch(console.error);

