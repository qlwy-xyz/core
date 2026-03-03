import hre from "hardhat";
import QLWYBattle from "../ignition/modules/QLWYBattle.js";

// -------------------------
// Contract addresses (BSC Mainnet)
// -------------------------

// QLWY Token address
const qlwyTokenAddress = "0x2e591b13d3caf27adf1db47d75278315d0754444";

// Core contract address (deployed QLWYFortuneCore)
const fortuneCoreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

// BattleTreasury contract address (deploy this first using deploy-battle-treasury.ts)
const treasuryAddress = "0x75272CA2491323FEDb5AA1A779f2BFb0F54ddB1f";

// -------------------------
// VRF Configuration (Binance Oracle VRF - BSC Mainnet)
// -------------------------
const vrfCoordinatorAddress = "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da";
const vrfKeyHash = "0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4";
const vrfSubscriptionId = 121n;

async function main() {
  if (treasuryAddress === "0x_DEPLOY_BATTLE_TREASURY_FIRST_") {
    console.error("❌ Error: Please deploy BattleTreasury first and update treasuryAddress");
    console.error("   Run: npx hardhat run scripts/deploy-battle-treasury.ts --network bsc");
    process.exit(1);
  }

  console.log("Deploying QLWYBattle contract...");
  console.log("-----------------------------------");
  console.log("Configuration:");
  console.log(`  QLWY Token: ${qlwyTokenAddress}`);
  console.log(`  FortuneCore: ${fortuneCoreAddress}`);
  console.log(`  Treasury: ${treasuryAddress}`);
  console.log(`  VRF Coordinator: ${vrfCoordinatorAddress}`);
  console.log(`  VRF KeyHash: ${vrfKeyHash}`);
  console.log(`  VRF Subscription ID: ${vrfSubscriptionId}`);
  console.log("-----------------------------------");

  const connection = await hre.network.connect();
  const { battle } = await connection.ignition.deploy(QLWYBattle, {
    parameters: {
      QLWYBattleModule: {
        qlwyTokenAddress,
        fortuneCoreAddress,
        treasuryAddress,
        vrfCoordinatorAddress,
        vrfKeyHash,
        vrfSubscriptionId,
      },
    },
  });

  console.log("-----------------------------------");
  console.log(`✅ QLWYBattle deployed to: ${battle.address}`);
  console.log("-----------------------------------");
  console.log("");
  console.log("Next steps:");
  console.log("1. Add Battle contract as VRF consumer in Binance Oracle VRF subscription");
  console.log("2. Update frontend .env with VITE_BATTLE_ADDRESS");
  console.log("3. Update subgraph with Battle contract address");
  console.log("4. Verify contract on BscScan:");
  console.log(`   npx hardhat verify --network bsc ${battle.address} ${qlwyTokenAddress} ${fortuneCoreAddress} ${treasuryAddress} ${vrfCoordinatorAddress} ${vrfKeyHash} ${vrfSubscriptionId}`);
}

main().catch(console.error);

