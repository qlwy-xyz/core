/**
 * Spirit Worker - Local Backup Script for Autonomous Spirit Actions
 *
 * This script mirrors the logic of interface/api/spirit-worker.ts (Vercel Edge Function)
 * so you can run it locally as a backup / for debugging.
 *
 * Usage:
 *   # One-shot run:
 *   npx hardhat run scripts/spirit-worker.ts --network bsc
 *
 *   # Continuous loop (set LOOP_INTERVAL_MS, e.g. 60000 for 1 min):
 *   LOOP_INTERVAL_MS=60000 npx hardhat run scripts/spirit-worker.ts --network bsc
 *
 * Required env vars:
 *   OPERATOR_PRIVATE_KEY   - Private key of the authorized operator
 *   SPIRIT_AGENT_ADDRESS   - QLWYSpiritAgent contract address
 *   SPIRIT_LOGIC_ADDRESS   - QLWYSpiritLogic contract address
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
  encodeAbiParameters,
  parseAbiParameters,
  concatHex,
  keccak256,
  toBytes,
  slice,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bsc } from "viem/chains";

// ============ Spirit Preferences (Memory) ============

interface BattleFilter {
  type: "maxOpponentLuck" | "minOpponentLuck" | "avoidAddress" | "maxBetPerSlot" | "minBetPerSlot" | "maxHighLuckCount" | "minOpponentExperience" | "maxOpponentExperience" | "onlyChallengerSide" | "onlyDefenderSide" | "followAddress" | "onlyWithAddress" | "onlyCreateBattle";
  value: number | string;
  threshold?: number;  // 幸运值阈值（仅 maxHighLuckCount 使用）
  description?: string;
}

interface BetPreference {
  type: "preferMismatch" | "preferBalanced" | "preferChallenger" | "preferDefender" | "preferUnderdog" | "minPoolRatio" | "maxPoolRatio" | "autoCreateAfterBattle";
  value?: number;
  description?: string;
}

interface SpiritPreferences {
  spiritId: string;
  battleFilters: BattleFilter[];
  betPreferences: BetPreference[];
  notes?: string;
  updatedAt: number;
}

const UPSTASH_REDIS_REST_URL = process.env.KV_REST_API_URL || process.env.QLWY_KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_REDIS_REST_TOKEN = process.env.KV_REST_API_TOKEN || process.env.QLWY_KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";

async function getSpiritPreferences(spiritId: string): Promise<SpiritPreferences | null> {
  if (!UPSTASH_REDIS_REST_URL || !UPSTASH_REDIS_REST_TOKEN) return null;
  try {
    const resp = await fetch(`${UPSTASH_REDIS_REST_URL}/get/spirit_prefs_${spiritId}`, {
      headers: { Authorization: `Bearer ${UPSTASH_REDIS_REST_TOKEN}` },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { result: string | null };
    if (!data.result) return null;
    return JSON.parse(data.result) as SpiritPreferences;
  } catch {
    return null;
  }
}

// ============ Configuration ============

const SPIRIT_AGENT_ADDRESS = (process.env.SPIRIT_AGENT_ADDRESS || "") as Address;
const SPIRIT_LOGIC_ADDRESS = (process.env.SPIRIT_LOGIC_ADDRESS || "") as Address;
const BATTLE_V2_ADDRESS = (process.env.BATTLE_V2_ADDRESS || "") as Address;
const QLWY_TOKEN_ADDRESS = (process.env.QLWY_TOKEN_ADDRESS || "0x2e591b13d3caf27adf1db47d75278315d0754444") as Address;
const SUBGRAPH_URL = process.env.SUBGRAPH_URL || "https://api.studio.thegraph.com/query/102009/qlwy/version/latest";
const OPERATOR_PRIVATE_KEY = process.env.OPERATOR_PRIVATE_KEY || "";
const RPC_URL = process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org";
const LOOP_INTERVAL_MS = process.env.LOOP_INTERVAL_MS ? Number(process.env.LOOP_INTERVAL_MS) : 0;

// Action type selectors (must match QLWYSpiritLogic.sol)
const ACTION_AUTO_BATTLE = slice(keccak256(toBytes("AUTO_BATTLE")), 0, 4);
const ACTION_AUTO_BET = slice(keccak256(toBytes("AUTO_BET")), 0, 4);
const ACTION_CLAIM_WINNINGS = slice(keccak256(toBytes("CLAIM_WINNINGS")), 0, 4);

// ============ ABIs ============

const SPIRIT_AGENT_ABI = [
  {
    name: "executeAction",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const SPIRIT_LOGIC_ABI = [
  {
    name: "getStrategy",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "maxBetAmount", type: "uint256" },
          { name: "maxBattleBet", type: "uint256" },
          { name: "riskLevel", type: "uint8" },
          { name: "autoBattleEnabled", type: "bool" },
          { name: "autoBetEnabled", type: "bool" },
          { name: "autoCastEnabled", type: "bool" },
          { name: "jackpotThreshold", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const BATTLE_V2_ABI = [
  {
    name: "minBetPerSlot",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Check QLWY token balance and allowance for an owner before executing a TX.
 * Returns true if both are sufficient; logs details and returns false otherwise.
 */
async function checkTokenAllowance(
  owner: Address,
  requiredAmount: bigint,
  label: string,
  publicClient: any,
): Promise<boolean> {
  try {
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({
        address: QLWY_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [owner],
      }) as Promise<bigint>,
      publicClient.readContract({
        address: QLWY_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [owner, BATTLE_V2_ADDRESS],
      }) as Promise<bigint>,
    ]);

    const balanceOk = balance >= requiredAmount;
    const allowanceOk = allowance >= requiredAmount;

    if (!balanceOk || !allowanceOk) {
      console.warn(
        `  ⚠️ [${label}] owner=${owner}\n` +
        `     需要: ${formatUnits(requiredAmount, 18)} QLWY\n` +
        `     余额: ${formatUnits(balance, 18)} QLWY ${balanceOk ? "✅" : "❌ 不足"}\n` +
        `     授权(→BattleV2): ${formatUnits(allowance, 18)} QLWY ${allowanceOk ? "✅" : "❌ 不足"}`
      );
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`  ⚠️ [${label}] 检查授权失败: ${e.shortMessage || e.message}`);
    return true; // Don't block execution if check fails
  }
}

// ============ Types ============

interface Spirit {
  tokenId: bigint;
  owner: Address;
  strategy: {
    maxBetAmount: bigint;
    maxBattleBet: bigint;
    riskLevel: number;
    autoBattleEnabled: boolean;
    autoBetEnabled: boolean;
    autoCastEnabled: boolean;
  };
}

interface SpiritStats {
  total: number;
  autoBattle: number;
  autoBet: number;
  autoCast: number;
  riskConservative: number;  // riskLevel 0
  riskBalanced: number;      // riskLevel 1
  riskAggressive: number;    // riskLevel 2
}

interface OpenBattle {
  battleId: bigint;
  creator: string;
  challengerCount: number;
  defenderCount: number;
  betPerSlot: bigint;
  challengerContributors: string[];
  defenderContributors: string[];
  challengerLucks: number[];
  defenderLucks: number[];
  challengerExperiences: number[];
  defenderExperiences: number[];
}

interface BettingBattle {
  battleId: bigint;
  bettingEndsAt: number;
  challengerBetPool: bigint;
  defenderBetPool: bigint;
}

interface ClaimableBattle {
  battleId: bigint;
  challengerWon: boolean;
}

type ActionResult = { tokenId: string; action: string; success: boolean; error?: string };

// ============ GraphQL Queries ============

const ACTIVE_SPIRITS_QUERY = `
  query ActiveSpirits {
    spirits(where: { status: "Active" }, first: 100) {
      tokenId
      owner
      token { tokenId }
    }
  }
`;

const ACTIVE_BATTLE_SLOTS_QUERY = `
  query ActiveBattleSlots {
    filling: battleV2S(where: { status: FILLING }, first: 100) {
      challengerSlots { nftId }
      defenderSlots { nftId }
    }
    betting: battleV2S(where: { status: BETTING }, first: 100) {
      challengerSlots { nftId }
      defenderSlots { nftId }
    }
    pending: battleV2S(where: { status: PENDING }, first: 100) {
      challengerSlots { nftId }
      defenderSlots { nftId }
    }
  }
`;

const OPEN_BATTLES_QUERY = `
  query OpenBattles {
    battleV2S(where: { status: FILLING }, first: 50, orderBy: createdAt, orderDirection: desc) {
      battleId
      creator
      challengerCount
      defenderCount
      betPerSlot
      challengerSlots { contributor, luck, nftId }
      defenderSlots { contributor, luck, nftId }
    }
  }
`;

const SPIRIT_EXPERIENCES_QUERY = `
  query SpiritExperiences($ids: [ID!]!) {
    spirits(where: { id_in: $ids }) {
      id
      experience
    }
  }
`;

const BETTING_BATTLES_QUERY = `
  query BettingBattles {
    battleV2S(where: { status: BETTING }, first: 50) {
      battleId
      betPerSlot
      challengerBetPool
      defenderBetPool
      bettingEndsAt
    }
  }
`;

const RESOLVED_BATTLES_QUERY = `
  query ResolvedBattles {
    battleV2S(where: { status: RESOLVED }, first: 50, orderBy: resolvedAt, orderDirection: desc) {
      battleId
      challengerWon
    }
  }
`;

const USER_BETS_QUERY = `
  query UserBets($battleId: BigInt!, $user: Bytes!) {
    userBetV2S(where: { battleId: $battleId, user: $user }) {
      betOnChallenger
      betOnDefender
      claimed
    }
  }
`;

// ============ Subgraph Helpers ============

const SUBGRAPH_API_KEY = process.env.SUBGRAPH_API_KEY || "";

async function querySubgraph<T>(query: string, variables?: Record<string, unknown>): Promise<T | null> {
  if (!SUBGRAPH_URL) {
    console.error("[querySubgraph] SUBGRAPH_URL is empty, skipping query");
    return null;
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SUBGRAPH_API_KEY) headers["Authorization"] = `Bearer ${SUBGRAPH_API_KEY}`;
    const response = await fetch(SUBGRAPH_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      console.error(`[querySubgraph] HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    const json = await response.json() as { data?: T; errors?: Array<{ message: string }> };
    if (json.errors?.length) {
      console.error(`[querySubgraph] GraphQL errors: ${json.errors.map((e: { message: string }) => e.message).join(", ")}`);
    }
    return json.data ?? null;
  } catch (e: any) {
    console.error(`[querySubgraph] fetch error: ${e.message || String(e)}`);
    return null;
  }
}

// ============ Data Fetching ============

async function fetchActiveSpirits(publicClient: ReturnType<typeof createPublicClient>): Promise<{ spirits: Spirit[]; stats: SpiritStats }> {
  const emptyStats: SpiritStats = { total: 0, autoBattle: 0, autoBet: 0, autoCast: 0, riskConservative: 0, riskBalanced: 0, riskAggressive: 0 };
  if (!SUBGRAPH_URL || !SPIRIT_LOGIC_ADDRESS) {
    console.log(`[fetchActiveSpirits] skipped: SUBGRAPH_URL=${!!SUBGRAPH_URL}, SPIRIT_LOGIC_ADDRESS=${!!SPIRIT_LOGIC_ADDRESS}`);
    return { spirits: [], stats: emptyStats };
  }
  try {
    const data = await querySubgraph<{
      spirits: Array<{ tokenId: string; owner: string; token: { tokenId: string } }>;
    }>(ACTIVE_SPIRITS_QUERY);
    console.log(`[fetchActiveSpirits] subgraph returned ${data?.spirits?.length ?? 0} spirits`);
    if (!data?.spirits?.length) return { spirits: [], stats: emptyStats };

    const stats: SpiritStats = { total: 0, autoBattle: 0, autoBet: 0, autoCast: 0, riskConservative: 0, riskBalanced: 0, riskAggressive: 0 };
    const spirits: Spirit[] = [];
    for (const spirit of data.spirits) {
      try {
        const strategy = await publicClient.readContract({
          address: SPIRIT_LOGIC_ADDRESS,
          abi: SPIRIT_LOGIC_ABI,
          functionName: "getStrategy",
          args: [BigInt(spirit.tokenId)],
        });

        // Collect stats from ALL spirits
        stats.total++;
        if (strategy.autoBattleEnabled) stats.autoBattle++;
        if (strategy.autoBetEnabled) stats.autoBet++;
        if (strategy.autoCastEnabled) stats.autoCast++;
        if (strategy.riskLevel === 0) stats.riskConservative++;
        else if (strategy.riskLevel === 1) stats.riskBalanced++;
        else if (strategy.riskLevel === 2) stats.riskAggressive++;

        // Only keep actionable spirits for processing
        if (!strategy.autoBattleEnabled && !strategy.autoBetEnabled) continue;
        spirits.push({
          tokenId: BigInt(spirit.tokenId),
          owner: spirit.owner as Address,
          strategy: {
            maxBetAmount: strategy.maxBetAmount,
            maxBattleBet: strategy.maxBattleBet,
            riskLevel: strategy.riskLevel,
            autoBattleEnabled: strategy.autoBattleEnabled,
            autoBetEnabled: strategy.autoBetEnabled,
            autoCastEnabled: strategy.autoCastEnabled,
          },
        });
      } catch (err: any) {
        console.error(`  [fetchActiveSpirits] spirit #${spirit.tokenId} getStrategy failed: ${err?.shortMessage || err?.message || String(err)}`);
        continue;
      }
    }
    return { spirits, stats };
  } catch {
    return { spirits: [], stats: emptyStats };
  }
}

async function fetchSpiritExperiences(nftIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (nftIds.length === 0) return result;
  const data = await querySubgraph<{
    spirits: Array<{ id: string; experience: number }>;
  }>(SPIRIT_EXPERIENCES_QUERY, { ids: nftIds });
  if (data?.spirits) {
    for (const s of data.spirits) {
      result.set(s.id, s.experience);
    }
  }
  return result;
}

async function fetchOpenBattles(): Promise<OpenBattle[]> {
  const data = await querySubgraph<{
    battleV2S: Array<{
      battleId: string; creator: string; challengerCount: number; defenderCount: number;
      betPerSlot: string;
      challengerSlots: Array<{ contributor: string; luck: number; nftId: string }>;
      defenderSlots: Array<{ contributor: string; luck: number; nftId: string }>;
    }>;
  }>(OPEN_BATTLES_QUERY);
  if (!data?.battleV2S?.length) return [];

  // Collect all nftIds to batch-query experience
  const allNftIds = new Set<string>();
  for (const b of data.battleV2S) {
    for (const s of [...(b.challengerSlots || []), ...(b.defenderSlots || [])]) {
      if (s.nftId && s.nftId !== "0") allNftIds.add(s.nftId);
    }
  }
  const expMap = await fetchSpiritExperiences([...allNftIds]);

  return data.battleV2S.map((b) => ({
    battleId: BigInt(b.battleId),
    creator: b.creator.toLowerCase(),
    challengerCount: b.challengerCount,
    defenderCount: b.defenderCount,
    betPerSlot: BigInt(b.betPerSlot),
    challengerContributors: (b.challengerSlots || []).map(s => s.contributor.toLowerCase()),
    defenderContributors: (b.defenderSlots || []).map(s => s.contributor.toLowerCase()),
    challengerLucks: (b.challengerSlots || []).map(s => s.luck),
    defenderLucks: (b.defenderSlots || []).map(s => s.luck),
    challengerExperiences: (b.challengerSlots || []).map(s => expMap.get(s.nftId) ?? 0),
    defenderExperiences: (b.defenderSlots || []).map(s => expMap.get(s.nftId) ?? 0),
  }));
}

async function fetchBettingBattles(): Promise<BettingBattle[]> {
  const data = await querySubgraph<{
    battleV2S: Array<{ battleId: string; betPerSlot: string; challengerBetPool: string; defenderBetPool: string; bettingEndsAt: string }>;
  }>(BETTING_BATTLES_QUERY);
  if (!data?.battleV2S?.length) return [];
  return data.battleV2S.map((b) => ({
    battleId: BigInt(b.battleId),
    bettingEndsAt: Number(b.bettingEndsAt),
    challengerBetPool: BigInt(b.challengerBetPool),
    defenderBetPool: BigInt(b.defenderBetPool),
  }));
}

async function fetchResolvedBattles(): Promise<ClaimableBattle[]> {
  const data = await querySubgraph<{
    battleV2S: Array<{ battleId: string; challengerWon: boolean }>;
  }>(RESOLVED_BATTLES_QUERY);
  if (!data?.battleV2S?.length) return [];
  return data.battleV2S.map((b) => ({ battleId: BigInt(b.battleId), challengerWon: b.challengerWon }));
}

async function fetchNftsInActiveBattles(): Promise<Set<string>> {
  type BattleWithSlots = { challengerSlots: Array<{ nftId: string }>; defenderSlots: Array<{ nftId: string }> };
  const data = await querySubgraph<{ filling: BattleWithSlots[]; betting: BattleWithSlots[]; pending: BattleWithSlots[] }>(ACTIVE_BATTLE_SLOTS_QUERY);
  const nftIds = new Set<string>();
  if (!data) return nftIds;
  for (const group of [data.filling, data.betting, data.pending]) {
    if (!group) continue;
    for (const battle of group) {
      for (const slot of [...(battle.challengerSlots || []), ...(battle.defenderSlots || [])]) {
        if (slot.nftId && slot.nftId !== "0") nftIds.add(slot.nftId);
      }
    }
  }
  return nftIds;
}

// ============ Decision Logic ============

function decideBattleJoin(
  spirit: Spirit,
  battles: OpenBattle[],
  preferences?: SpiritPreferences | null
): { battleId: bigint; side: "challenger" | "defender" } | null {
  if (!spirit.strategy.autoBattleEnabled) return null;

  // onlyCreateBattle: skip joining, only create battles
  const hasOnlyCreate = preferences?.battleFilters.some(f => f.type === "onlyCreateBattle") ?? false;
  if (hasOnlyCreate) {
    console.log(`  🏗️ onlyCreateBattle 偏好已设置，跳过加入对战`);
    return null;
  }

  const ownerLower = spirit.owner.toLowerCase();

  // Collect onlyWithAddress targets first — these battles are exempt from other filters
  const onlyWithAddrSet = new Set(
    (preferences?.battleFilters.filter(f => f.type === "onlyWithAddress") ?? [])
      .map(f => String(f.value).toLowerCase())
  );
  const isTargetBattle = (b: OpenBattle) => {
    if (onlyWithAddrSet.size === 0) return false;
    return onlyWithAddrSet.has(b.creator) ||
      b.challengerContributors.some(a => onlyWithAddrSet.has(a)) ||
      b.defenderContributors.some(a => onlyWithAddrSet.has(a));
  };

  // Apply preference filters first
  let filtered = battles;
  console.log(`  📋 initial open battles: ${battles.length}`);
  if (preferences && preferences.battleFilters.length > 0) {
    for (const filter of preferences.battleFilters) {
      const beforeCount = filtered.length;
      if (filter.type === "maxOpponentLuck") {
        const maxLuck = Number(filter.value);
        filtered = filtered.filter((b) => {
          if (isTargetBattle(b)) return true; // exempt onlyWithAddress targets
          const allLucks = [...b.challengerLucks, ...b.defenderLucks];
          if (allLucks.length === 0) return true;
          const avg = allLucks.reduce((a, c) => a + c, 0) / allLucks.length;
          return avg <= maxLuck;
        });
      } else if (filter.type === "minOpponentLuck") {
        const minLuck = Number(filter.value);
        filtered = filtered.filter((b) => {
          if (isTargetBattle(b)) return true; // exempt onlyWithAddress targets
          const allLucks = [...b.challengerLucks, ...b.defenderLucks];
          if (allLucks.length === 0) return true;
          const avg = allLucks.reduce((a, c) => a + c, 0) / allLucks.length;
          return avg >= minLuck;
        });
      } else if (filter.type === "avoidAddress") {
        const addr = String(filter.value).toLowerCase();
        filtered = filtered.filter((b) =>
          isTargetBattle(b) || // exempt onlyWithAddress targets
          (b.creator !== addr &&
          !b.challengerContributors.includes(addr) &&
          !b.defenderContributors.includes(addr))
        );
      } else if (filter.type === "maxBetPerSlot") {
        const maxBet = BigInt(filter.value);
        filtered = filtered.filter((b) => isTargetBattle(b) || b.betPerSlot <= maxBet);
      } else if (filter.type === "minBetPerSlot") {
        const minBet = BigInt(filter.value);
        filtered = filtered.filter((b) => isTargetBattle(b) || b.betPerSlot >= minBet);
      } else if (filter.type === "maxHighLuckCount") {
        const maxCount = Number(filter.value);
        const threshold = filter.threshold ?? 100;
        filtered = filtered.filter((b) => {
          if (isTargetBattle(b)) return true; // exempt onlyWithAddress targets
          const allLucks = [...b.challengerLucks, ...b.defenderLucks];
          const highCount = allLucks.filter((l) => l > threshold).length;
          return highCount <= maxCount;
        });
      } else if (filter.type === "minOpponentExperience") {
        const minExp = Number(filter.value);
        filtered = filtered.filter((b) => {
          if (isTargetBattle(b)) return true; // exempt onlyWithAddress targets
          const allExps = [...b.challengerExperiences, ...b.defenderExperiences];
          if (allExps.length === 0) return true; // no data, allow
          const avg = allExps.reduce((a, c) => a + c, 0) / allExps.length;
          return avg >= minExp;
        });
      } else if (filter.type === "maxOpponentExperience") {
        const maxExp = Number(filter.value);
        filtered = filtered.filter((b) => {
          if (isTargetBattle(b)) return true; // exempt onlyWithAddress targets
          const allExps = [...b.challengerExperiences, ...b.defenderExperiences];
          if (allExps.length === 0) return true;
          const avg = allExps.reduce((a, c) => a + c, 0) / allExps.length;
          return avg <= maxExp;
        });
      }
      if (filtered.length < beforeCount) {
        console.log(`    filter ${filter.type}=${filter.value}: ${beforeCount} → ${filtered.length}`);
      }
    }
  }

  // Check side preference from filters
  const onlyChallenger = preferences?.battleFilters.some(f => f.type === "onlyChallengerSide") ?? false;
  const onlyDefender = preferences?.battleFilters.some(f => f.type === "onlyDefenderSide") ?? false;
  // Collect all addresses for followAddress / onlyWithAddress (supports multiple)
  const followAddrs = (preferences?.battleFilters.filter(f => f.type === "followAddress") ?? [])
    .map(f => String(f.value).toLowerCase());
  const onlyWithAddrs = (preferences?.battleFilters.filter(f => f.type === "onlyWithAddress") ?? [])
    .map(f => String(f.value).toLowerCase());

  // Helper: check if any of the target addresses is in a battle
  const hasAddrInBattle = (b: OpenBattle, addrs: string[]) =>
    addrs.some(a => b.challengerContributors.includes(a) || b.defenderContributors.includes(a) || b.creator === a);
  // Helper: find which side target addresses are on, return the side with most matches
  const findAddrSide = (b: OpenBattle, addrs: string[]): "challenger" | "defender" | null => {
    let cCount = 0, dCount = 0;
    for (const a of addrs) {
      if (b.challengerContributors.includes(a) || b.creator === a) cCount++;
      if (b.defenderContributors.includes(a)) dCount++;
    }
    if (cCount > 0 && cCount >= dCount) return "challenger";
    if (dCount > 0) return "defender";
    return null;
  };

  // onlyWithAddress: restrict to battles where at least one target address is present
  let addrFiltered = filtered;
  if (onlyWithAddrs.length > 0) {
    console.log(`  🔍 onlyWithAddress targets: [${onlyWithAddrs.join(", ")}]`);
    console.log(`  🔍 filtered battles (${filtered.length}):`);
    for (const b of filtered) {
      console.log(`    battle #${b.battleId}: creator=${b.creator}, challengers=[${b.challengerContributors.join(",")}], defenders=[${b.defenderContributors.join(",")}]`);
    }
    addrFiltered = filtered.filter(b => hasAddrInBattle(b, onlyWithAddrs));
    if (addrFiltered.length === 0) {
      console.log(`  ⏭️ onlyWithAddress=[${onlyWithAddrs.join(",")}] 不在任何对战中，跳过`);
      return null;
    }
  }

  // Combine all address-based side preferences (followAddress + onlyWithAddress)
  const allSideAddrs = [...followAddrs, ...onlyWithAddrs];

  // If we have any address-based side preference, try to match first
  if (allSideAddrs.length > 0) {
    // Within the (possibly restricted) battle list, prioritize battles with target addresses
    const addrBattles = addrFiltered.filter(b => hasAddrInBattle(b, allSideAddrs));
    for (const battle of addrBattles) {
      if (battle.betPerSlot > spirit.strategy.maxBattleBet) {
        console.log(`  ⚠️ 目标地址对战 #${battle.battleId} betPerSlot=${battle.betPerSlot} > maxBattleBet=${spirit.strategy.maxBattleBet}，跳过`);
        continue;
      }
      const challengerSlots = 3 - battle.challengerCount;
      const defenderSlots = 3 - battle.defenderCount;
      const ownerOnChallenger = battle.challengerContributors.includes(ownerLower) || battle.creator === ownerLower;
      const ownerOnDefender = battle.defenderContributors.includes(ownerLower);

      const side = findAddrSide(battle, allSideAddrs);
      if (side === "challenger" && challengerSlots > 0 && !ownerOnDefender) {
        return { battleId: battle.battleId, side: "challenger" as const };
      }
      if (side === "defender" && defenderSlots > 0 && !ownerOnChallenger) {
        return { battleId: battle.battleId, side: "defender" as const };
      }
    }
    // If onlyWithAddress is set, don't fallback — target addresses exist but no slots
    if (onlyWithAddrs.length > 0) return null;
    // followAddress only: fall through to normal selection
  }

  for (const battle of filtered) {
    if (battle.betPerSlot > spirit.strategy.maxBattleBet) continue;

    const challengerSlots = 3 - battle.challengerCount;
    const defenderSlots = 3 - battle.defenderCount;

    const ownerOnChallenger = battle.challengerContributors.includes(ownerLower) || battle.creator === ownerLower;
    const ownerOnDefender = battle.defenderContributors.includes(ownerLower);

    let canJoinChallenger = challengerSlots > 0 && !ownerOnDefender;
    let canJoinDefender = defenderSlots > 0 && !ownerOnChallenger;

    // Apply side preference
    if (onlyChallenger) canJoinDefender = false;
    if (onlyDefender) canJoinChallenger = false;

    if (spirit.strategy.riskLevel === 0) {
      if (canJoinDefender) return { battleId: battle.battleId, side: "defender" };
      if (canJoinChallenger && onlyChallenger) return { battleId: battle.battleId, side: "challenger" };
    } else if (spirit.strategy.riskLevel === 1) {
      if (canJoinDefender) return { battleId: battle.battleId, side: "defender" };
      if (canJoinChallenger && onlyChallenger) return { battleId: battle.battleId, side: "challenger" };
    } else {
      if (canJoinChallenger) return { battleId: battle.battleId, side: "challenger" };
      else if (canJoinDefender) return { battleId: battle.battleId, side: "defender" };
    }
  }
  return null;
}

function decideBet(
  spirit: Spirit,
  battle: BettingBattle,
  preferences?: SpiritPreferences | null
): { betOnChallenger: boolean; amount: bigint } | null {
  if (!spirit.strategy.autoBetEnabled) return null;

  const now = Math.floor(Date.now() / 1000);
  if (battle.bettingEndsAt - now < 30) return null;

  const maxBet = spirit.strategy.maxBetAmount;
  if (maxBet === 0n) return null;

  const cPool = battle.challengerBetPool;
  const dPool = battle.defenderBetPool;

  // Apply bet preferences if available
  if (preferences && preferences.betPreferences.length > 0) {
    const totalPool = cPool + dPool;

    for (const pref of preferences.betPreferences) {
      if (pref.type === "preferMismatch") {
        // Skip balanced battles — only bet if pool ratio > 2:1
        if (totalPool > 0n && cPool > 0n && dPool > 0n) {
          const ratio = cPool > dPool ? cPool * 100n / dPool : dPool * 100n / cPool;
          if (ratio < 200n) return null;
        }
      } else if (pref.type === "preferBalanced") {
        // Skip mismatched battles — only bet if pool ratio < 2:1
        if (totalPool > 0n && cPool > 0n && dPool > 0n) {
          const ratio = cPool > dPool ? cPool * 100n / dPool : dPool * 100n / cPool;
          if (ratio > 200n) return null;
        }
      } else if (pref.type === "preferChallenger") {
        const fraction = spirit.strategy.riskLevel === 0 ? 4n : spirit.strategy.riskLevel === 1 ? 2n : 1n;
        const amount = maxBet / fraction;
        if (amount === 0n) return null;
        return { betOnChallenger: true, amount };
      } else if (pref.type === "preferDefender") {
        const fraction = spirit.strategy.riskLevel === 0 ? 4n : spirit.strategy.riskLevel === 1 ? 2n : 1n;
        const amount = maxBet / fraction;
        if (amount === 0n) return null;
        return { betOnChallenger: false, amount };
      } else if (pref.type === "preferUnderdog") {
        // 以小搏大：下注池子少的一方（弱势方），获得更高赔率
        if (cPool > 0n && dPool > 0n) {
          const fraction = spirit.strategy.riskLevel === 0 ? 4n : spirit.strategy.riskLevel === 1 ? 2n : 1n;
          const amount = maxBet / fraction;
          if (amount === 0n) return null;
          // 押池子少的一方
          const betOnChallenger = cPool < dPool;
          return { betOnChallenger, amount };
        }
      } else if (pref.type === "minPoolRatio") {
        const minRatio = BigInt(Math.floor((pref.value ?? 1) * 100));
        if (totalPool > 0n && cPool > 0n && dPool > 0n) {
          const ratio = cPool > dPool ? cPool * 100n / dPool : dPool * 100n / cPool;
          if (ratio < minRatio) return null;
        }
      } else if (pref.type === "maxPoolRatio") {
        const maxRatio = BigInt(Math.floor((pref.value ?? 10) * 100));
        if (totalPool > 0n && cPool > 0n && dPool > 0n) {
          const ratio = cPool > dPool ? cPool * 100n / dPool : dPool * 100n / cPool;
          if (ratio > maxRatio) return null;
        }
      }
    }
  }

  let betOnChallenger: boolean;

  if (spirit.strategy.riskLevel === 0) {
    betOnChallenger = cPool >= dPool;
  } else if (spirit.strategy.riskLevel === 1) {
    if (cPool > 0n && dPool > 0n) {
      betOnChallenger = dPool > cPool * 2n ? true : cPool > dPool * 2n ? false : cPool <= dPool;
    } else {
      betOnChallenger = dPool > cPool;
    }
  } else {
    betOnChallenger = cPool < dPool;
  }

  const fraction = spirit.strategy.riskLevel === 0 ? 4n : spirit.strategy.riskLevel === 1 ? 2n : 1n;
  const amount = maxBet / fraction;
  if (amount === 0n) return null;

  return { betOnChallenger, amount };
}

// ============ Action Execution ============

async function executeJoinBattle(
  spirit: Spirit,
  battleId: bigint,
  side: "challenger" | "defender",
  betPerSlot: bigint,
  walletClient: any,
  publicClient: any,
): Promise<ActionResult> {
  const nftIds = [spirit.tokenId];
  const params = encodeAbiParameters(
    parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
    [nftIds, betPerSlot, false, battleId, side === "challenger"]
  );
  const actionData = concatHex([ACTION_AUTO_BATTLE, params]);

  try {
    console.log(`  TX: joining battle #${battleId} as ${side}, betPerSlot=${betPerSlot}`);
    const hash = await walletClient.writeContract({
      address: SPIRIT_AGENT_ADDRESS,
      abi: SPIRIT_AGENT_ABI,
      functionName: "executeAction",
      args: [spirit.tokenId, actionData],
    });
    console.log(`  TX submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status === "reverted") {
      console.error(`  TX reverted in block ${receipt.blockNumber}`);
      return { tokenId: spirit.tokenId.toString(), action: `join-${side}`, success: false, error: "Transaction reverted on-chain" };
    }
    console.log(`  TX confirmed in block ${receipt.blockNumber}`);
    return { tokenId: spirit.tokenId.toString(), action: `join-${side}`, success: true };
  } catch (e: any) {
    console.error(`  TX failed: ${e.shortMessage || e.message}`);
    return { tokenId: spirit.tokenId.toString(), action: `join-${side}`, success: false, error: e.shortMessage || e.message };
  }
}

async function executeCreateBattle(
  spirit: Spirit,
  betPerSlot: bigint,
  walletClient: any,
  publicClient: any,
): Promise<ActionResult> {
  const nftIds = [spirit.tokenId];
  const params = encodeAbiParameters(
    parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
    [nftIds, betPerSlot, true, 0n, false] // isCreate=true, battleId=0 (ignored), joinChallenger=false (ignored)
  );
  const actionData = concatHex([ACTION_AUTO_BATTLE, params]);

  try {
    console.log(`  TX: creating battle, betPerSlot=${formatUnits(betPerSlot, 18)} QLWY`);
    const hash = await walletClient.writeContract({
      address: SPIRIT_AGENT_ADDRESS,
      abi: SPIRIT_AGENT_ABI,
      functionName: "executeAction",
      args: [spirit.tokenId, actionData],
    });
    console.log(`  TX submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status === "reverted") {
      console.error(`  TX reverted in block ${receipt.blockNumber}`);
      return { tokenId: spirit.tokenId.toString(), action: "create-battle", success: false, error: "Transaction reverted on-chain" };
    }
    console.log(`  ✅ Battle created in block ${receipt.blockNumber}`);
    return { tokenId: spirit.tokenId.toString(), action: "create-battle", success: true };
  } catch (e: any) {
    console.error(`  TX failed: ${e.shortMessage || e.message}`);
    return { tokenId: spirit.tokenId.toString(), action: "create-battle", success: false, error: e.shortMessage || e.message };
  }
}

async function executePlaceBet(
  spirit: Spirit,
  battleId: bigint,
  betOnChallenger: boolean,
  amount: bigint,
  walletClient: any,
  publicClient: any,
): Promise<ActionResult> {
  const params = encodeAbiParameters(
    parseAbiParameters("uint256, bool, uint256"),
    [battleId, betOnChallenger, amount]
  );
  const actionData = concatHex([ACTION_AUTO_BET, params]);

  try {
    console.log(`  TX: betting ${amount} on battle #${battleId}, challenger=${betOnChallenger}`);
    const hash = await walletClient.writeContract({
      address: SPIRIT_AGENT_ADDRESS,
      abi: SPIRIT_AGENT_ABI,
      functionName: "executeAction",
      args: [spirit.tokenId, actionData],
    });
    console.log(`  TX submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status === "reverted") {
      console.error(`  TX reverted in block ${receipt.blockNumber}`);
      return { tokenId: spirit.tokenId.toString(), action: "bet", success: false, error: "Transaction reverted on-chain" };
    }
    console.log(`  TX confirmed in block ${receipt.blockNumber}`);
    return { tokenId: spirit.tokenId.toString(), action: "bet", success: true };
  } catch (e: any) {
    console.error(`  TX failed: ${e.shortMessage || e.message}`);
    return { tokenId: spirit.tokenId.toString(), action: "bet", success: false, error: e.shortMessage || e.message };
  }
}

async function executeClaimWinnings(
  spirit: Spirit,
  battleId: bigint,
  walletClient: any,
  publicClient: any,
): Promise<ActionResult> {
  const params = encodeAbiParameters(
    parseAbiParameters("uint256"),
    [battleId]
  );
  const actionData = concatHex([ACTION_CLAIM_WINNINGS, params]);

  try {
    console.log(`  TX: claiming winnings from battle #${battleId}`);
    const hash = await walletClient.writeContract({
      address: SPIRIT_AGENT_ADDRESS,
      abi: SPIRIT_AGENT_ABI,
      functionName: "executeAction",
      args: [spirit.tokenId, actionData],
    });
    console.log(`  TX submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });
    if (receipt.status === "reverted") {
      console.error(`  TX reverted in block ${receipt.blockNumber}`);
      return { tokenId: spirit.tokenId.toString(), action: "claim", success: false, error: "Transaction reverted on-chain" };
    }
    console.log(`  TX confirmed in block ${receipt.blockNumber}`);
    return { tokenId: spirit.tokenId.toString(), action: "claim", success: true };
  } catch (e: any) {
    console.error(`  TX failed: ${e.shortMessage || e.message}`);
    return { tokenId: spirit.tokenId.toString(), action: "claim", success: false, error: e.shortMessage || e.message };
  }
}

// ============ Main ============

async function runOnce() {
  console.log("\n=== Spirit Worker Run ===", new Date().toISOString());

  if (!OPERATOR_PRIVATE_KEY) {
    console.error("OPERATOR_PRIVATE_KEY not set");
    process.exit(1);
  }
  if (!SPIRIT_AGENT_ADDRESS || !BATTLE_V2_ADDRESS) {
    console.error("Contract addresses not configured");
    process.exit(1);
  }

  const account = privateKeyToAccount(OPERATOR_PRIVATE_KEY as Hex);
  console.log(`Operator: ${account.address}`);

  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain: bsc,
    transport: http(RPC_URL),
  });

  const results: ActionResult[] = [];

  // Fetch all data in parallel
  const [spiritData, openBattles, bettingBattles, resolvedBattles, nftsInBattle, minBetPerSlot] = await Promise.all([
    fetchActiveSpirits(publicClient),
    fetchOpenBattles(),
    fetchBettingBattles(),
    fetchResolvedBattles(),
    fetchNftsInActiveBattles(),
    publicClient.readContract({
      address: BATTLE_V2_ADDRESS,
      abi: BATTLE_V2_ABI,
      functionName: "minBetPerSlot",
    }) as Promise<bigint>,
  ]);

  const { spirits, stats } = spiritData;
  const riskLabels = ["保守", "均衡", "激进"];

  // Print global spirit stats
  console.log(`\n📊 签灵全局统计：`);
  console.log(`  总签灵数: ${stats.total}`);
  console.log(`  自动对战: ${stats.autoBattle}  |  自动下注: ${stats.autoBet}  |  自动抽签: ${stats.autoCast}`);
  console.log(`  策略分布: ${riskLabels[0]}=${stats.riskConservative}  ${riskLabels[1]}=${stats.riskBalanced}  ${riskLabels[2]}=${stats.riskAggressive}`);
  console.log(`  本轮可执行: ${spirits.length} (开启了自动对战或自动下注)`);
  console.log(`\n📋 对战概况: FILLING=${openBattles.length}, BETTING=${bettingBattles.length}, RESOLVED=${resolvedBattles.length}, NFTs在战=${nftsInBattle.size}, minBetPerSlot=${formatUnits(minBetPerSlot, 18)}`);

  if (spirits.length === 0) {
    console.log("No actionable spirits found.");
    return;
  }

  // Process each spirit
  for (const spirit of spirits) {
    const alreadyInBattle = nftsInBattle.has(spirit.tokenId.toString());

    // Fetch spirit preferences (memory) from KV
    const preferences = await getSpiritPreferences(spirit.tokenId.toString());
    const hasPrefs = preferences && (preferences.battleFilters.length > 0 || preferences.betPreferences.length > 0);
    console.log(`\nSpirit #${spirit.tokenId}: autoBattle=${spirit.strategy.autoBattleEnabled}, autoBet=${spirit.strategy.autoBetEnabled}, riskLevel=${spirit.strategy.riskLevel}, maxBattleBet=${formatUnits(spirit.strategy.maxBattleBet, 18)}, maxBetAmount=${formatUnits(spirit.strategy.maxBetAmount, 18)}, inBattle=${alreadyInBattle}, prefs=${hasPrefs ? `${preferences!.battleFilters.length}bf+${preferences!.betPreferences.length}bp` : "none"}`);

    // --- 1. Auto-Battle ---
    if (spirit.strategy.autoBattleEnabled && !alreadyInBattle) {
      // Re-fetch open battles each time so newly created battles are visible
      const latestOpenBattles = await fetchOpenBattles();
      const joinDecision = decideBattleJoin(spirit, latestOpenBattles, preferences);
      if (joinDecision) {
        const battle = latestOpenBattles.find((b) => b.battleId === joinDecision.battleId);
        if (battle) {
          // Pre-check QLWY allowance (betPerSlot * 1 NFT)
          const requiredForJoin = battle.betPerSlot;
          const canJoin = await checkTokenAllowance(spirit.owner as Address, requiredForJoin, `join-battle #${joinDecision.battleId}`, publicClient);
          if (!canJoin) {
            console.log(`  ⏭️ 跳过加入对战 #${joinDecision.battleId}：授权/余额不足`);
            results.push({ tokenId: spirit.tokenId.toString(), action: `join-${joinDecision.side}`, success: false, error: "Insufficient allowance/balance (pre-check)" });
          } else {
          const result = await executeJoinBattle(
            spirit, joinDecision.battleId, joinDecision.side, battle.betPerSlot, walletClient, publicClient
          );
          results.push(result);
          if (result.success) {
            if (joinDecision.side === "challenger") {
              battle.challengerCount++;
              battle.challengerContributors.push(spirit.owner.toLowerCase());
            } else {
              battle.defenderCount++;
              battle.defenderContributors.push(spirit.owner.toLowerCase());
            }
            nftsInBattle.add(spirit.tokenId.toString());
          }
          } // end canJoin else
        }
      } else {
        // If onlyWithAddress is set, do NOT auto-create — the spirit is waiting for specific addresses
        const hasOnlyWith = preferences?.battleFilters.some(f => f.type === "onlyWithAddress") ?? false;
        // Check if should auto-create: riskLevel===2 (aggressive) OR autoCreateAfterBattle preference OR onlyCreateBattle
        const hasAutoCreate = preferences?.betPreferences.some(p => p.type === "autoCreateAfterBattle") ?? false;
        const hasOnlyCreate = preferences?.battleFilters.some(f => f.type === "onlyCreateBattle") ?? false;
        if (!hasOnlyWith && (spirit.strategy.riskLevel === 2 || hasAutoCreate || hasOnlyCreate)) {
          // Auto-create a battle when no suitable one exists
          // Use minBetPerSlot to minimize cost; skip if spirit's maxBattleBet is too low
          if (spirit.strategy.maxBattleBet < minBetPerSlot) {
            console.log(`  ⏭️ 跳过创建对战：maxBattleBet(${formatUnits(spirit.strategy.maxBattleBet, 18)}) < minBetPerSlot(${formatUnits(minBetPerSlot, 18)})`);
            results.push({ tokenId: spirit.tokenId.toString(), action: "create-battle", success: false, error: "maxBattleBet below minBetPerSlot" });
          } else {
            const canCreate = await checkTokenAllowance(spirit.owner as Address, minBetPerSlot, "create-battle", publicClient);
            if (!canCreate) {
              console.log("  ⏭️ 跳过创建对战：授权/余额不足");
              results.push({ tokenId: spirit.tokenId.toString(), action: "create-battle", success: false, error: "Insufficient allowance/balance (pre-check)" });
            } else {
              console.log(`  🏗️ 自动创建对战${hasAutoCreate ? "（autoCreateAfterBattle偏好）" : "（激进策略）"}`);
              const result = await executeCreateBattle(spirit, minBetPerSlot, walletClient, publicClient);
              results.push(result);
              if (result.success) {
                nftsInBattle.add(spirit.tokenId.toString());
              }
            }
          }
        } else if (hasOnlyWith) {
          console.log("  ⏸️ onlyWithAddress 目标不在对战中，跳过创建，等待目标出现");
        } else {
          console.log("  No suitable battle found");
        }
      }
    }

    // --- 2. Auto-Bet ---
    if (spirit.strategy.autoBetEnabled) {
      for (const battle of bettingBattles) {
        // Check if already bet
        const betsData = await querySubgraph<{
          userBetV2S: Array<{ betOnChallenger: string; betOnDefender: string; claimed: boolean }>;
        }>(USER_BETS_QUERY, {
          battleId: battle.battleId.toString(),
          user: spirit.owner.toLowerCase(),
        });
        const userBet = betsData?.userBetV2S?.[0];
        if (userBet && (BigInt(userBet.betOnChallenger) > 0n || BigInt(userBet.betOnDefender) > 0n)) continue;

        const betDecision = decideBet(spirit, battle, preferences);
        if (betDecision) {
          // Pre-check QLWY allowance
          const canBet = await checkTokenAllowance(spirit.owner as Address, betDecision.amount, `bet-battle #${battle.battleId}`, publicClient);
          if (!canBet) {
            console.log(`  ⏭️ 跳过下注对战 #${battle.battleId}：授权/余额不足`);
            results.push({ tokenId: spirit.tokenId.toString(), action: "bet", success: false, error: "Insufficient allowance/balance (pre-check)" });
            break;
          }
          const result = await executePlaceBet(
            spirit, battle.battleId, betDecision.betOnChallenger, betDecision.amount, walletClient, publicClient
          );
          results.push(result);
          break; // One bet per spirit per cycle
        }
      }
    }

    // --- 3. Claim Winnings ---
    for (const battle of resolvedBattles) {
      const betsData = await querySubgraph<{
        userBetV2S: Array<{ betOnChallenger: string; betOnDefender: string; claimed: boolean }>;
      }>(USER_BETS_QUERY, {
        battleId: battle.battleId.toString(),
        user: spirit.owner.toLowerCase(),
      });
      const userBet = betsData?.userBetV2S?.[0];
      if (!userBet || userBet.claimed || (BigInt(userBet.betOnChallenger) === 0n && BigInt(userBet.betOnDefender) === 0n)) continue;

      const result = await executeClaimWinnings(spirit, battle.battleId, walletClient, publicClient);
      results.push(result);
    }
  }

  // Summary
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  console.log(`\n=== Done: ${succeeded} succeeded, ${failed} failed out of ${results.length} actions ===`);
  for (const r of results) {
    console.log(`  #${r.tokenId} ${r.action}: ${r.success ? "✓" : `✗ ${r.error}`}`);
  }
}

async function main() {
  if (LOOP_INTERVAL_MS > 0) {
    console.log(`Running in loop mode, interval=${LOOP_INTERVAL_MS}ms`);
    while (true) {
      try {
        await runOnce();
      } catch (e: any) {
        console.error("Run failed:", e.message || e);
      }
      await new Promise((resolve) => setTimeout(resolve, LOOP_INTERVAL_MS));
    }
  } else {
    await runOnce();
  }
}

main().catch((error) => {
  console.error("Spirit Worker fatal error:", error);
  process.exit(1);
});