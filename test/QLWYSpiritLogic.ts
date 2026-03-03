import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseEther, zeroAddress, zeroHash, encodeAbiParameters, parseAbiParameters, keccak256, toBytes, slice, concatHex } from "viem";

describe("QLWYSpiritLogic", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // Contracts
  let coreMock: Awaited<ReturnType<typeof viem.deployContract>>;
  let spiritAgent: Awaited<ReturnType<typeof viem.deployContract>>;
  let spiritLogic: Awaited<ReturnType<typeof viem.deployContract>>;
  let battleV2: Awaited<ReturnType<typeof viem.deployContract>>;
  let qlwyToken: Awaited<ReturnType<typeof viem.deployContract>>;
  let vrfMock: Awaited<ReturnType<typeof viem.deployContract>>;
  let treasuryMock: Awaited<ReturnType<typeof viem.deployContract>>;

  // Accounts
  let owner: `0x${string}`;
  let user: `0x${string}`;
  let operator: `0x${string}`;
  let defender: `0x${string}`;

  // Action type selectors
  const ACTION_AUTO_BATTLE = slice(keccak256(toBytes("AUTO_BATTLE")), 0, 4);
  const ACTION_AUTO_BET = slice(keccak256(toBytes("AUTO_BET")), 0, 4);
  const ACTION_CLAIM_WINNINGS = slice(keccak256(toBytes("CLAIM_WINNINGS")), 0, 4);
  const ACTION_AUTO_CAST = slice(keccak256(toBytes("AUTO_CAST")), 0, 4);
  const ACTION_AUTO_MINT = slice(keccak256(toBytes("AUTO_MINT")), 0, 4);

  beforeEach(async () => {
    const wallets = await viem.getWalletClients();
    owner = wallets[0].account.address;
    user = wallets[1].account.address;
    operator = wallets[2].account.address;
    defender = wallets[3].account.address;

    // Deploy mocks
    vrfMock = await viem.deployContract("VRFCoordinatorMock");
    coreMock = await viem.deployContract("FortuneCoreMinimalMock");
    treasuryMock = await viem.deployContract("BattleTreasuryMock");
    qlwyToken = await viem.deployContract("QLWYToken", [
      "QLWY Token",
      "QLWY",
      parseEther("1000000"),
      owner,
    ]);

    await coreMock.write.setQLWYToken([qlwyToken.address]);
    await treasuryMock.write.setQLWYToken([qlwyToken.address]);

    // Deploy BattleV2
    battleV2 = await viem.deployContract("QLWYBattleV2", [
      qlwyToken.address,
      coreMock.address,
      treasuryMock.address,
      vrfMock.address,
      zeroHash,
      1n,
    ]);

    // Deploy SpiritAgent first (with zero address for logic)
    spiritAgent = await viem.deployContract("QLWYSpiritAgent", [
      coreMock.address,
      zeroAddress,
      qlwyToken.address,
    ]);

    // Deploy SpiritLogic with 3 params: spiritAgent, battleContract, qlwyToken
    spiritLogic = await viem.deployContract("QLWYSpiritLogic", [
      spiritAgent.address,
      battleV2.address,
      qlwyToken.address,
    ]);

    // Set default logic on SpiritAgent
    await spiritAgent.write.setDefaultLogic([spiritLogic.address]);

    // Transfer tokens
    await qlwyToken.write.transfer([user, parseEther("100000")]);
    await qlwyToken.write.transfer([defender, parseEther("100000")]);
  });

  // Helper to mint NFT
  async function mintNFTForPlayer(player: `0x${string}`, luck: number = 50): Promise<bigint> {
    await coreMock.write.mintWithRarityAndLuck([player, 1, luck]);
    const nextId = await coreMock.read.nextTokenId();
    return nextId - 1n;
  }

  // Helper to get user's contract instances
  async function getUserContracts() {
    const wallets = await viem.getWalletClients();
    const userCore = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
      client: { wallet: wallets[1] },
    });
    const userSpirit = await viem.getContractAt("QLWYSpiritAgent", spiritAgent.address, {
      client: { wallet: wallets[1] },
    });
    const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
      client: { wallet: wallets[1] },
    });
    const userBattle = await viem.getContractAt("QLWYBattleV2", battleV2.address, {
      client: { wallet: wallets[1] },
    });
    const userLogic = await viem.getContractAt("QLWYSpiritLogic", spiritLogic.address, {
      client: { wallet: wallets[1] },
    });
    return { userCore, userSpirit, userToken, userBattle, userLogic };
  }

  // Helper to get defender's contracts
  async function getDefenderContracts() {
    const wallets = await viem.getWalletClients();
    const defCore = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
      client: { wallet: wallets[3] },
    });
    const defToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
      client: { wallet: wallets[3] },
    });
    const defBattle = await viem.getContractAt("QLWYBattleV2", battleV2.address, {
      client: { wallet: wallets[3] },
    });
    return { defCore, defToken, defBattle };
  }

  describe("Strategy Management", () => {
    it("should set strategy for spirit", async () => {
      const tokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic } = await getUserContracts();

      // Upgrade to spirit
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      // Set strategy
      const maxBetAmount = parseEther("100");
      const maxBattleBet = parseEther("50");
      const riskLevel = 1; // balanced
      const autoBattleEnabled = true;
      const autoBetEnabled = true;

      await userLogic.write.setStrategy([
        tokenId,
        {
          maxBetAmount,
          maxBattleBet,
          riskLevel,
          autoBattleEnabled,
          autoBetEnabled,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      const strategy = await spiritLogic.read.getStrategy([tokenId]);
      assert.equal(strategy.maxBetAmount, maxBetAmount);
      assert.equal(strategy.maxBattleBet, maxBattleBet);
      assert.equal(strategy.riskLevel, riskLevel);
      assert.equal(strategy.autoBattleEnabled, autoBattleEnabled);
      assert.equal(strategy.autoBetEnabled, autoBetEnabled);
    });

    it("should allow setting any risk level (no validation in contract)", async () => {
      const tokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      // Contract doesn't validate riskLevel, so this should succeed
      await userLogic.write.setStrategy([
        tokenId,
        {
          maxBetAmount: parseEther("100"),
          maxBattleBet: parseEther("50"),
          riskLevel: 5, // any value is accepted
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      const strategy = await spiritLogic.read.getStrategy([tokenId]);
      assert.equal(strategy.riskLevel, 5);
    });
  });

  describe("Auto Battle via executeAction", () => {
    let spiritTokenId: bigint;
    let battleId: bigint;

    beforeEach(async () => {
      // Setup: user upgrades NFT to spirit
      spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userToken, userLogic, userBattle } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      // Set strategy
      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1, // balanced
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      // Authorize SpiritAgent as agent in BattleV2 (SpiritAgent is now msg.sender)
      await userBattle.write.authorizeAgent([spiritAgent.address, true]);

      // Whitelist BattleV2 as relay target
      await spiritAgent.write.setWhitelistedTarget([battleV2.address, true]);

      // Approve tokens for SpiritAgent
      await userToken.write.approve([spiritAgent.address, parseEther("10000")]);

      // Defender creates a battle
      const { defCore, defToken, defBattle } = await getDefenderContracts();
      const defTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        defTokenIds.push(await mintNFTForPlayer(defender));
      }
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("300")]);
      await defBattle.write.createBattle([defTokenIds, parseEther("100")]);
      battleId = 1n;
    });

    it("should execute auto battle action to join defender side", async () => {
      const { userSpirit, userCore, userToken, userBattle } = await getUserContracts();

      // Mint NEW NFTs for battle (not the wrapped spirit NFT)
      const nftIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        const id = await mintNFTForPlayer(user);
        nftIds.push(id);
      }

      // Approve NFTs to BattleV2 (not SpiritAgent) - BattleV2 transfers NFTs
      await userCore.write.setApprovalForAll([battleV2.address, true]);

      // Approve tokens to BattleV2 for bet
      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Encode action data: AUTO_BATTLE
      // params: (uint256[] nftIds, uint256 betPerSlot, bool isCreate, uint256 battleId, bool joinChallenger)
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [nftIds, parseEther("100"), false, battleId, false] // join defender side
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);

      // Execute action
      await userSpirit.write.executeAction([spiritTokenId, actionData]);

      // Verify battle state - getBattle returns (creator, challengerCount, defenderCount, betPerSlot, status, ...)
      const [, , defenderCount, , status] = await battleV2.read.getBattle([battleId]);
      assert.equal(defenderCount, 3);
      assert.equal(status, 1); // BETTING (both sides filled)
    });
  });

  describe("Auto Bet via executeAction", () => {
    let spiritTokenId: bigint;
    let battleId: bigint;

    beforeEach(async () => {
      // Setup spirit
      spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userToken, userLogic, userBattle } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);
      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);
      // Authorize SpiritAgent as agent in BattleV2
      await userBattle.write.authorizeAgent([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([battleV2.address, true]);
      await userToken.write.approve([spiritAgent.address, parseEther("10000")]);

      // Create and fill a battle
      const { defCore, defToken, defBattle } = await getDefenderContracts();

      // Challenger (defender account creates)
      const challTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        challTokenIds.push(await mintNFTForPlayer(defender));
      }
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("600")]);
      await defBattle.write.createBattle([challTokenIds, parseEther("100")]);

      // User joins as defender
      const userTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        userTokenIds.push(await mintNFTForPlayer(user));
      }
      await userCore.write.setApprovalForAll([battleV2.address, true]);
      await userToken.write.approve([battleV2.address, parseEther("300")]);
      await userBattle.write.joinDefender([1n, userTokenIds]);

      battleId = 1n;
    });

    it("should execute auto bet action", async () => {
      const { userSpirit, userToken } = await getUserContracts();

      // Approve tokens to BattleV2 (not SpiritAgent) - BattleV2 transfers tokens via placeBetFor
      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Encode action data: AUTO_BET
      // params: (uint256 battleId, bool betOnChallenger, uint256 amount)
      const params = encodeAbiParameters(
        parseAbiParameters("uint256, bool, uint256"),
        [battleId, false, parseEther("50")] // bet on defender
      );
      const actionData = concatHex([ACTION_AUTO_BET, params]);

      await userSpirit.write.executeAction([spiritTokenId, actionData]);

      // getBattleBettingInfo returns (bettingEndsAt, challengerBetPool, defenderBetPool, status)
      const [, , defenderBetPool] = await battleV2.read.getBattleBettingInfo([battleId]);
      assert.equal(defenderBetPool, parseEther("50"));
    });
  });

  describe("Action Type Constants", () => {
    it("should have correct action type selectors", async () => {
      const autoBattle = await spiritLogic.read.ACTION_AUTO_BATTLE();
      const autoBet = await spiritLogic.read.ACTION_AUTO_BET();
      const claimWinnings = await spiritLogic.read.ACTION_CLAIM_WINNINGS();
      const autoCast = await spiritLogic.read.ACTION_AUTO_CAST();
      const autoMint = await spiritLogic.read.ACTION_AUTO_MINT();

      assert.equal(autoBattle, ACTION_AUTO_BATTLE);
      assert.equal(autoBet, ACTION_AUTO_BET);
      assert.equal(claimWinnings, ACTION_CLAIM_WINNINGS);
      assert.equal(autoCast, ACTION_AUTO_CAST);
      assert.equal(autoMint, ACTION_AUTO_MINT);
    });
  });

  describe("Auto Battle Disabled", () => {
    it("should reject auto battle when disabled", async () => {
      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic, userBattle, userToken } = await getUserContracts();

      // Upgrade to spirit
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      // Set strategy with autoBattleEnabled = false
      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: false, // disabled
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      // Authorize SpiritAgent
      await userBattle.write.authorizeAgent([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([battleV2.address, true]);

      // Create a battle to join
      const { defCore, defToken, defBattle } = await getDefenderContracts();
      const defTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        defTokenIds.push(await mintNFTForPlayer(defender));
      }
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("300")]);
      await defBattle.write.createBattle([defTokenIds, parseEther("100")]);

      // Mint NFTs for battle
      const nftIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        nftIds.push(await mintNFTForPlayer(user));
      }
      await userCore.write.setApprovalForAll([battleV2.address, true]);
      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Try to execute auto battle - should fail
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [nftIds, parseEther("100"), false, 1n, false]
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /AutoBattleDisabled/
      );
    });
  });

  describe("Auto Bet Disabled", () => {
    it("should reject auto bet when disabled", async () => {
      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic, userBattle, userToken } = await getUserContracts();

      // Upgrade to spirit
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      // Set strategy with autoBetEnabled = false
      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: false, // disabled
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      // Authorize SpiritAgent
      await userBattle.write.authorizeAgent([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([battleV2.address, true]);

      // Create a filled battle in BETTING status
      const { defCore, defToken, defBattle } = await getDefenderContracts();
      const defTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        defTokenIds.push(await mintNFTForPlayer(defender));
      }
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("300")]);
      await defBattle.write.createBattle([defTokenIds, parseEther("100")]);

      // User joins defender
      const userTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        userTokenIds.push(await mintNFTForPlayer(user));
      }
      await userCore.write.setApprovalForAll([battleV2.address, true]);
      await userToken.write.approve([battleV2.address, parseEther("1000")]);
      await userBattle.write.joinDefender([1n, userTokenIds]);

      // Try to execute auto bet - should fail
      const params = encodeAbiParameters(
        parseAbiParameters("uint256, bool, uint256"),
        [1n, false, parseEther("50")]
      );
      const actionData = concatHex([ACTION_AUTO_BET, params]);

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /AutoBetDisabled/
      );
    });
  });

  describe("Exceeds Max Bet", () => {
    it("should reject bet exceeding maxBetAmount", async () => {
      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic, userBattle, userToken } = await getUserContracts();

      // Upgrade to spirit
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      // Set strategy with low maxBetAmount
      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("10"), // low limit
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      // Authorize SpiritAgent
      await userBattle.write.authorizeAgent([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([battleV2.address, true]);

      // Create a filled battle in BETTING status
      const { defCore, defToken, defBattle } = await getDefenderContracts();
      const defTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        defTokenIds.push(await mintNFTForPlayer(defender));
      }
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("300")]);
      await defBattle.write.createBattle([defTokenIds, parseEther("100")]);

      // User joins defender
      const userTokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        userTokenIds.push(await mintNFTForPlayer(user));
      }
      await userCore.write.setApprovalForAll([battleV2.address, true]);
      await userToken.write.approve([battleV2.address, parseEther("1000")]);
      await userBattle.write.joinDefender([1n, userTokenIds]);

      // Try to bet 50 ETH, exceeds maxBetAmount of 10 ETH
      const params = encodeAbiParameters(
        parseAbiParameters("uint256, bool, uint256"),
        [1n, false, parseEther("50")] // exceeds maxBetAmount
      );
      const actionData = concatHex([ACTION_AUTO_BET, params]);

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /ExceedsMaxBet/
      );
    });

    it("should reject battle bet exceeding maxBattleBet", async () => {
      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic, userBattle, userToken } = await getUserContracts();

      // Upgrade to spirit
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      // Set strategy with low maxBattleBet
      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("10"), // low limit
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      // Authorize SpiritAgent
      await userBattle.write.authorizeAgent([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([battleV2.address, true]);

      // Mint NFTs for battle
      const nftIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        nftIds.push(await mintNFTForPlayer(user));
      }
      await userCore.write.setApprovalForAll([battleV2.address, true]);
      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Try to create battle with betPerSlot of 100 ETH, exceeds maxBattleBet of 10 ETH
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [nftIds, parseEther("100"), true, 0n, true] // exceeds maxBattleBet
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /ExceedsMaxBet/
      );
    });
  });

  describe("AutoCaster Standalone", () => {
    let autoCaster: Awaited<ReturnType<typeof viem.deployContract>>;
    let callerAutoCaster: Awaited<ReturnType<typeof viem.getContractAt>>;

    beforeEach(async () => {
      const wallets = await viem.getWalletClients();

      // Deploy AutoCaster
      autoCaster = await viem.deployContract("QLWYAutoCaster", [coreMock.address]);

      // Authorize operator as caller
      await autoCaster.write.setAuthorizedCaller([operator, true]);

      // Get caller-bound instance
      callerAutoCaster = await viem.getContractAt("QLWYAutoCaster", autoCaster.address, {
        client: { wallet: wallets[2] },
      });
    });

    it("should reject unauthorized caller for castFor", async () => {
      const wallets = await viem.getWalletClients();
      const unauth = await viem.getContractAt("QLWYAutoCaster", autoCaster.address, {
        client: { wallet: wallets[1] },
      });

      await assert.rejects(
        unauth.write.castFor([user], { value: parseEther("0.001") }),
        /reverted/
      );
    });

    it("should castFor and record beneficiary", async () => {
      await callerAutoCaster.write.castFor([user], { value: parseEther("0.001") });

      const beneficiary = await autoCaster.read.castBeneficiary([1n]);
      assert.equal(beneficiary.toLowerCase(), user.toLowerCase());
    });

    it("should report correct getCastFee", async () => {
      const fee = await autoCaster.read.getCastFee();
      assert.equal(fee, parseEther("0.001"));
    });

    it("should report correct getJackpotBalance", async () => {
      await qlwyToken.write.approve([coreMock.address, parseEther("5000")]);
      await coreMock.write.seedJackpot([parseEther("5000")]);

      const balance = await autoCaster.read.getJackpotBalance();
      assert.equal(balance, parseEther("5000"));
    });

    it("should report isCastReady correctly", async () => {
      await callerAutoCaster.write.castFor([user], { value: parseEther("0.001") });

      const [ready1] = await autoCaster.read.isCastReady([1n]);
      assert.equal(ready1, false);

      await coreMock.write.mockFulfillCast([1n, 2, 50]);

      const [ready2, rarity] = await autoCaster.read.isCastReady([1n]);
      assert.equal(ready2, true);
      assert.equal(rarity, 2);
    });

    it("should mintFor and transfer NFT to beneficiary", async () => {
      await callerAutoCaster.write.castFor([user], { value: parseEther("0.001") });
      await coreMock.write.mockFulfillCast([1n, 2, 50]);

      const { userToken } = await getUserContracts();
      const mintFee = await coreMock.read.mintFeeForRarity([2]);
      await userToken.write.approve([autoCaster.address, mintFee]);

      await callerAutoCaster.write.mintFor([1n]);

      const nextTokenId = await coreMock.read.nextTokenId();
      const nftTokenId = nextTokenId - 1n;
      const nftOwner = await coreMock.read.ownerOf([nftTokenId]);
      assert.equal(nftOwner.toLowerCase(), user.toLowerCase());

      const beneficiary = await autoCaster.read.castBeneficiary([1n]);
      assert.equal(beneficiary, zeroAddress);
    });

    it("should reject mintFor with no beneficiary", async () => {
      await assert.rejects(
        callerAutoCaster.write.mintFor([999n]),
        /NoBeneficiary/
      );
    });
  });

  describe("Auto Cast via executeAction", () => {
    it("should reject when autoCaster not set", async () => {
      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: true,
          jackpotThreshold: parseEther("100"),
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      const actionData = ACTION_AUTO_CAST;

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /AutoCasterNotSet/
      );
    });

    it("should reject when auto cast disabled", async () => {
      const autoCaster = await viem.deployContract("QLWYAutoCaster", [coreMock.address]);
      await spiritLogic.write.setAutoCaster([autoCaster.address]);
      await autoCaster.write.setAuthorizedCaller([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([autoCaster.address, true]);

      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: parseEther("100"),
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      const actionData = ACTION_AUTO_CAST;

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /AutoCastDisabled/
      );
    });

    it("should reject when jackpot below threshold", async () => {
      const autoCaster = await viem.deployContract("QLWYAutoCaster", [coreMock.address]);
      await spiritLogic.write.setAutoCaster([autoCaster.address]);
      await autoCaster.write.setAuthorizedCaller([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([autoCaster.address, true]);

      // Seed a small jackpot
      await qlwyToken.write.approve([coreMock.address, parseEther("100")]);
      await coreMock.write.seedJackpot([parseEther("100")]);

      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userLogic } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: true,
          jackpotThreshold: parseEther("5000"),
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      const actionData = ACTION_AUTO_CAST;

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /JackpotBelowThreshold/
      );
    });
  });

  describe("Auto Mint via executeAction", () => {
    it("should reject when autoCaster not set", async () => {
      const spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      const params = encodeAbiParameters(
        parseAbiParameters("uint256"),
        [1n]
      );
      const actionData = concatHex([ACTION_AUTO_MINT, params]);

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData]),
        /AutoCasterNotSet/
      );
    });
  });

  describe("Wrapped Spirit NFT in Battles", () => {
    let spiritTokenId: bigint;

    beforeEach(async () => {
      // 1. Mint NFT for user and upgrade to spirit (wraps NFT into SpiritAgent)
      spiritTokenId = await mintNFTForPlayer(user);
      const { userCore, userSpirit, userToken, userLogic, userBattle } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([spiritTokenId]);

      // 2. Admin approves BattleV2 to transfer NFTs held by SpiritAgent
      await spiritAgent.write.approveFortuneCoreForAll([battleV2.address, true]);

      // 3. User authorizes SpiritAgent as agent in BattleV2
      await userBattle.write.authorizeAgent([spiritAgent.address, true]);
      await spiritAgent.write.setWhitelistedTarget([battleV2.address, true]);

      // 4. Set strategy
      await userLogic.write.setStrategy([
        spiritTokenId,
        {
          maxBetAmount: parseEther("1000"),
          maxBattleBet: parseEther("100"),
          riskLevel: 1,
          autoBattleEnabled: true,
          autoBetEnabled: true,
          autoCastEnabled: false,
          jackpotThreshold: 0n,
          autoSwapEnabled: false,
          maxSwapAmount: 0n,
        },
      ]);

      // 5. Approve tokens for SpiritAgent (spirit pulls tokens from user)
      await userToken.write.approve([spiritAgent.address, parseEther("10000")]);
    });

    it("should allow spirit to join battle with its own wrapped NFT", async () => {
      const { userSpirit, userCore, userToken } = await getUserContracts();

      // Defender creates a battle with 1 NFT
      const { defCore, defToken, defBattle } = await getDefenderContracts();
      const defNft = await mintNFTForPlayer(defender);
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("100")]);
      await defBattle.write.createBattle([[defNft], parseEther("100")]);
      const battleId = 1n;

      // Verify spirit NFT is owned by SpiritAgent (wrapped)
      const nftOwner = await coreMock.read.ownerOf([spiritTokenId]);
      assert.equal((nftOwner as string).toLowerCase(), spiritAgent.address.toLowerCase());

      // Approve user's tokens to BattleV2 for bet
      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Spirit joins defender side with its own wrapped NFT
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [[spiritTokenId], parseEther("100"), false, battleId, false] // join defender
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);
      await userSpirit.write.executeAction([spiritTokenId, actionData]);

      // Verify spirit NFT moved to BattleV2
      const newOwner = await coreMock.read.ownerOf([spiritTokenId]);
      assert.equal((newOwner as string).toLowerCase(), battleV2.address.toLowerCase());

      // Verify defender count increased (spirit joined defender with 1 NFT)
      const [, , defenderCount] = await battleV2.read.getBattle([battleId]);
      assert.equal(defenderCount, 1);
    });

    it("should return wrapped NFT to SpiritAgent after battle resolution", async () => {
      const { userSpirit, userCore, userToken } = await getUserContracts();
      const { defCore, defToken, defBattle } = await getDefenderContracts();

      // Mint 2 more NFTs for user (to fill 3 slots: 1 wrapped + 2 user-owned)
      const userNft1 = await mintNFTForPlayer(user);
      const userNft2 = await mintNFTForPlayer(user);

      // Approve user's NFTs to BattleV2
      await userCore.write.setApprovalForAll([battleV2.address, true]);
      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Defender creates battle with 3 NFTs
      const defNfts: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        defNfts.push(await mintNFTForPlayer(defender));
      }
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("300")]);
      await defBattle.write.createBattle([defNfts, parseEther("100")]);
      const battleId = 1n;

      // Spirit joins defender with [spiritTokenId, userNft1, userNft2]
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [[spiritTokenId, userNft1, userNft2], parseEther("100"), false, battleId, false]
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);
      await userSpirit.write.executeAction([spiritTokenId, actionData]);

      // Verify battle is now BETTING (both sides have 3)
      const [, , , , status] = await battleV2.read.getBattle([battleId]);
      assert.equal(status, 1); // BETTING

      // Fast forward past betting period and start battle
      await publicClient.request({ method: "evm_increaseTime" as any, params: [3601] });
      await publicClient.request({ method: "evm_mine" as any, params: [] });
      await battleV2.write.startBattle([battleId]);

      // Resolve battle with VRF
      await vrfMock.write.fulfillRandomWords([1n, battleV2.address, []]);

      // Verify battle resolved
      const [, , , , statusAfter] = await battleV2.read.getBattle([battleId]);
      assert.equal(statusAfter, 3); // RESOLVED

      // Check that spiritTokenId returned to SpiritAgent (not burned)
      const spiritNftOwner = await coreMock.read.ownerOf([spiritTokenId]);
      const isBurned = (spiritNftOwner as string).toLowerCase() === "0x000000000000000000000000000000000000dead";
      if (!isBurned) {
        assert.equal((spiritNftOwner as string).toLowerCase(), spiritAgent.address.toLowerCase());
      }

      // Check that user NFTs returned to user (not burned)
      for (const nftId of [userNft1, userNft2]) {
        const nftOwner = await coreMock.read.ownerOf([nftId]);
        const nftBurned = (nftOwner as string).toLowerCase() === "0x000000000000000000000000000000000000dead";
        if (!nftBurned) {
          assert.equal((nftOwner as string).toLowerCase(), user.toLowerCase());
        }
      }
    });

    it("should return wrapped NFT to SpiritAgent after battle cancellation", async () => {
      const { userSpirit, userToken } = await getUserContracts();

      // User creates battle via spirit with its own wrapped NFT
      await userToken.write.approve([battleV2.address, parseEther("1000")]);
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [[spiritTokenId], parseEther("100"), true, 0n, false] // isCreate=true
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);
      await userSpirit.write.executeAction([spiritTokenId, actionData]);
      const battleId = 1n;

      // Verify NFT is in BattleV2
      const midOwner = await coreMock.read.ownerOf([spiritTokenId]);
      assert.equal((midOwner as string).toLowerCase(), battleV2.address.toLowerCase());

      // Fast forward past fillTimeout
      await publicClient.request({ method: "evm_increaseTime" as any, params: [86401] });
      await publicClient.request({ method: "evm_mine" as any, params: [] });

      // User (creator) cancels battle
      const { userBattle } = await getUserContracts();
      await userBattle.write.cancelBattle([battleId]);

      // Verify NFT returned to SpiritAgent
      const afterOwner = await coreMock.read.ownerOf([spiritTokenId]);
      assert.equal((afterOwner as string).toLowerCase(), spiritAgent.address.toLowerCase());
    });

    it("should return wrapped NFT to SpiritAgent after leave", async () => {
      const { userSpirit, userToken } = await getUserContracts();

      // Defender creates battle
      const { defCore, defToken, defBattle } = await getDefenderContracts();
      const defNft = await mintNFTForPlayer(defender);
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("100")]);
      await defBattle.write.createBattle([[defNft], parseEther("100")]);
      const battleId = 1n;

      // Spirit joins defender side
      await userToken.write.approve([battleV2.address, parseEther("1000")]);
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [[spiritTokenId], parseEther("100"), false, battleId, false]
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);
      await userSpirit.write.executeAction([spiritTokenId, actionData]);

      // Fast forward past fillTimeout
      await publicClient.request({ method: "evm_increaseTime" as any, params: [86401] });
      await publicClient.request({ method: "evm_mine" as any, params: [] });

      // User leaves battle
      const { userBattle } = await getUserContracts();
      await userBattle.write.leaveBattle([battleId]);

      // Verify NFT returned to SpiritAgent
      const afterOwner = await coreMock.read.ownerOf([spiritTokenId]);
      assert.equal((afterOwner as string).toLowerCase(), spiritAgent.address.toLowerCase());
    });

    it("should return wrapped NFT to SpiritAgent after cancelPendingBattle (VRF timeout)", async () => {
      const { userSpirit, userCore, userToken } = await getUserContracts();
      const { defCore, defToken, defBattle } = await getDefenderContracts();

      // Mint 2 more NFTs for user (to fill 3 slots: 1 wrapped + 2 user-owned)
      const userNft1 = await mintNFTForPlayer(user);
      const userNft2 = await mintNFTForPlayer(user);

      // Approve user's NFTs and tokens to BattleV2
      await userCore.write.setApprovalForAll([battleV2.address, true]);
      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Defender creates battle with 3 NFTs
      const defNfts: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        defNfts.push(await mintNFTForPlayer(defender));
      }
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("300")]);
      await defBattle.write.createBattle([defNfts, parseEther("100")]);
      const battleId = 1n;

      // Spirit joins defender with [spiritTokenId, userNft1, userNft2]
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [[spiritTokenId, userNft1, userNft2], parseEther("100"), false, battleId, false]
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);
      await userSpirit.write.executeAction([spiritTokenId, actionData]);

      // Verify battle is BETTING (both sides filled with 3)
      let [, , , , status] = await battleV2.read.getBattle([battleId]);
      assert.equal(status, 1); // BETTING

      // Fast forward past betting period and start battle → PENDING
      await publicClient.request({ method: "evm_increaseTime" as any, params: [3601] });
      await publicClient.request({ method: "evm_mine" as any, params: [] });
      await battleV2.write.startBattle([battleId]);

      [, , , , status] = await battleV2.read.getBattle([battleId]);
      assert.equal(status, 2); // PENDING

      // Do NOT call VRF fulfillment — simulate VRF timeout
      // Fast forward past vrfTimeout (4 hours = 14400 seconds)
      await publicClient.request({ method: "evm_increaseTime" as any, params: [14401] });
      await publicClient.request({ method: "evm_mine" as any, params: [] });

      // Cancel pending battle
      await battleV2.write.cancelPendingBattle([battleId]);

      // Verify battle is CANCELLED
      [, , , , status] = await battleV2.read.getBattle([battleId]);
      assert.equal(status, 4); // CANCELLED

      // Verify wrapped spirit NFT returned to SpiritAgent
      const spiritNftOwner = await coreMock.read.ownerOf([spiritTokenId]);
      assert.equal((spiritNftOwner as string).toLowerCase(), spiritAgent.address.toLowerCase());

      // Verify user-owned NFTs returned to user
      for (const nftId of [userNft1, userNft2]) {
        const nftOwner = await coreMock.read.ownerOf([nftId]);
        assert.equal((nftOwner as string).toLowerCase(), user.toLowerCase());
      }

      // Verify defender NFTs returned to defender
      for (const nftId of defNfts) {
        const nftOwner = await coreMock.read.ownerOf([nftId]);
        assert.equal((nftOwner as string).toLowerCase(), defender.toLowerCase());
      }
    });

    it("should fail to join battle without SpiritAgent approval for BattleV2", async () => {
      const { userSpirit, userToken } = await getUserContracts();

      // Revoke BattleV2 approval on SpiritAgent
      await spiritAgent.write.approveFortuneCoreForAll([battleV2.address, false]);

      // Defender creates battle
      const { defCore, defToken, defBattle } = await getDefenderContracts();
      const defNft = await mintNFTForPlayer(defender);
      await defCore.write.setApprovalForAll([battleV2.address, true]);
      await defToken.write.approve([battleV2.address, parseEther("100")]);
      await defBattle.write.createBattle([[defNft], parseEther("100")]);

      await userToken.write.approve([battleV2.address, parseEther("1000")]);

      // Try to join — should fail because BattleV2 can't pull NFT from SpiritAgent
      const params = encodeAbiParameters(
        parseAbiParameters("uint256[], uint256, bool, uint256, bool"),
        [[spiritTokenId], parseEther("100"), false, 1n, false]
      );
      const actionData = concatHex([ACTION_AUTO_BATTLE, params]);

      await assert.rejects(
        userSpirit.write.executeAction([spiritTokenId, actionData])
      );
    });
  });
});
