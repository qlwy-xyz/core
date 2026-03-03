import hre from "hardhat";
import BattleTreasury from "../ignition/modules/BattleTreasury.js";

// -------------------------
// Contract addresses (BSC Mainnet)
// -------------------------

// QLWY Token address
const qlwyTokenAddress = "0x2e591b13d3caf27adf1db47d75278315d0754444";

// Core contract address (deployed QLWYFortuneCore)
const fortuneCoreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

async function main() {
  console.log("Deploying BattleTreasury contract...");
  console.log("-----------------------------------");
  console.log("Configuration:");
  console.log(`  QLWY Token: ${qlwyTokenAddress}`);
  console.log(`  FortuneCore: ${fortuneCoreAddress}`);
  console.log("-----------------------------------");

  const connection = await hre.network.connect();
  const { battleTreasury } = await connection.ignition.deploy(BattleTreasury, {
    parameters: {
      BattleTreasuryModule: {
        qlwyTokenAddress,
        fortuneCoreAddress,
      },
    },
  });

  console.log("-----------------------------------");
  console.log(`✅ BattleTreasury deployed to: ${battleTreasury.address}`);
  console.log("-----------------------------------");
  console.log("");
  console.log("Next steps:");
  console.log("1. Deploy QLWYBattle contract with this treasury address");
  console.log("2. Verify contract on BscScan:");
  
  // Get deployer address for owner parameter
  const [deployer] = await connection.viem.getWalletClients();
  const ownerAddress = deployer.account.address;
  
  console.log(`   npx hardhat verify --network bsc ${battleTreasury.address} ${ownerAddress} ${qlwyTokenAddress} ${fortuneCoreAddress}`);
}

main().catch(console.error);

