import "dotenv/config";
import hre from "hardhat";
import { type Address, type WalletClient, formatEther, parseEther } from "viem";
import type { Account } from "viem/accounts";
import { privateKeyToAccount } from "viem/accounts";

const CORE_ABI = [
  {
    inputs: [{ internalType: "bytes", name: "opts", type: "bytes" }],
    name: "requestCast",
    outputs: [
      { internalType: "uint256", name: "castId", type: "uint256" },
      { internalType: "uint256", name: "requestId", type: "uint256" },
    ],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [],
    name: "castFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// Configuration
const CORE_ADDRESS = (process.env.CORE_ADDRESS || "0xcE6f2F55898050C0D1769164c4Ceb828B4fC54f8") as Address;
const INTERVAL_MS = parseInt(process.env.CAST_INTERVAL_MS || "60000"); // Default 5 seconds
const MAX_CASTS = parseInt(process.env.MAX_CASTS || "0"); // 0 = unlimited

type NetworkConnection = Awaited<ReturnType<typeof hre.network.connect>>;

async function resolveWalletClient(
  connection: NetworkConnection
): Promise<{ walletClient: WalletClient; account: Account }> {
  const privateKey = process.env.BSC_CAST_PRIVATE_KEY;

  if (privateKey && connection.networkName !== "localhost") {
    const account = privateKeyToAccount(`0x${privateKey}` as `0x${string}`);
    const walletClient = await connection.viem.getWalletClient(
      account.address,
      { account }
    );
    return { walletClient, account };
  }

  const walletClients = await connection.viem.getWalletClients();
  if (walletClients.length === 0) {
    throw new Error("No wallet client available. Set BSC_PRIVATE_KEY in .env.");
  }

  const walletClient = walletClients[0];
  if (!walletClient.account) {
    throw new Error("Wallet client is missing an associated account.");
  }

  return { walletClient, account: walletClient.account };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const { walletClient, account } = await resolveWalletClient(connection);
  const chain = walletClient.chain ?? undefined;

  console.log(`🎯 Auto Cast Script`);
  console.log(`   Core: ${CORE_ADDRESS}`);
  console.log(`   Network: ${connection.networkName}`);
  console.log(`   Account: ${account.address}`);
  console.log(`   Interval: ${INTERVAL_MS}ms`);
  console.log(`   Max Casts: ${MAX_CASTS === 0 ? "unlimited" : MAX_CASTS}`);
  console.log("");

  // Get cast fee
  const castFee = await publicClient.readContract({
    abi: CORE_ABI,
    address: CORE_ADDRESS,
    functionName: "castFee",
  });
  console.log(`💰 Cast Fee: ${formatEther(castFee)} BNB`);

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💳 Balance: ${formatEther(balance)} BNB`);

  if (balance < castFee) {
    throw new Error("Insufficient balance for casting");
  }

  const estimatedCasts = castFee > 0n ? balance / castFee : 0n;
  console.log(`📊 Estimated casts possible: ${estimatedCasts}`);
  console.log("");
  console.log("🚀 Starting auto cast loop... (Ctrl+C to stop)");
  console.log("");

  let castCount = 0;

  while (MAX_CASTS === 0 || castCount < MAX_CASTS) {
    try {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] Casting #${castCount + 1}...`);

      const txHash = await walletClient.writeContract({
        abi: CORE_ABI,
        address: CORE_ADDRESS,
        functionName: "requestCast",
        args: ["0x" as `0x${string}`],
        value: castFee,
        account,
        chain,
      });

      console.log(`   TX: ${txHash}`);

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });

      if (receipt.status === "success") {
        console.log(`   ✅ Success! Block: ${receipt.blockNumber}`);
        castCount++;
      } else {
        console.log(`   ❌ Failed with status: ${receipt.status}`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message || error}`);
    }

    if (MAX_CASTS === 0 || castCount < MAX_CASTS) {
      console.log(`   ⏳ Waiting ${INTERVAL_MS}ms...`);
      await sleep(INTERVAL_MS);
    }
  }

  console.log("");
  console.log(`🏁 Completed ${castCount} casts`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

