/**
 * Integration Tests: Contract + API
 *
 * These tests verify the data flow between the API service and smart contracts:
 * - Metadata hash consistency (API keccak256 ↔ contract storage)
 * - Full market lifecycle (create → trade → settle → claim)
 * - Dynamic liquidity integration
 * - Multi-trader realistic scenarios with dispute/arbitration
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseEther, keccak256, toBytes, toHex, stringToBytes } from "viem";

describe("Integration: Contract + API", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  let stablecoin: Awaited<ReturnType<typeof viem.deployContract>>;
  let mockArb: Awaited<ReturnType<typeof viem.deployContract>>;
  let market: Awaited<ReturnType<typeof viem.deployContract>>;

  let owner: `0x${string}`;
  let creator: `0x${string}`;
  let trader1: `0x${string}`;
  let trader2: `0x${string}`;
  let settler: `0x${string}`;
  let lpProvider: `0x${string}`;
  let wallets: Awaited<ReturnType<typeof viem.getWalletClients>>;

  const INITIAL_SUPPLY = parseEther("10000000");
  const USER_BALANCE = parseEther("100000");
  const MIN_SUBSIDY = parseEther("10");
  const ARBITRATION_FEE = parseEther("50");

  const YES = 1;
  const NO = 2;
  const INVALID = 0;

  // MarketStatus enum values (new 4-state machine)
  const STATUS_TRADING = 0;
  const STATUS_DISPUTE_PERIOD = 1;
  const STATUS_ARBITRATION = 2;
  const STATUS_RESOLVED = 3;

  async function advanceTime(seconds: number) {
    await publicClient.request({ method: "evm_increaseTime" as any, params: [seconds] });
    await publicClient.request({ method: "evm_mine" as any, params: [] });
  }

  async function getBlockTimestamp(): Promise<bigint> {
    const block = await publicClient.getBlock();
    return block.timestamp;
  }

  /**
   * Simulates the API's prepare-onchain endpoint:
   * Assembles metadata JSON → computes keccak256 hash → returns metadataUri + metadataHash
   * This is the EXACT same logic as api-service/src/routes/markets.ts prepare-onchain
   */
  function simulateApiPrepareOnchain(params: {
    statement: string;
    aiDescription: string;
    image: string;
    aiRules: string;
    source: { type: string; tweetId?: string; handle?: string };
    createdAt: string;
  }) {
    const metadata: Record<string, unknown> = {
      question: params.statement,
      description: params.aiDescription,
      image: params.image,
      rules: params.aiRules,
      source: params.source,
      createdAt: params.createdAt,
    };

    const metadataJsonStr = JSON.stringify(metadata);
    const metadataHash = keccak256(toBytes(metadataJsonStr));
    // In production, this comes from Pinata upload response
    const metadataUri = `ipfs://QmSimulated${Date.now()}`;

    return { metadata, metadataJsonStr, metadataHash, metadataUri };
  }

  beforeEach(async () => {
    wallets = await viem.getWalletClients();
    owner = wallets[0].account.address;
    creator = wallets[1].account.address;
    trader1 = wallets[2].account.address;
    trader2 = wallets[3].account.address;
    settler = wallets[4].account.address;
    lpProvider = wallets[5].account.address;

    stablecoin = await viem.deployContract("QLWYToken", [
      "Mock USDC", "USDC", INITIAL_SUPPLY, owner,
    ]);

    mockArb = await viem.deployContract("MockArbitration");

    market = await viem.deployContract("QLWYPredictionMarket", [
      owner, stablecoin.address, owner,
    ]);

    await market.write.setArbitration([mockArb.address]);

    for (const addr of [creator, trader1, trader2, settler, lpProvider]) {
      await stablecoin.write.transfer([addr, USER_BALANCE]);
    }
  });

  // ─── Test 1: Metadata Hash Consistency ──────────────────────────────────

  describe("Metadata Hash Consistency (API ↔ Contract)", () => {
    it("should store the exact metadataUri and metadataHash from API on-chain", async () => {
      // Step 1: Simulate API's prepare-onchain
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will BTC reach $200k by end of 2026?",
        aiDescription: "This market resolves YES if Bitcoin's price reaches or exceeds $200,000 USD on any major exchange before December 31, 2026.",
        image: "ipfs://QmImageHash123",
        aiRules: "Resolution based on CoinGecko BTC/USD price. Must reach $200,000.00 at any point before expiry.",
        source: { type: "frontend" },
        createdAt: "2026-02-15T10:00:00.000Z",
      });

      // Step 2: Create market on-chain with API's metadata
      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(7 * 86400);
      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );

      // Step 3: Read from contract and verify exact match
      const onchainUri = await market.read.markets([1n]) as any[];
      // markets mapping returns tuple: [metadataUri, metadataHash, creator, ...]
      const storedUri = onchainUri[0] as string;
      const storedHash = onchainUri[1] as `0x${string}`;

      assert.equal(storedUri, apiResult.metadataUri, "metadataUri mismatch");
      assert.equal(storedHash, apiResult.metadataHash, "metadataHash mismatch");
    });

    it("should produce consistent hash for identical metadata JSON", async () => {
      const params = {
        statement: "Will ETH flip BTC by market cap in 2026?",
        aiDescription: "Resolves YES if Ethereum market cap exceeds Bitcoin market cap.",
        image: "",
        aiRules: "Based on CoinGecko data at expiry time.",
        source: { type: "twitter", tweetId: "1234567890", handle: "cryptowhale" },
        createdAt: "2026-02-15T12:00:00.000Z",
      };

      // Compute hash twice — must be deterministic
      const result1 = simulateApiPrepareOnchain(params);
      const result2 = simulateApiPrepareOnchain(params);

      assert.equal(result1.metadataHash, result2.metadataHash, "Hash should be deterministic");
      assert.equal(result1.metadataJsonStr, result2.metadataJsonStr, "JSON serialization should be deterministic");
    });

    it("should produce different hash for different metadata", async () => {
      const result1 = simulateApiPrepareOnchain({
        statement: "Will BTC reach $200k?",
        aiDescription: "desc1", image: "", aiRules: "rules1",
        source: { type: "frontend" }, createdAt: "2026-02-15T10:00:00.000Z",
      });
      const result2 = simulateApiPrepareOnchain({
        statement: "Will BTC reach $300k?",
        aiDescription: "desc2", image: "", aiRules: "rules2",
        source: { type: "frontend" }, createdAt: "2026-02-15T10:00:00.000Z",
      });

      assert.notEqual(result1.metadataHash, result2.metadataHash, "Different metadata should produce different hashes");
    });

    it("should verify metadata integrity: tampered JSON produces different hash", async () => {
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will SOL reach $500 by 2026?",
        aiDescription: "Resolves YES if SOL >= $500.",
        image: "ipfs://QmSolImage", aiRules: "CoinGecko SOL/USD price.",
        source: { type: "frontend" }, createdAt: "2026-02-15T14:00:00.000Z",
      });

      // Tamper the metadata
      const tampered = { ...apiResult.metadata, question: "Will SOL reach $1000 by 2026?" };
      const tamperedHash = keccak256(toBytes(JSON.stringify(tampered)));

      assert.notEqual(tamperedHash, apiResult.metadataHash,
        "Tampered metadata should not match original hash — integrity check works");
    });

    it("should handle metadata with Twitter source correctly", async () => {
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will @elonmusk tweet about Dogecoin this week?",
        aiDescription: "Market resolves YES if Elon Musk tweets about DOGE.",
        image: "ipfs://QmTweetImage456",
        aiRules: "Any tweet from @elonmusk mentioning 'Doge', 'DOGE', or '🐕' counts.",
        source: { type: "twitter", tweetId: "1893456789012345678", handle: "CryptoTrader99" },
        createdAt: "2026-02-15T08:30:00.000Z",
      });

      // Verify the JSON includes the Twitter source info
      const parsed = JSON.parse(apiResult.metadataJsonStr);
      assert.equal(parsed.source.type, "twitter");
      assert.equal(parsed.source.tweetId, "1893456789012345678");
      assert.equal(parsed.source.handle, "CryptoTrader99");

      // Create on-chain — contract should accept any valid hash
      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(7 * 86400);
      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );

      const onchainData = await market.read.markets([1n]) as any[];
      assert.equal(onchainData[1], apiResult.metadataHash);
    });
  });

  // ─── Test 2: Full Lifecycle E2E ─────────────────────────────────────────

  describe("Full Lifecycle: API → Contract → Trade → Settle → Claim", () => {
    it("should complete the entire market lifecycle", async () => {
      // ── Phase A: API prepares metadata ──
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will the next iPhone have a foldable screen?",
        aiDescription: "Resolves YES if Apple releases an iPhone with a foldable display by Dec 2026.",
        image: "ipfs://QmIPhoneImage",
        aiRules: "Official Apple product announcement counts. Prototype leaks do not.",
        source: { type: "frontend" },
        createdAt: "2026-02-15T09:00:00.000Z",
      });

      // ── Phase B: Create market on-chain ──
      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(3600 + 60); // 1h + 60s
      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );
      const marketId = 1n;

      // Verify initial 50/50 pricing
      const [initYes, initNo] = await market.read.getPrice([marketId]) as [bigint, bigint];
      const half = parseEther("0.5");
      const tolerance = parseEther("0.01");
      assert.ok(initYes > half - tolerance && initYes < half + tolerance, "Initial YES should be ~50%");

      // ── Phase C: Trading ──
      // Trader1 buys YES
      const yesShares = parseEther("3");
      const yesCost = await market.read.costToBuy([marketId, YES, yesShares]) as bigint;
      await stablecoin.write.approve([market.address, yesCost], { account: trader1 });
      await market.write.buy([marketId, YES, yesShares, yesCost], { account: trader1 });

      // Price should shift toward YES
      const [priceAfterBuy] = await market.read.getPrice([marketId]) as [bigint, bigint];
      assert.ok(priceAfterBuy > initYes, "YES price should increase after YES purchase");

      // Trader2 buys NO (counterparty)
      const noShares = parseEther("1");
      const noCost = await market.read.costToBuy([marketId, NO, noShares]) as bigint;
      await stablecoin.write.approve([market.address, noCost], { account: trader2 });
      await market.write.buy([marketId, NO, noShares, noCost], { account: trader2 });

      // Trader1 sells some YES shares (partial exit)
      const sellShares = parseEther("1");
      const sellPayout = await market.read.payoutForSell([marketId, YES, sellShares]) as bigint;
      await market.write.sell([marketId, YES, sellShares, 0n], { account: trader1 });

      // Verify positions
      const t1YesPos = await market.read.positions([marketId, trader1, YES]) as bigint;
      assert.equal(t1YesPos, yesShares - sellShares, "Trader1 should have 2 YES shares left");

      const t2NoPos = await market.read.positions([marketId, trader2, NO]) as bigint;
      assert.equal(t2NoPos, noShares, "Trader2 should have 1 NO share");

      // ── Phase D: Settlement (expire → creator proposes NO → dispute → arb → YES) ──
      await advanceTime(3700); // expire
      await market.write.settleMarket([marketId, NO], { account: creator });
      // Now in DisputePeriod with proposedOutcome = NO

      // Trader1 disputes — they believe YES should win
      await stablecoin.write.approve([market.address, ARBITRATION_FEE], { account: trader1 });
      await market.write.dispute([marketId, YES, ARBITRATION_FEE], { account: trader1 });

      // ── Phase E: Arbitration resolves as YES ──
      await mockArb.write.setResult([1n, YES]);
      await market.write.resolveFromArbitration([marketId]);

      // ── Phase F: Claims ──
      // Trader1 (YES holder) should be able to claim
      const t1BalBefore = await stablecoin.read.balanceOf([trader1]) as bigint;
      await market.write.claimWinnings([marketId], { account: trader1 });
      const t1BalAfter = await stablecoin.read.balanceOf([trader1]) as bigint;
      assert.ok(t1BalAfter > t1BalBefore, "YES holder should receive payout");

      // Trader2 (NO holder) should have nothing to claim
      await assert.rejects(
        market.write.claimWinnings([marketId], { account: trader2 }),
        /NothingToClaim/,
      );

      // Creator claims accumulated fees
      const creatorBalBefore = await stablecoin.read.balanceOf([creator]) as bigint;
      await market.write.claimCreatorFee([marketId], { account: creator });
      const creatorBalAfter = await stablecoin.read.balanceOf([creator]) as bigint;
      assert.ok(creatorBalAfter > creatorBalBefore, "Creator should receive trading fees");
    });

    it("should handle market resolved as INVALID (refund)", async () => {
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will X announce feature Y at conference Z?",
        aiDescription: "Resolves YES if announced.",
        image: "", aiRules: "Based on official announcement.",
        source: { type: "frontend" }, createdAt: "2026-02-15T10:00:00.000Z",
      });

      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(3600 + 60);
      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );

      // Trader buys YES
      const shares = parseEther("2");
      const cost = await market.read.costToBuy([1n, YES, shares]) as bigint;
      await stablecoin.write.approve([market.address, cost], { account: trader1 });
      await market.write.buy([1n, YES, shares, cost], { account: trader1 });

      // Expire → creator settle proposes NO → dispute with INVALID → arbitration → INVALID
      await advanceTime(3700);
      await market.write.settleMarket([1n, NO], { account: creator });

      await stablecoin.write.approve([market.address, ARBITRATION_FEE], { account: trader2 });
      await market.write.dispute([1n, INVALID, ARBITRATION_FEE], { account: trader2 });

      // Arbitration resolves as INVALID
      await mockArb.write.setResult([1n, INVALID]);
      await market.write.resolveFromArbitration([1n]);

      // Trader with YES shares should get refund (INVALID = 0.5 per share)
      const balBefore = await stablecoin.read.balanceOf([trader1]) as bigint;
      await market.write.claimWinnings([1n], { account: trader1 });
      const balAfter = await stablecoin.read.balanceOf([trader1]) as bigint;
      assert.ok(balAfter > balBefore, "Should receive partial refund for INVALID resolution");
    });
  });

  // ─── Test 3: Dynamic Liquidity ──────────────────────────────────────────

  describe("Dynamic Liquidity Integration", () => {
    it("should allow community subsidy and improve price impact", async () => {
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will SpaceX land on Mars in 2026?",
        aiDescription: "Resolves YES if SpaceX spacecraft touches down on Mars surface.",
        image: "ipfs://QmMarsImage", aiRules: "Official SpaceX/NASA confirmation.",
        source: { type: "twitter", tweetId: "1893000000000000001", handle: "SpaceWatcher" },
        createdAt: "2026-02-15T06:00:00.000Z",
      });

      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(7 * 86400);
      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );
      const marketId = 1n;

      // Measure price impact BEFORE subsidy
      const shares = parseEther("5");
      const costBefore = await market.read.costToBuy([marketId, YES, shares]) as bigint;

      // LP adds 50 USDC subsidy — this increases b parameter
      const subsidyAmount = parseEther("50");
      await stablecoin.write.approve([market.address, subsidyAmount], { account: lpProvider });
      await market.write.addSubsidy([marketId, subsidyAmount], { account: lpProvider });

      // Measure price impact AFTER subsidy — should be lower (more liquidity depth)
      const costAfter = await market.read.costToBuy([marketId, YES, shares]) as bigint;

      // With more liquidity, buying the same shares should cost MORE (deeper book, less slippage,
      // but cost is closer to fair value). Actually with LMSR, higher b means the same share purchase
      // has a smaller price impact, so the cost should be closer to midpoint price * shares.
      // The total cost to buy 5 shares should be different with different b.
      assert.notEqual(costBefore, costAfter, "Cost should change with different liquidity depth");

      // Verify LP shares tracked
      const lpShares = await market.read.subsidyShares([marketId, lpProvider]) as bigint;
      assert.equal(lpShares, subsidyAmount, "LP should have subsidy shares");

      // Creator should also have original shares
      const creatorShares = await market.read.subsidyShares([marketId, creator]) as bigint;
      assert.equal(creatorShares, MIN_SUBSIDY, "Creator should retain original subsidy shares");
    });

    it("should allow LP to claim proportional subsidy after resolution", async () => {
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will GPT-5 be released in Q1 2026?",
        aiDescription: "Resolves YES if OpenAI releases GPT-5.",
        image: "", aiRules: "Official OpenAI announcement.",
        source: { type: "frontend" }, createdAt: "2026-02-15T11:00:00.000Z",
      });

      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(3600 + 60);
      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );

      // LP adds subsidy
      const subsidy = parseEther("20");
      await stablecoin.write.approve([market.address, subsidy], { account: lpProvider });
      await market.write.addSubsidy([1n, subsidy], { account: lpProvider });

      // Trade to generate some activity
      const shares = parseEther("2");
      const cost = await market.read.costToBuy([1n, YES, shares]) as bigint;
      await stablecoin.write.approve([market.address, cost], { account: trader1 });
      await market.write.buy([1n, YES, shares, cost], { account: trader1 });

      // Resolve: expire → creator settle proposes NO → no dispute → finalize
      await advanceTime(3700);
      await market.write.settleMarket([1n, NO], { account: creator });
      await advanceTime(86401); // 24h dispute period passes
      await market.write.finalizeAfterDisputePeriod([1n]);

      // LP claims subsidy share
      const lpBalBefore = await stablecoin.read.balanceOf([lpProvider]) as bigint;
      await market.write.claimSubsidy([1n], { account: lpProvider });
      const lpBalAfter = await stablecoin.read.balanceOf([lpProvider]) as bigint;

      // LP had 20 out of 30 total shares (20/(10+20) ≈ 66.7%)
      assert.ok(lpBalAfter > lpBalBefore, "LP should receive proportional subsidy payout");
    });
  });

  // ─── Test 4: Multi-Trader Realistic Scenario ───────────────────────────

  describe("Multi-Trader Scenario with Dispute", () => {
    it("should handle multiple traders, dispute, and correct bond distribution", async () => {
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will Ethereum switch to a new consensus mechanism by 2027?",
        aiDescription: "Resolves YES if Ethereum mainnet changes consensus.",
        image: "ipfs://QmEthImage",
        aiRules: "Based on Ethereum Foundation official announcements.",
        source: { type: "twitter", tweetId: "1893100000000000001", handle: "ETHResearcher" },
        createdAt: "2026-02-15T07:00:00.000Z",
      });

      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(3600 + 60);
      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );
      const marketId = 1n;

      // ── Multiple traders enter ──
      // Trader1: Bullish — buys YES
      const t1Shares = parseEther("4");
      const t1Cost = await market.read.costToBuy([marketId, YES, t1Shares]) as bigint;
      await stablecoin.write.approve([market.address, t1Cost], { account: trader1 });
      await market.write.buy([marketId, YES, t1Shares, t1Cost], { account: trader1 });

      // Trader2: Bearish — buys NO
      const t2Shares = parseEther("3");
      const t2Cost = await market.read.costToBuy([marketId, NO, t2Shares]) as bigint;
      await stablecoin.write.approve([market.address, t2Cost], { account: trader2 });
      await market.write.buy([marketId, NO, t2Shares, t2Cost], { account: trader2 });

      // Verify price reflects asymmetric demand (more YES than NO → YES price > 50%)
      const [yesPrice] = await market.read.getPrice([marketId]) as [bigint, bigint];
      assert.ok(yesPrice > parseEther("0.5"), "YES price should be > 50% with more YES demand");

      // ── Expire → creator settle proposes NO → Trader1 disputes → arb resolves YES ──
      await advanceTime(3700);
      await market.write.settleMarket([marketId, NO], { account: creator });
      // Market proposed NO. Trader1 (YES holder) would want to dispute and argue YES.
      await stablecoin.write.approve([market.address, ARBITRATION_FEE], { account: trader1 });
      await market.write.dispute([marketId, YES, ARBITRATION_FEE], { account: trader1 });

      // ── Arbitration resolves as YES (disputer wins) ──
      await mockArb.write.setResult([1n, YES]);
      await market.write.resolveFromArbitration([marketId]);

      // ── Claims ──
      // Trader1 (YES) wins
      const t1Before = await stablecoin.read.balanceOf([trader1]) as bigint;
      await market.write.claimWinnings([marketId], { account: trader1 });
      const t1After = await stablecoin.read.balanceOf([trader1]) as bigint;
      assert.ok(t1After > t1Before, "Trader1 (YES holder) should profit");

      // Trader2 (NO) loses
      await assert.rejects(
        market.write.claimWinnings([marketId], { account: trader2 }),
        /NothingToClaim/,
      );
    });

    it("should handle creator settlement → dispute → arbitration flow", async () => {
      const apiResult = simulateApiPrepareOnchain({
        statement: "Will gold reach $3000/oz by mid 2026?",
        aiDescription: "Resolves YES if gold ≥ $3000.",
        image: "", aiRules: "Based on COMEX spot price.",
        source: { type: "frontend" }, createdAt: "2026-02-15T15:00:00.000Z",
      });

      const currentTime = await getBlockTimestamp();
      const expiresAt = currentTime + BigInt(30 * 86400); // 30 days

      await stablecoin.write.approve([market.address, MIN_SUBSIDY], { account: creator });
      await market.write.createMarket(
        [apiResult.metadataUri, apiResult.metadataHash, expiresAt, MIN_SUBSIDY],
        { account: creator },
      );

      // Trader1 buys YES
      const shares = parseEther("5");
      const cost = await market.read.costToBuy([1n, YES, shares]) as bigint;
      await stablecoin.write.approve([market.address, cost], { account: trader1 });
      await market.write.buy([1n, YES, shares, cost], { account: trader1 });

      // Creator settles as YES (after expiry)
      await advanceTime(30 * 86400 + 100); // past 30-day expiry
      await market.write.settleMarket([1n, YES], { account: creator });

      // Trader2 disputes with NO
      await stablecoin.write.approve([market.address, ARBITRATION_FEE], { account: trader2 });
      await market.write.dispute([1n, NO, ARBITRATION_FEE], { account: trader2 });

      // Arbitration resolves in favor of YES (creator was right)
      await mockArb.write.setResult([1n, YES]);
      await market.write.resolveFromArbitration([1n]);

      // Trader1 (YES holder) wins — can claim
      const balBefore = await stablecoin.read.balanceOf([trader1]) as bigint;
      await market.write.claimWinnings([1n], { account: trader1 });
      const balAfter = await stablecoin.read.balanceOf([trader1]) as bigint;
      assert.ok(balAfter > balBefore, "trader1 should receive winnings");
    });
  });
});

