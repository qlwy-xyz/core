import hre from "hardhat";
import QLWYStaking from "../ignition/modules/QLWYStaking.js";
import { zeroAddress } from "viem";

// -------------------------
// Contract addresses (update these before deployment)
// -------------------------

// QLWY Token address
const qlwyTokenAddress = "0x2e591b13d3caf27adf1db47d75278315d0754444";

// Treasury contract address (can be set later with setTreasury)
const treasuryAddress = "0xf5789841c27CBE848E158ea79DDBb75Aa02614A2"; // Will be set after Treasury deployment

async function main() {
  console.log("=".repeat(60));
  console.log("Deploying QLWYStaking");
  console.log("=".repeat(60));
  console.log("\nConfiguration:");
  console.log("  QLWY Token:", qlwyTokenAddress);
  console.log("  Treasury:", treasuryAddress);

  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  console.log("\nDeployer:", deployer.account.address);

  // Deploy Staking
  console.log("\n[1/1] Deploying QLWYStaking...");
  const { staking } = await connection.ignition.deploy(QLWYStaking, {
    parameters: {
      QLWYStakingModule: {
        qlwyTokenAddress,
        treasuryAddress,
      },
    },
  });
  console.log("  ✅ Staking deployed to:", staking.address);

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("✅ Deployment Complete!");
  console.log("=".repeat(60));
  console.log("\nDeployed Contract:");
  console.log("  Staking:", staking.address);

  console.log("\n📋 Post-deployment steps:");
  console.log("  1. Deploy Treasury with deploy-treasury.ts");
  console.log("  2. Call Staking.setTreasury(treasury.address)");
  console.log("  3. Verify contract on BSCScan");
}

main().catch(console.error);

