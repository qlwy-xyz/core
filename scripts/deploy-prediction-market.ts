import hre from "hardhat";
import QLWYPredictionMarket from "../ignition/modules/QLWYPredictionMarket.js";
import QLWYPredictionArbitration from "../ignition/modules/QLWYPredictionArbitration.js";

// -------------------------
// Configuration — update before deploying
// -------------------------

// Stablecoin address (USDC / USDT on target network)
const stablecoinAddress = "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d";

// FortuneCore address (for Mythic NFT ownership checks in arbitration)
const fortuneCoreAddress = "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8";

// QLWY Token address (for arbitrator staking)
const qlwyTokenAddress = "0x2e591b13d3caf27adf1db47d75278315d0754444";

// Protocol fee recipient (receives protocolFeeBps from each trade)
// Leave empty string to default to deployer
const protocolFeeRecipientOverride = "";

async function main() {
  // ─── Validate ──────────────────────────────────────────────────────────────

  if (stablecoinAddress.startsWith("0x_")) {
    console.error("❌ Error: Please set stablecoinAddress before deploying");
    process.exit(1);
  }
  if (fortuneCoreAddress.startsWith("0x_")) {
    console.error("❌ Error: Please set fortuneCoreAddress before deploying");
    process.exit(1);
  }

  const connection = await hre.network.connect();
  const [deployer] = await connection.viem.getWalletClients();
  const publicClient = await connection.viem.getPublicClient();
  const deployerAddress = deployer.account.address;
  const protocolFeeRecipient = protocolFeeRecipientOverride || deployerAddress;

  console.log("=".repeat(60));
  console.log("Deploying Prediction Market Contracts");
  console.log("=".repeat(60));
  console.log("");
  console.log("Deployer:", deployerAddress);
  console.log("Network: ", hre.network.name);
  console.log("");
  console.log("Configuration:");
  console.log(`  Stablecoin:            ${stablecoinAddress}`);
  console.log(`  FortuneCore:           ${fortuneCoreAddress}`);
  console.log(`  QLWY Token:            ${qlwyTokenAddress}`);
  console.log(`  Protocol Fee Recipient: ${protocolFeeRecipient}`);
  console.log("");

  // ─── Step 1: Deploy QLWYPredictionMarket ───────────────────────────────────

  console.log("[1/3] Deploying QLWYPredictionMarket...");
  const { predictionMarket } = await connection.ignition.deploy(
    QLWYPredictionMarket,
    {
      parameters: {
        QLWYPredictionMarketModule: {
          stablecoinAddress,
          protocolFeeRecipient,
        },
      },
    }
  );
  console.log(`  ✅ QLWYPredictionMarket: ${predictionMarket.address}`);
  console.log("");

  // ─── Step 2: Deploy QLWYPredictionArbitration ──────────────────────────────

  console.log("[2/3] Deploying QLWYPredictionArbitration...");
  const { predictionArbitration } = await connection.ignition.deploy(
    QLWYPredictionArbitration,
    {
      parameters: {
        QLWYPredictionArbitrationModule: {
          fortuneCoreAddress,
          stablecoinAddress,
          qlwyTokenAddress,
        },
      },
    }
  );
  console.log(`  ✅ QLWYPredictionArbitration: ${predictionArbitration.address}`);
  console.log("");

  // ─── Step 3: Wire contracts together ───────────────────────────────────────

  console.log("[3/3] Wiring contracts...");

  // PredictionMarket.setArbitration(arbitration)
  const market = await connection.viem.getContractAt(
    "QLWYPredictionMarket",
    predictionMarket.address
  );
  const tx1 = await market.write.setArbitration([predictionArbitration.address]);
  await publicClient.waitForTransactionReceipt({ hash: tx1 });
  console.log("  ✅ PredictionMarket.setArbitration → Arbitration");

  // Arbitration.setAuthorizedRequester(market, true)
  const arb = await connection.viem.getContractAt(
    "QLWYPredictionArbitration",
    predictionArbitration.address
  );
  const tx2 = await arb.write.setAuthorizedRequester([
    predictionMarket.address,
    true,
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx2 });
  console.log("  ✅ Arbitration.setAuthorizedRequester → PredictionMarket");
  console.log("");

  // ─── Summary ───────────────────────────────────────────────────────────────

  console.log("=".repeat(60));
  console.log("✅ Deployment Complete!");
  console.log("=".repeat(60));
  console.log("");
  console.log("Deployed Contracts:");
  console.log(`  QLWYPredictionMarket:      ${predictionMarket.address}`);
  console.log(`  QLWYPredictionArbitration:  ${predictionArbitration.address}`);
  console.log("");
  console.log("Frontend .env:");
  console.log(`  NEXT_PUBLIC_PREDICTION_MARKET_ADDRESS=${predictionMarket.address}`);
  console.log(`  NEXT_PUBLIC_PREDICTION_ARBITRATION_ADDRESS=${predictionArbitration.address}`);
  console.log(`  NEXT_PUBLIC_PREDICTION_STABLECOIN_ADDRESS=${stablecoinAddress}`);
  console.log("");
  console.log("API .env:");
  console.log(`  PREDICTION_MARKET_ADDRESS=${predictionMarket.address}`);
  console.log("");
  console.log("Verify contracts:");
  console.log(`  npx hardhat verify --network ${hre.network.name} ${predictionMarket.address} ${deployerAddress} ${stablecoinAddress} ${protocolFeeRecipient}`);
  console.log(`  npx hardhat verify --network ${hre.network.name} ${predictionArbitration.address} ${deployerAddress} ${fortuneCoreAddress} ${stablecoinAddress} ${qlwyTokenAddress}`);
}

main().catch(console.error);

