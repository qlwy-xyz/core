import hre from "hardhat";

async function main() {
  console.log("Deploying RefineDebug contract...");

  const RefineDebug = await hre.viem.deployContract("RefineDebug");

  console.log(`RefineDebug deployed to: ${RefineDebug.address}`);

  // Now call the debug function
  const refineryAddress = "0x1D3365855A1C33A5973bf36E583706904bEd073e";
  const userAddress = "0xfE4EA61657b3BE3254ce5B35D9BA1f078d9A6174";
  const tokenIds = [2234n, 2138n, 2013n];

  console.log("\nCalling debug function...");
  console.log(`Refinery: ${refineryAddress}`);
  console.log(`User: ${userAddress}`);
  console.log(`Token IDs: ${tokenIds.join(", ")}`);

  try {
    const result = await RefineDebug.read.debug([
      refineryAddress,
      userAddress,
      tokenIds,
    ]);

    console.log("\n=== Debug Results ===");
    console.log(`Step 1 - Not Paused: ${result.step1_paused}`);
    console.log(`Step 2 - NFT Ownership: ${result.step2_nftOwnership}`);
    console.log(`Step 3 - NFT Rarity Valid: ${result.step3_nftRarity}`);
    console.log(`Step 4 - NFT Approval: ${result.step4_nftApproval}`);
    console.log(`Step 5 - QLWY Balance: ${result.step5_qlwyBalance}`);
    console.log(`Step 6 - QLWY Allowance: ${result.step6_qlwyAllowance}`);
    console.log(`Step 7 - VRF Consumer: ${result.step7_vrfConsumer}`);
    console.log(`\nBase Rarity: ${result.baseRarity}`);
    console.log(`Required Fee: ${result.requiredFee} wei`);
    console.log(`User QLWY Balance: ${result.userQlwyBalance} wei`);
    console.log(`User QLWY Allowance: ${result.userQlwyAllowance} wei`);
    console.log(`\nFail Reason: ${result.failReason}`);
  } catch (error) {
    console.error("Error calling debug:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

