import hre from "hardhat";
import { ethers } from "ethers";
import "dotenv/config";

async function main() {
  const REFINERY_ADDRESS = "0x871c93fad88df59bfad83825a2f784d6bee19da5";
  const TOKEN_IDS = [2234, 2138, 2013];
  const BURN_ASH = 0;

  console.log("Testing refine function...");
  console.log("Refinery address:", REFINERY_ADDRESS);
  console.log("Token IDs:", TOKEN_IDS);

  // Get provider and signer
  const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/";
  const privateKey = process.env.BSC_PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("BSC_PRIVATE_KEY not found in environment variables");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);

  // Get contract
  const RefineryArtifact = await hre.artifacts.readArtifact("QLWYRefinery");
  const refinery = new ethers.Contract(REFINERY_ADDRESS, RefineryArtifact.abi, signer);
  console.log("Signer address:", signer.address);

  // Check some state first
  try {
    const fortuneCore = await refinery.fortuneCore();
    console.log("FortuneCore address:", fortuneCore);

    const vrfCoordinator = await refinery.vrfCoordinator();
    console.log("VRF Coordinator:", vrfCoordinator);

    const paused = await refinery.paused();
    console.log("Paused:", paused);

    // Check NFT ownership and approvals
    const CoreArtifact = await hre.artifacts.readArtifact("QLWYFortuneCore");
    const core = new ethers.Contract(fortuneCore, CoreArtifact.abi, signer);

    console.log("\n=== NFT Checks ===");
    for (const tokenId of TOKEN_IDS) {
      const owner = await core.ownerOf(tokenId);
      const rarity = await core.tokenRarityOf(tokenId);
      console.log(`Token ${tokenId}: owner=${owner}, rarity=${rarity}`);
    }

    // Check if approved for all
    const isApproved = await core.isApprovedForAll(signer.address, REFINERY_ADDRESS);
    console.log("IsApprovedForAll:", isApproved);

    // Check QLWY token
    const qlwyAddress = await refinery.qlwyToken();
    console.log("\n=== QLWY Token ===");
    console.log("QLWY Token address:", qlwyAddress);

    const ERC20Abi = [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address owner, address spender) view returns (uint256)"
    ];
    const qlwy = new ethers.Contract(qlwyAddress, ERC20Abi, signer);
    const balance = await qlwy.balanceOf(signer.address);
    const allowance = await qlwy.allowance(signer.address, REFINERY_ADDRESS);
    console.log("QLWY Balance:", ethers.formatEther(balance));
    console.log("QLWY Allowance:", ethers.formatEther(allowance));

    // Check refine fee
    // Rarity 1 = Rare, fee index 0
    const rarities = await Promise.all(TOKEN_IDS.map(id => core.tokenRarityOf(id)));
    const baseRarity = rarities[0];
    console.log("Base rarity:", baseRarity);

    // Check if Core has setRefinery
    try {
      const refineryInCore = await core.refinery();
      console.log("\n=== Core Contract ===");
      console.log("Refinery in Core:", refineryInCore);
    } catch (e) {
      console.log("Core.refinery() not available or error");
    }

    // Check VRF Coordinator subscription
    console.log("\n=== VRF Coordinator ===");
    const vrfCoordinatorAddr = await refinery.vrfCoordinator();
    const vrfSubId = await refinery.vrfSubId();
    console.log("VRF SubId:", vrfSubId.toString());

    // Try to get subscription info from VRF Coordinator (Binance Oracle VRF interface)
    const VRFCoordinatorAbi = [
      "function getSubscription(uint64 subId) view returns (uint96 balance, uint64 reqCount, address owner, address[] consumers)"
    ];
    const vrfCoord = new ethers.Contract(vrfCoordinatorAddr, VRFCoordinatorAbi, signer);

    try {
      const subInfo = await vrfCoord.getSubscription(vrfSubId);
      console.log("Subscription balance:", ethers.formatEther(subInfo.balance), "BNB");
      console.log("Request count:", subInfo.reqCount.toString());
      console.log("Owner:", subInfo.owner);
      console.log("Consumers:", subInfo.consumers);

      // Check if refinery is in consumers list
      const isConsumer = subInfo.consumers.some(
        (c: string) => c.toLowerCase() === REFINERY_ADDRESS.toLowerCase()
      );
      console.log("Refinery is consumer:", isConsumer);
    } catch (e: any) {
      console.log("Error getting subscription:", e.message);
    }

  } catch (e: any) {
    console.log("Error reading state:", e.message);
  }

  // Test VRF Coordinator interface
  console.log("\n=== Testing VRF Coordinator Interface ===");
  const vrfCoordinatorAddr = await refinery.vrfCoordinator();

  // Check what functions exist on VRF Coordinator
  // Binance Oracle VRF uses: requestRandomWords(bytes32,uint64,uint16,uint32,uint32)
  // Chainlink VRF V2.5 uses: requestRandomWords(tuple)

  const vrfKeyHash = await refinery.vrfKeyHash();
  const vrfSubId = await refinery.vrfSubId();
  const vrfMinConfirmations = await refinery.vrfMinConfirmations();
  const vrfCallbackGasLimit = await refinery.vrfCallbackGasLimit();

  console.log("VRF KeyHash:", vrfKeyHash);
  console.log("VRF SubId:", vrfSubId.toString());
  console.log("VRF MinConfirmations:", vrfMinConfirmations.toString());
  console.log("VRF CallbackGasLimit:", vrfCallbackGasLimit.toString());

  // Try Binance Oracle VRF interface (separate params)
  const BinanceVRFAbi = [
    "function requestRandomWords(bytes32 keyHash, uint64 subId, uint16 requestConfirmations, uint32 callbackGasLimit, uint32 numWords) external returns (uint256 requestId)"
  ];
  const binanceVrf = new ethers.Contract(vrfCoordinatorAddr, BinanceVRFAbi, signer);

  console.log("\nTrying Binance Oracle VRF interface (separate params)...");
  try {
    // Just estimate gas, don't actually send
    const gasEstimate = await binanceVrf.requestRandomWords.estimateGas(
      vrfKeyHash,
      vrfSubId,
      vrfMinConfirmations,
      vrfCallbackGasLimit,
      2 // numWords
    );
    console.log("Binance VRF interface works! Gas estimate:", gasEstimate.toString());
  } catch (e: any) {
    console.log("Binance VRF interface failed:", e.message?.substring(0, 200));
  }

  // Try Chainlink VRF V2.5 interface (struct)
  const ChainlinkVRFAbi = [
    "function requestRandomWords((bytes32 keyHash, uint256 subId, uint16 requestConfirmations, uint32 callbackGasLimit, uint32 numWords, bytes extraArgs) req) external returns (uint256 requestId)"
  ];
  const chainlinkVrf = new ethers.Contract(vrfCoordinatorAddr, ChainlinkVRFAbi, signer);

  console.log("\nTrying Chainlink VRF V2.5 interface (struct)...");
  try {
    const gasEstimate = await chainlinkVrf.requestRandomWords.estimateGas({
      keyHash: vrfKeyHash,
      subId: vrfSubId,
      requestConfirmations: vrfMinConfirmations,
      callbackGasLimit: vrfCallbackGasLimit,
      numWords: 2,
      extraArgs: "0x"
    });
    console.log("Chainlink VRF V2.5 interface works! Gas estimate:", gasEstimate.toString());
  } catch (e: any) {
    console.log("Chainlink VRF V2.5 interface failed:", e.message?.substring(0, 200));
  }

  // Try to call refine
  try {
    console.log("\nCalling refine...");
    const tx = await refinery.refine(TOKEN_IDS, BURN_ASH);
    console.log("Transaction hash:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed:", receipt?.status === 1 ? "SUCCESS" : "FAILED");
  } catch (e: any) {
    console.log("\n=== ERROR ===");
    console.log("Error message:", e.message);

    // Try to extract revert reason
    if (e.data) {
      console.log("Error data:", e.data);
    }
    if (e.reason) {
      console.log("Revert reason:", e.reason);
    }
    if (e.error) {
      console.log("Inner error:", e.error);
    }

    // Full error for debugging
    console.log("\nFull error object:");
    console.log(JSON.stringify(e, Object.getOwnPropertyNames(e), 2));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

