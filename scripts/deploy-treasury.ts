import hre from "hardhat";
import QLWYTreasury from "../ignition/modules/QLWYTreasury.js";

async function main() {
  console.log("=".repeat(60));
  console.log("Deploying QLWYTreasury");
  console.log("=".repeat(60));

  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  console.log("\nDeployer:", deployer.account.address);

  // Deploy Treasury
  console.log("\nDeploying QLWYTreasury...");
  const { treasury } = await connection.ignition.deploy(QLWYTreasury, {});

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("✅ Deployment Complete!");
  console.log("=".repeat(60));
  console.log("\nTreasury:", treasury.address);

  console.log("\n📋 Post-deployment steps (via BSCScan):");
  console.log("  1. setStaking(stakingAddress)");
  console.log("  2. setRouter(pancakeRouterV2, wbnbAddress)");
  console.log("  3. setQLWYToken(qlwyTokenAddress)");
  console.log("  4. Staking.setTreasury(treasury.address)");
  console.log("  5. Core.setOpsTreasury(treasury.address)");
}

main().catch(console.error);

