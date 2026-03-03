import "dotenv/config";
import hre from "hardhat";
import { type Address } from "viem";

const REFINERY_ABI = [
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "refineRequests",
    outputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint8", name: "baseRarity", type: "uint8" },
      { internalType: "uint8", name: "targetRarity", type: "uint8" },
      { internalType: "uint16", name: "bonusBps", type: "uint16" },
      { internalType: "uint40", name: "createdAt", type: "uint40" },
      { internalType: "bool", name: "resolved", type: "bool" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "refineTimeout",
    outputs: [{ internalType: "uint32", name: "", type: "uint32" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "vrfCoordinator",
    outputs: [{ internalType: "contract IVRFCoordinatorV2_5", name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "vrfSubId",
    outputs: [{ internalType: "uint64", name: "", type: "uint64" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "vrfCallbackGasLimit",
    outputs: [{ internalType: "uint32", name: "", type: "uint32" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const REFINERY_ADDRESS = "0xD49078775a04291D17B084243611C631199BF38E" as Address;
const REQUEST_ID = BigInt("52572908656932703135963169719014721224401580346669699570903721933960056891452");

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();

  console.log("Querying refine request...");
  console.log(`Request ID: ${REQUEST_ID}`);
  console.log("");

  const request = await publicClient.readContract({
    abi: REFINERY_ABI,
    address: REFINERY_ADDRESS,
    functionName: "refineRequests",
    args: [REQUEST_ID],
  });

  const timeout = await publicClient.readContract({
    abi: REFINERY_ABI,
    address: REFINERY_ADDRESS,
    functionName: "refineTimeout",
  });

  const [user, baseRarity, targetRarity, bonusBps, createdAt, resolved] = request;
  
  const createdDate = new Date(Number(createdAt) * 1000);
  const expiresAt = new Date((Number(createdAt) + Number(timeout)) * 1000);
  const now = new Date();
  const canCancel = now > expiresAt && !resolved;

  console.log("=== Refine Request Status ===");
  console.log(`User: ${user}`);
  console.log(`Base Rarity: ${baseRarity} (${["", "Rare", "Epic", "Legendary"][baseRarity] || "Unknown"})`);
  console.log(`Target Rarity: ${targetRarity} (${["", "", "Epic", "Legendary", "Mythic"][targetRarity] || "Unknown"})`);
  console.log(`Bonus BPS: ${bonusBps} (+${bonusBps / 100}%)`);
  console.log(`Created At: ${createdDate.toISOString()}`);
  console.log(`Timeout: ${timeout} seconds (${timeout / 3600} hours)`);
  console.log(`Expires At: ${expiresAt.toISOString()}`);
  console.log(`Resolved: ${resolved}`);
  console.log("");

  if (resolved) {
    console.log("✅ Request has been resolved (VRF callback executed)");
  } else {
    console.log("⏳ Request is PENDING - VRF callback has NOT been executed yet!");
    console.log("");
    if (canCancel) {
      console.log("⚠️ Request has EXPIRED and can be cancelled!");
      console.log(`   User can call cancelRefine(${REQUEST_ID}) to get NFTs back`);
    } else {
      console.log(`⏰ Request will expire at: ${expiresAt.toISOString()}`);
      console.log(`   Time remaining: ${Math.max(0, (expiresAt.getTime() - now.getTime()) / 1000 / 60).toFixed(1)} minutes`);
    }
  }

  // Check VRF config
  console.log("");
  console.log("=== VRF Configuration ===");
  const vrfCoord = await publicClient.readContract({
    abi: REFINERY_ABI,
    address: REFINERY_ADDRESS,
    functionName: "vrfCoordinator",
  });
  const vrfSubId = await publicClient.readContract({
    abi: REFINERY_ABI,
    address: REFINERY_ADDRESS,
    functionName: "vrfSubId",
  });
  const vrfGasLimit = await publicClient.readContract({
    abi: REFINERY_ABI,
    address: REFINERY_ADDRESS,
    functionName: "vrfCallbackGasLimit",
  });
  console.log(`VRF Coordinator: ${vrfCoord}`);
  console.log(`VRF Sub ID: ${vrfSubId}`);
  console.log(`VRF Callback Gas Limit: ${vrfGasLimit}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

