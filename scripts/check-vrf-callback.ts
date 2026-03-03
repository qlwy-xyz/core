import "dotenv/config";
import hre from "hardhat";
import { type Address, parseAbiItem } from "viem";

const REFINERY_ADDRESS = "0xD49078775a04291D17B084243611C631199BF38E" as Address;
const REQUEST_ID = BigInt("98568075299878633968188912656622013573621645869511713338171953604800632221919");
const USER_ADDRESS = "0x5E58DF0187b7FBf6A2a7ac5cf961D87E596D9d0C" as Address;

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
] as const;

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();

  console.log("=== VRF Callback Check ===\n");

  // 1. Check request status
  const request = await publicClient.readContract({
    abi: REFINERY_ABI,
    address: REFINERY_ADDRESS,
    functionName: "refineRequests",
    args: [REQUEST_ID],
  });

  const [user, baseRarity, targetRarity, bonusBps, createdAt, resolved] = request;

  console.log("Request Status:");
  console.log("  User:", user);
  console.log("  Resolved:", resolved);
  console.log("  Base Rarity:", baseRarity);
  console.log("  Target Rarity:", targetRarity);
  console.log("  Created At:", new Date(Number(createdAt) * 1000).toISOString());
  console.log("");

  // 2. Query RefineResult events for this user
  console.log("Checking RefineResult events...");

  const currentBlock = await publicClient.getBlockNumber();
  console.log("Current block:", currentBlock);

  // Search last 50000 blocks
  const fromBlock = currentBlock - 50000n;

  const refineResultEvent = parseAbiItem(
    "event RefineResult(address indexed user, uint8 indexed baseRarity, uint8 indexed targetRarity, bool success, uint16 finalThresholdBps)"
  );

  const userEvents = await publicClient.getLogs({
    address: REFINERY_ADDRESS,
    event: refineResultEvent,
    args: { user: USER_ADDRESS },
    fromBlock,
    toBlock: currentBlock,
  });

  console.log(`\nRefineResult events for this user: ${userEvents.length}`);

  for (const event of userEvents) {
    console.log("\n--- Event ---");
    console.log("  Block:", event.blockNumber);
    console.log("  Tx Hash:", event.transactionHash);
    console.log("  Success:", event.args.success);
    console.log("  Base Rarity:", event.args.baseRarity);
    console.log("  Target Rarity:", event.args.targetRarity);
  }

  // 3. Check all recent RefineResult events
  console.log("\n\nChecking ALL RefineResult events (last 50000 blocks)...");
  const allEvents = await publicClient.getLogs({
    address: REFINERY_ADDRESS,
    event: refineResultEvent,
    fromBlock,
    toBlock: currentBlock,
  });

  console.log(`Total RefineResult events found: ${allEvents.length}`);

  for (const event of allEvents) {
    console.log(`  - Block ${event.blockNumber}: user=${event.args.user}, success=${event.args.success}`);
  }

  // 4. Check VRF config
  console.log("\n\nVRF Configuration:");
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
  console.log("  VRF Coordinator:", vrfCoord);
  console.log("  VRF Sub ID:", vrfSubId.toString());

  // 5. Conclusion
  console.log("\n=== Conclusion ===");
  if (!resolved) {
    console.log("❌ VRF callback has NOT been executed yet.");
    console.log("   The request is still PENDING.");

    const timeout = await publicClient.readContract({
      abi: REFINERY_ABI,
      address: REFINERY_ADDRESS,
      functionName: "refineTimeout",
    });
    const expiresAt = Number(createdAt) + Number(timeout);
    const now = Math.floor(Date.now() / 1000);
    const remainingSeconds = expiresAt - now;

    if (remainingSeconds > 0) {
      const hours = Math.floor(remainingSeconds / 3600);
      const minutes = Math.floor((remainingSeconds % 3600) / 60);
      console.log(`   User can cancel in: ${hours}h ${minutes}m`);
    } else {
      console.log("   ✅ Timeout expired! User can now call cancelRefine()");
    }
  } else {
    console.log("✅ Request has been resolved.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

