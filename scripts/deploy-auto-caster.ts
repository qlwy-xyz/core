import hre from "hardhat";
import QLWYAutoCaster from "../ignition/modules/QLWYAutoCaster.js";

// -------------------------
// Contract addresses (BSC Mainnet)
// -------------------------

// FortuneCore contract address
const fortuneCoreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

// SpiritLogic contract address (to authorize as caller)
const spiritLogicAddress = "0xa5cE63D570B7566aC1020c8A95d06fc66419b0e2";

async function main() {
  console.log("=".repeat(60));
  console.log("Deploying QLWYAutoCaster");
  console.log("=".repeat(60));
  console.log("");

  // Step 1: Deploy AutoCaster
  console.log("Step 1: Deploying QLWYAutoCaster...");
  console.log("-----------------------------------");
  console.log("Configuration:");
  console.log(`  FortuneCore: ${fortuneCoreAddress}`);
  console.log("-----------------------------------");

  const connection = await hre.network.connect();

  const { autoCaster } = await connection.ignition.deploy(QLWYAutoCaster, {
    parameters: {
      QLWYAutoCasterModule: {
        fortuneCoreAddress,
      },
    },
  });

  console.log(`✅ QLWYAutoCaster deployed to: ${autoCaster.address}`);
  console.log("");

  const [signer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();

  // Step 2: Authorize SpiritLogic as caller on AutoCaster
  console.log("Step 2: Authorizing SpiritLogic as caller on AutoCaster...");
  console.log(`  SpiritLogic: ${spiritLogicAddress}`);

  const hash1 = await signer.writeContract({
    address: autoCaster.address as `0x${string}`,
    abi: [{
      inputs: [
        { internalType: "address", name: "caller", type: "address" },
        { internalType: "bool", name: "authorized", type: "bool" },
      ],
      name: "setAuthorizedCaller",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    }],
    functionName: "setAuthorizedCaller",
    args: [spiritLogicAddress as `0x${string}`, true],
  });

  const receipt1 = await publicClient.waitForTransactionReceipt({ hash: hash1 });
  console.log(`✅ SpiritLogic authorized (block ${receipt1.blockNumber})`);
  console.log("");

  // Step 3: Set AutoCaster address on SpiritLogic
  console.log("Step 3: Setting AutoCaster address on SpiritLogic...");

  const hash2 = await signer.writeContract({
    address: spiritLogicAddress as `0x${string}`,
    abi: [{
      inputs: [{ internalType: "address", name: "_autoCaster", type: "address" }],
      name: "setAutoCaster",
      outputs: [],
      stateMutability: "nonpayable",
      type: "function",
    }],
    functionName: "setAutoCaster",
    args: [autoCaster.address as `0x${string}`],
  });

  const receipt2 = await publicClient.waitForTransactionReceipt({ hash: hash2 });
  console.log(`✅ AutoCaster set on SpiritLogic (block ${receipt2.blockNumber})`);
  console.log("");

  // Summary
  console.log("=".repeat(60));
  console.log("Deployment Complete!");
  console.log("=".repeat(60));
  console.log("");
  console.log("Deployed Contracts:");
  console.log(`  QLWYAutoCaster: ${autoCaster.address}`);
  console.log("");
  console.log("Configuration:");
  console.log(`  FortuneCore:  ${fortuneCoreAddress}`);
  console.log(`  SpiritLogic:  ${spiritLogicAddress} (authorized caller)`);
  console.log("");
  console.log("Verify contract on BscScan:");
  console.log(`  npx hardhat verify --network bsc ${autoCaster.address} ${fortuneCoreAddress}`);
}

main().catch(console.error);

