import hre from "hardhat";
import QLWYBattleV2 from "../ignition/modules/QLWYBattleV2.js";

// -------------------------
// Contract addresses (BSC Mainnet)
// -------------------------

// QLWY Token address
const qlwyTokenAddress = "0x2e591b13d3caf27adf1db47d75278315d0754444";

// Core contract address (deployed QLWYFortuneCore)
const fortuneCoreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

// BattleTreasury contract address (same as Battle V1)
const treasuryAddress = "0x75272CA2491323FEDb5AA1A779f2BFb0F54ddB1f";

// -------------------------
// VRF Configuration (Binance Oracle VRF - BSC Mainnet)
// -------------------------
const vrfCoordinatorAddress = "0x9632ADE542f12114f5E5AD4d6F8e47fB993955da";
const vrfKeyHash = "0xcd65a78499993598be303c914c3e37b0103ead6b1f279d1dbfa0ef080e7141a4";
const vrfSubscriptionId = 121n;

async function main() {
  console.log("=".repeat(60));
  console.log("Deploying QLWYBattleV2 Contract (Slot-based Battle System)");
  console.log("=".repeat(60));
  console.log("");
  console.log("Configuration:");
  console.log(`  QLWY Token: ${qlwyTokenAddress}`);
  console.log(`  FortuneCore: ${fortuneCoreAddress}`);
  console.log(`  Treasury: ${treasuryAddress}`);
  console.log(`  VRF Coordinator: ${vrfCoordinatorAddress}`);
  console.log(`  VRF KeyHash: ${vrfKeyHash}`);
  console.log(`  VRF Subscription ID: ${vrfSubscriptionId}`);
  console.log("-----------------------------------");

  const connection = await hre.network.connect();
  const { battleV2 } = await connection.ignition.deploy(QLWYBattleV2, {
    parameters: {
      QLWYBattleV2Module: {
        qlwyTokenAddress,
        fortuneCoreAddress,
        treasuryAddress,
        vrfCoordinatorAddress,
        vrfKeyHash,
        vrfSubscriptionId,
      },
    },
  });

  console.log("");
  console.log("=".repeat(60));
  console.log("Deployment Complete!");
  console.log("=".repeat(60));
  console.log("");
  console.log(`✅ QLWYBattleV2 deployed to: ${battleV2.address}`);
  console.log("");
  console.log("Next steps:");
  console.log("");
  console.log("1. Add BattleV2 contract as VRF consumer in Binance Oracle VRF subscription:");
  console.log(`   Subscription ID: ${vrfSubscriptionId}`);
  console.log(`   Consumer Address: ${battleV2.address}`);
  console.log("");
  console.log("2. Update frontend .env:");
  console.log(`   VITE_BATTLE_V2_ADDRESS=${battleV2.address}`);
  console.log("");
  console.log("3. Update subgraph (../subgraph/subgraph.yaml):");
  console.log(`   QLWYBattleV2 address: ${battleV2.address}`);
  console.log("");
  console.log("4. Verify contract on BscScan:");
  console.log(`   npx hardhat verify --network bsc ${battleV2.address} \\`);
  console.log(`     ${qlwyTokenAddress} \\`);
  console.log(`     ${fortuneCoreAddress} \\`);
  console.log(`     ${treasuryAddress} \\`);
  console.log(`     ${vrfCoordinatorAddress} \\`);
  console.log(`     ${vrfKeyHash} \\`);
  console.log(`     ${vrfSubscriptionId}`);
  console.log("");
  console.log("5. (Optional) If using SpiritAgent, update SpiritLogic to use BattleV2:");
  console.log("   - Deploy new SpiritLogic with BattleV2 address");
  console.log("   - Or update existing SpiritLogic.setBattleContract()");
}

main().catch(console.error);

