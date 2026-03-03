/**
 * Battle Starter - Starts battles whose betting period has ended
 *
 * This script queries the subgraph for BETTING battles, checks if their
 * betting period has ended, and calls startBattle() on the contract.
 *
 * Usage:
 *   # One-shot run:
 *   npx hardhat run scripts/battle-starter.ts --network bsc
 *
 *   # Continuous loop (e.g. every 60 seconds):
 *   LOOP_INTERVAL_MS=60000 npx hardhat run scripts/battle-starter.ts --network bsc
 *
 * Required env vars:
 *   OPERATOR_PRIVATE_KEY   - Private key of the caller (anyone can call startBattle)
 *   BATTLE_V2_ADDRESS      - QLWYBattleV2 contract address
 *
 * Optional env vars:
 *   SUBGRAPH_URL           - The Graph subgraph endpoint (has default)
 *   BSC_RPC_URL            - BSC RPC URL (has default)
 *   LOOP_INTERVAL_MS       - If set, runs in a continuous loop with this interval
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

// ============ Configuration ============

const BATTLE_V2_ADDRESS = (process.env.BATTLE_V2_ADDRESS || "") as Address;
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "https://api.studio.thegraph.com/query/102009/qlwy/version/latest";
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY || "";
const RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
const LOOP_INTERVAL_MS = process.env.LOOP_INTERVAL_MS ? Number(process.env.LOOP_INTERVAL_MS) : 0;

const BATTLE_V2_ABI = [
  {
    name: "startBattle",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "battleId", type: "uint256" }],
    outputs: [{ name: "vrfRequestId", type: "uint256" }],
  },
] as const;

// ============ Subgraph ============

const SUBGRAPH_API_KEY = process.env.SUBGRAPH_API_KEY || "";

const BETTING_BATTLES_QUERY = `
  query BettingBattles {
    battleV2S(where: { status: BETTING }, first: 50) {
      battleId
      bettingEndsAt
    }
  }
`;

async function querySubgraph<T>(query: string): Promise<T | null> {
  if (!SUBGRAPH_URL) return null;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SUBGRAPH_API_KEY) headers["Authorization"] = `Bearer ${SUBGRAPH_API_KEY}`;
    const response = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query }),
    });
    if (!response.ok) return null;
    const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    return json.data ?? null;
  } catch {
    return null;
  }
}

// ============ Main ============

async function runOnce() {
  console.log("\n=== Battle Starter ===", new Date().toISOString());

  if (!OPERATOR_PRIVATE_KEY || !BATTLE_V2_ADDRESS) {
    console.error("OPERATOR_PRIVATE_KEY and BATTLE_V2_ADDRESS are required");
    process.exit(1);
  }

  const account = privateKeyToAccount(OPERATOR_PRIVATE_KEY as Hex);
  const publicClient = createPublicClient({ chain: bsc, transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, chain: bsc, transport: http(RPC_URL) });

  const data = await querySubgraph<{
    battleV2S: Array<{ battleId: string; bettingEndsAt: string }>;
  }>(BETTING_BATTLES_QUERY);

  const battles = data?.battleV2S || [];
  const now = Math.floor(Date.now() / 1000);
  const readyToStart = battles.filter((b) => Number(b.bettingEndsAt) <= now);

  console.log(`BETTING battles: ${battles.length}, ready to start: ${readyToStart.length}`);

  for (const battle of readyToStart) {
    const battleId = BigInt(battle.battleId);
    try {
      console.log(`  Starting battle #${battleId}...`);
      const hash = await walletClient.writeContract({
        address: BATTLE_V2_ADDRESS,
        abi: BATTLE_V2_ABI,
        functionName: "startBattle",
        args: [battleId],
      });
      console.log(`  TX submitted: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
      if (receipt.status === "reverted") {
        console.error(`  ❌ Battle #${battleId} reverted in block ${receipt.blockNumber}`);
      } else {
        console.log(`  ✅ Battle #${battleId} started in block ${receipt.blockNumber}`);
      }
    } catch (e: any) {
      console.error(`  ❌ Battle #${battleId} failed: ${e.shortMessage || e.message}`);
    }
  }
}

async function main() {
  if (LOOP_INTERVAL_MS > 0) {
    console.log(`Running in loop mode, interval=${LOOP_INTERVAL_MS}ms`);
    while (true) {
      try { await runOnce(); } catch (e: any) { console.error("Run failed:", e.message || e); }
      await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
    }
  } else {
    await runOnce();
  }
}

main().catch((error) => {
  console.error("Battle Starter fatal error:", error);
  process.exit(1);
});

