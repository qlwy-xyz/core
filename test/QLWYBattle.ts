import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseEther, zeroHash, getAddress } from "viem";

describe("QLWYBattle", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // Contracts
  let vrfMock: Awaited<ReturnType<typeof viem.deployContract>>;
  let coreMock: Awaited<ReturnType<typeof viem.deployContract>>;
  let treasuryMock: Awaited<ReturnType<typeof viem.deployContract>>;
  let qlwyToken: Awaited<ReturnType<typeof viem.deployContract>>;
  let battle: Awaited<ReturnType<typeof viem.deployContract>>;

  // Accounts
  let owner: `0x${string}`;
  let playerA: `0x${string}`;
  let playerB: `0x${string}`;

  // Constants
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

  beforeEach(async () => {
    const [ownerWallet, playerAWallet, playerBWallet] = await viem.getWalletClients();
    owner = ownerWallet.account.address;
    playerA = playerAWallet.account.address;
    playerB = playerBWallet.account.address;

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

    // Set QLWY token in mocks
    await coreMock.write.setQLWYToken([qlwyToken.address]);
    await treasuryMock.write.setQLWYToken([qlwyToken.address]);

    // Deploy battle contract
    battle = await viem.deployContract("QLWYBattle", [
      qlwyToken.address,
      coreMock.address,
      treasuryMock.address,
      vrfMock.address,
      zeroHash, // keyHash
      1n, // subId
    ]);

    // Transfer QLWY to players
    await qlwyToken.write.transfer([playerA, parseEther("100000")]);
    await qlwyToken.write.transfer([playerB, parseEther("100000")]);
  });

  // Helper function to mint NFTs with luck
  async function mintNFTsForPlayer(player: `0x${string}`, lucks: [number, number, number]): Promise<bigint[]> {
    const tokenIds: bigint[] = [];
    for (const luck of lucks) {
      const result = await coreMock.write.mintWithRarityAndLuck([player, 1, luck]); // rarity=1 (Rare)
      const nextId = await coreMock.read.nextTokenId();
      tokenIds.push(nextId - 1n);
    }
    return tokenIds;
  }

  // Helper to get player's contract instance
  async function getPlayerContracts(playerIndex: number) {
    const wallets = await viem.getWalletClients();
    const playerCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
      client: { wallet: wallets[playerIndex] },
    });
    const playerToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
      client: { wallet: wallets[playerIndex] },
    });
    const playerBattle = await viem.getContractAt("QLWYBattle", battle.address, {
      client: { wallet: wallets[playerIndex] },
    });
    return { playerCoreMock, playerToken, playerBattle };
  }

  // Helper to advance time past betting period and start battle
  async function advanceTimeAndStartBattle(battleId: bigint) {
    // Advance time by 30 minutes (betting duration)
    await publicClient.request({
      method: "evm_increaseTime" as any,
      params: [1800], // 30 minutes
    });
    await publicClient.request({
      method: "evm_mine" as any,
      params: [],
    });
    // Start the battle (triggers VRF request)
    await battle.write.startBattle([battleId]);
  }

  describe("Basic Setup", () => {
    it("should have correct initial config", async () => {
      const minBet = await battle.read.minBet();
      assert.equal(minBet, parseEther("100"));

      const maxBet = await battle.read.maxBet();
      assert.equal(maxBet, parseEther("10000"));

      const feeBps = await battle.read.feeBps();
      assert.equal(feeBps, 1000); // 10%

      // Check rarity-based burn chances
      const burnChances = await battle.read.getRarityBurnChance();
      assert.deepEqual(burnChances, [3000, 2000, 1500, 1000, 500]); // 30%, 20%, 15%, 10%, 5%

      // Check rarity luck bonuses
      const luckBonuses = await battle.read.getRarityLuckBonus();
      assert.deepEqual(luckBonuses, [0, 5, 10, 15, 20]);
    });

    it("should have correct addresses", async () => {
      const tokenAddr = await battle.read.qlwyToken();
      assert.equal(getAddress(tokenAddr as string), getAddress(qlwyToken.address));

      const coreAddr = await battle.read.fortuneCore();
      assert.equal(getAddress(coreAddr as string), getAddress(coreMock.address));

      const treasuryAddr = await battle.read.treasury();
      assert.equal(getAddress(treasuryAddr as string), getAddress(treasuryMock.address));
    });
  });

  describe("Create Battle", () => {
    it("should create battle successfully", async () => {
      const nftIds = await mintNFTsForPlayer(playerA, [80, 60, 40]);
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1);

      // Approve NFT and token
      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("1000")]);

      // Create battle
      await playerBattle.write.createBattle([[nftIds[0], nftIds[1], nftIds[2]], parseEther("500")]);

      // Check battle state
      const battleData = await battle.read.getBattle([1n]);
      assert.equal(getAddress(battleData[0] as string), getAddress(playerA)); // challenger
      assert.equal(battleData[8], parseEther("500")); // betAmount
      assert.equal(battleData[9], 0); // status = OPEN

      // NFTs should be in battle contract
      const owner1 = await coreMock.read.ownerOf([nftIds[0]]);
      assert.equal(getAddress(owner1 as string), getAddress(battle.address));
    });

    it("should revert with InvalidBetAmount if bet too low", async () => {
      const nftIds = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1);

      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("1000")]);

      await assert.rejects(
        playerBattle.write.createBattle([[nftIds[0], nftIds[1], nftIds[2]], parseEther("50")]),
        /InvalidBetAmount/
      );
    });

    it("should revert with NotOwnerOfNFT if player doesn't own NFT", async () => {
      const nftIds = await mintNFTsForPlayer(playerB, [50, 50, 50]); // mint to playerB
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1); // playerA

      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("1000")]);

      await assert.rejects(
        playerBattle.write.createBattle([[nftIds[0], nftIds[1], nftIds[2]], parseEther("100")]),
        /NotOwnerOfNFT/
      );
    });
  });

  describe("Accept Battle", () => {
    it("should accept battle successfully and enter BETTING status", async () => {
      // PlayerA creates battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [80, 60, 40]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      // PlayerB accepts battle
      const nftIdsB = await mintNFTsForPlayer(playerB, [70, 50, 30]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Check battle state - should be BETTING (1), not PENDING
      const battleData = await battle.read.getBattle([1n]);
      assert.equal(getAddress(battleData[1] as string), getAddress(playerB)); // defender
      assert.equal(battleData[9], 1); // status = BETTING

      // Check betting info
      const bettingInfo = await battle.read.getBattleBettingInfo([1n]);
      assert.ok(bettingInfo[0] > 0n); // bettingEndsAt should be set
      assert.equal(bettingInfo[1], 0n); // challengerBetPool = 0
      assert.equal(bettingInfo[2], 0n); // defenderBetPool = 0
    });

    it("should revert with CannotFightSelf if challenger tries to accept own battle", async () => {
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const nftIdsA2 = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1);

      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("2000")]);

      await playerBattle.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      await assert.rejects(
        playerBattle.write.acceptBattle([1n, [nftIdsA2[0], nftIdsA2[1], nftIdsA2[2]]]),
        /CannotFightSelf/
      );
    });

    it("should revert with BattleNotOpen if battle already accepted", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [50, 50, 50]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Another player tries to accept
      const nftIdsOwner = await mintNFTsForPlayer(owner, [50, 50, 50]);
      const { playerCoreMock: coreMockOwner, playerToken: tokenOwner, playerBattle: battleOwner } = await getPlayerContracts(0);
      await coreMockOwner.write.setApprovalForAll([battle.address, true]);
      await tokenOwner.write.approve([battle.address, parseEther("1000")]);

      await assert.rejects(
        battleOwner.write.acceptBattle([1n, [nftIdsOwner[0], nftIdsOwner[1], nftIdsOwner[2]]]),
        /BattleNotOpen/
      );
    });
  });

  describe("Betting System", () => {
    it("should allow placing bets during betting period", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [50, 50, 50]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Place bets during betting period
      await battleA.write.placeBet([1n, true, parseEther("100")]); // Bet on challenger
      await battleB.write.placeBet([1n, false, parseEther("200")]); // Bet on defender

      // Check betting pools
      const bettingInfo = await battle.read.getBattleBettingInfo([1n]);
      assert.equal(bettingInfo[1], parseEther("100")); // challengerBetPool
      assert.equal(bettingInfo[2], parseEther("200")); // defenderBetPool

      // Check user bets
      const userBetsA = await battle.read.getUserBets([1n, playerA]);
      assert.equal(userBetsA[0], parseEther("100")); // betOnChallenger
      assert.equal(userBetsA[1], 0n); // betOnDefender

      const userBetsB = await battle.read.getUserBets([1n, playerB]);
      assert.equal(userBetsB[0], 0n); // betOnChallenger
      assert.equal(userBetsB[1], parseEther("200")); // betOnDefender
    });

    it("should revert betting after betting period ends", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [50, 50, 50]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time past betting period
      await publicClient.request({
        method: "evm_increaseTime" as any,
        params: [1800], // 30 minutes
      });
      await publicClient.request({
        method: "evm_mine" as any,
        params: [],
      });

      // Try to place bet - should fail
      await assert.rejects(
        battleA.write.placeBet([1n, true, parseEther("100")]),
        /BettingEnded/
      );
    });

    it("should revert startBattle before betting period ends", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [50, 50, 50]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Try to start battle before betting ends - should fail
      await assert.rejects(
        battle.write.startBattle([1n]),
        /BettingNotEnded/
      );
    });

    it("should allow claiming winnings after battle resolution", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]); // High luck - will win
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]); // Low luck - will lose
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Place bets: A bets 1000 on challenger, B bets 500 on defender
      await battleA.write.placeBet([1n, true, parseEther("1000")]);
      await battleB.write.placeBet([1n, false, parseEther("500")]);

      const balanceABefore = await qlwyToken.read.balanceOf([playerA]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF - challenger wins (low random values)
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      // Claim winnings
      await battleA.write.claimBetWinnings([1n]);

      // Check balance increased
      // A wins battle: 90% of (500+500) pot = 900
      // A bet 1000 on challenger: gets bet back (1000) + 90% of losing pool (500 * 0.90 = 450)
      //   (5% to challenger as betting fee, 5% to treasury)
      // A is challenger (battle creator): gets 5% betting fee (500 * 0.05 = 25)
      // Total = 900 + 1000 + 450 + 25 = 2375
      const balanceAAfter = await qlwyToken.read.balanceOf([playerA]);
      assert.equal(balanceAAfter - balanceABefore, parseEther("2375"));

      // Check claim status
      const userBetsA = await battle.read.getUserBets([1n, playerA]);
      assert.equal(userBetsA[2], true); // claimed

      // Check betting fee paid flag
      const bettingFeePaid = await battle.read.bettingFeePaid([1n]);
      assert.equal(bettingFeePaid, true);
    });

    it("should revert double claim", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Place bet
      await battleA.write.placeBet([1n, true, parseEther("100")]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      // Claim once
      await battleA.write.claimBetWinnings([1n]);

      // Try to claim again - should fail
      await assert.rejects(
        battleA.write.claimBetWinnings([1n]),
        /AlreadyClaimed/
      );
    });

    it("should return nothing to losers", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // B bets on defender (who will lose)
      await battleB.write.placeBet([1n, false, parseEther("500")]);

      const balanceBBefore = await qlwyToken.read.balanceOf([playerB]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF - challenger wins
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      // B claims - should get 0 (losing bet)
      await battleB.write.claimBetWinnings([1n]);

      const balanceBAfter = await qlwyToken.read.balanceOf([playerB]);
      assert.equal(balanceBAfter - balanceBBefore, 0n); // No winnings
    });

    it("should pay betting fee to challenger when non-challenger claims first", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]); // High luck - will win
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]); // Low luck - will lose
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Get playerC address and transfer tokens to playerC
      const wallets = await viem.getWalletClients();
      const playerC = wallets[3].account.address;
      await qlwyToken.write.transfer([playerC, parseEther("10000")]);

      // PlayerC bets on challenger (will win)
      const { playerToken: tokenC, playerBattle: battleC } = await getPlayerContracts(3);
      await tokenC.write.approve([battle.address, parseEther("1000")]);
      await battleC.write.placeBet([1n, true, parseEther("500")]);

      // PlayerB bets on defender (will lose)
      await battleB.write.placeBet([1n, false, parseEther("1000")]);

      const balanceABefore = await qlwyToken.read.balanceOf([playerA]);
      const balanceCBefore = await qlwyToken.read.balanceOf([playerC]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF - challenger wins
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      // PlayerC claims first (not the challenger)
      await battleC.write.claimBetWinnings([1n]);

      // Check PlayerC balance: bet back (500) + 90% of losing pool (1000 * 0.90 = 900)
      //   (5% to challenger as betting fee, 5% to treasury)
      const balanceCAfter = await qlwyToken.read.balanceOf([playerC]);
      assert.equal(balanceCAfter - balanceCBefore, parseEther("1400"));

      // Check PlayerA (challenger) received betting fee: 5% of losing pool (1000 * 0.05 = 50)
      const balanceAAfter = await qlwyToken.read.balanceOf([playerA]);
      // A also gets battle winnings: 90% of (500+500) pot = 900
      assert.equal(balanceAAfter - balanceABefore, parseEther("950")); // 900 (battle) + 50 (betting fee)

      // Check betting fee paid flag
      const bettingFeePaid = await battle.read.bettingFeePaid([1n]);
      assert.equal(bettingFeePaid, true);
    });

    it("should only pay betting fee once even with multiple claimers", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Get playerC address and transfer tokens to playerC
      const wallets = await viem.getWalletClients();
      const playerC = wallets[3].account.address;
      await qlwyToken.write.transfer([playerC, parseEther("10000")]);

      // Multiple players bet on challenger
      const { playerToken: tokenC, playerBattle: battleC } = await getPlayerContracts(3);
      await tokenC.write.approve([battle.address, parseEther("1000")]);
      await battleC.write.placeBet([1n, true, parseEther("300")]);

      await battleA.write.placeBet([1n, true, parseEther("200")]);

      // PlayerB bets on defender (will lose)
      await battleB.write.placeBet([1n, false, parseEther("500")]);

      const balanceABefore = await qlwyToken.read.balanceOf([playerA]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF - challenger wins
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      // PlayerC claims first
      await battleC.write.claimBetWinnings([1n]);

      // Check betting fee paid
      const bettingFeePaidAfterC = await battle.read.bettingFeePaid([1n]);
      assert.equal(bettingFeePaidAfterC, true);

      const balanceAAfterC = await qlwyToken.read.balanceOf([playerA]);
      // A received: battle winnings (900) + betting fee (500 * 0.05 = 25)
      assert.equal(balanceAAfterC - balanceABefore, parseEther("925"));

      // PlayerA claims second
      await battleA.write.claimBetWinnings([1n]);

      const balanceAAfterA = await qlwyToken.read.balanceOf([playerA]);
      // A receives: bet back (200) + share of losing pool (450 * 200/500 = 180)
      //   (distributable pool = 500 * 0.90 = 450, after 5% to challenger + 5% to treasury)
      // No additional betting fee (already paid)
      assert.equal(balanceAAfterA - balanceAAfterC, parseEther("380"));
    });

    it("should not pay betting fee if no losing pool", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("2000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("2000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Only bet on challenger (no losing pool)
      await battleA.write.placeBet([1n, true, parseEther("500")]);

      const balanceABefore = await qlwyToken.read.balanceOf([playerA]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF - challenger wins
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      // Claim winnings
      await battleA.write.claimBetWinnings([1n]);

      // A gets: battle winnings (900) + bet back (500) + no share (no losing pool)
      const balanceAAfter = await qlwyToken.read.balanceOf([playerA]);
      assert.equal(balanceAAfter - balanceABefore, parseEther("1400"));

      // Betting fee not paid (no losing pool)
      const bettingFeePaid = await battle.read.bettingFeePaid([1n]);
      assert.equal(bettingFeePaid, false);
    });
  });

  describe("VRF Callback - Battle Resolution", () => {
    it("should resolve battle with challenger winning 3-0", async () => {
      // PlayerA (high luck) vs PlayerB (low luck)
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      const balanceABefore = await qlwyToken.read.balanceOf([playerA]);

      // Advance time and start battle (triggers VRF request)
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF - challenger wins all rounds (low random values < winChanceA)
      // winChanceA = 100 / (100 + 1) ≈ 99%, so 0-9899 will win
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      // Check battle resolved
      const battleData = await battle.read.getBattle([1n]);
      assert.equal(battleData[9], 3); // status = RESOLVED (now index 3)
      assert.equal(getAddress(battleData[10] as string), getAddress(playerA)); // winner

      const result = await battle.read.getBattleResult([1n]);
      assert.equal(result[1], 3); // challengerWins
      assert.equal(result[2], 0); // defenderWins

      // Winner should receive 90% of pot (1000 * 0.90 = 900)
      const balanceAAfter = await qlwyToken.read.balanceOf([playerA]);
      assert.equal(balanceAAfter - balanceABefore, parseEther("900"));
    });

    it("should resolve battle with defender winning 3-0", async () => {
      // PlayerA (low luck) vs PlayerB (high luck)
      const nftIdsA = await mintNFTsForPlayer(playerA, [1, 1, 1]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [100, 100, 100]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      const balanceBBefore = await qlwyToken.read.balanceOf([playerB]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Fulfill VRF - defender wins all rounds (high random values >= winChanceA)
      // winChanceA = 1 / (1 + 100) ≈ 1%, so 100-9999 will lose
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [9999n, 9999n, 9999n, 10000n]]);

      const battleData = await battle.read.getBattle([1n]);
      assert.equal(getAddress(battleData[10] as string), getAddress(playerB)); // winner = defender

      const result = await battle.read.getBattleResult([1n]);
      assert.equal(result[1], 0); // challengerWins
      assert.equal(result[2], 3); // defenderWins

      // Defender should receive 90% of pot
      const balanceBAfter = await qlwyToken.read.balanceOf([playerB]);
      assert.equal(balanceBAfter - balanceBBefore, parseEther("900"));
    });

    it("should resolve battle 2-1 correctly", async () => {
      // Equal luck - randomness determines winner
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [50, 50, 50]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // winChanceA = 50%, so <5000 wins for challenger
      // Round 1: 1000 < 5000 → challenger wins
      // Round 2: 6000 >= 5000 → defender wins
      // Round 3: 2000 < 5000 → challenger wins
      // Result: 2-1 challenger wins
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [1000n, 6000n, 2000n, 10000n]]);

      const result = await battle.read.getBattleResult([1n]);
      assert.equal(result[1], 2); // challengerWins
      assert.equal(result[2], 1); // defenderWins

      const battleData = await battle.read.getBattle([1n]);
      assert.equal(getAddress(battleData[10] as string), getAddress(playerA)); // winner
    });

    it("should burn loser NFTs based on rarity burn chance", async () => {
      // PlayerA has Rare NFTs (rarity=1, burnChance=20% = 2000 BPS)
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      // PlayerB has Rare NFTs (rarity=1, burnChance=20% = 2000 BPS)
      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Challenger wins all rounds
      // burnSeed will generate burn rolls for each round
      // Rare NFT burnChance = 2000 BPS (20%), so values < 2000 will burn
      // Using burnSeed that will cause first NFT to burn: (burnSeed >> 0) % 10000 < 2000
      const burnSeed = 500n; // First NFT burns (500 < 2000)
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, burnSeed]]);

      // Check first defender NFT is burned (sent to dead address)
      const owner1 = await coreMock.read.ownerOf([nftIdsB[0]]);
      assert.equal(getAddress(owner1 as string), getAddress(DEAD_ADDRESS));

      const result = await battle.read.getBattleResult([1n]);
      assert.equal(result[4][0], true); // defenderBurned[0]
    });

    it("should not burn NFTs when burn roll is above rarity threshold", async () => {
      // PlayerA has Rare NFTs (rarity=1)
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      // PlayerB has Rare NFTs (rarity=1, burnChance=20% = 2000 BPS)
      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Rare NFT burnChance = 2000 BPS (20%), so burnRoll needs to be >= 2000 to NOT burn
      // burnRoll = (burnSeed >> (i * 16)) % 10000
      // For each round i=0,1,2, we need the 16-bit segment to produce >= 2000 when % 10000
      // Use 5000 for each 16-bit segment: 0x1388 = 5000
      // burnSeed = 0x138813881388 (each 16-bit segment = 5000)
      const burnSeed = BigInt("0x138813881388");
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, burnSeed]]);

      // Defender NFTs returned to defender (not burned)
      const owner1 = await coreMock.read.ownerOf([nftIdsB[0]]);
      assert.equal(getAddress(owner1 as string), getAddress(playerB));

      const result = await battle.read.getBattleResult([1n]);
      assert.equal(result[4][0], false); // defenderBurned[0] = false
    });
  });

  describe("Cancel Battle", () => {
    it("should allow challenger to cancel after timeout", async () => {
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1);
      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("1000")]);
      await playerBattle.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const balanceBefore = await qlwyToken.read.balanceOf([playerA]);

      // Try to cancel before timeout - should fail
      await assert.rejects(
        playerBattle.write.cancelBattle([1n]),
        /NotExpired/
      );

      // Advance time by 24 hours + 1 second
      await publicClient.request({
        method: "evm_increaseTime" as any,
        params: [86401],
      });
      await publicClient.request({
        method: "evm_mine" as any,
        params: [],
      });

      // Now cancel should work
      await playerBattle.write.cancelBattle([1n]);

      // Check battle cancelled
      const battleData = await battle.read.getBattle([1n]);
      assert.equal(battleData[9], 4); // status = CANCELLED (now index 4)

      // NFTs and tokens returned
      const owner1 = await coreMock.read.ownerOf([nftIdsA[0]]);
      assert.equal(getAddress(owner1 as string), getAddress(playerA));

      const balanceAfter = await qlwyToken.read.balanceOf([playerA]);
      assert.equal(balanceAfter - balanceBefore, parseEther("500"));
    });

    it("should revert if non-challenger tries to cancel", async () => {
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1);
      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("1000")]);
      await playerBattle.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      // Advance time
      await publicClient.request({
        method: "evm_increaseTime" as any,
        params: [86401],
      });
      await publicClient.request({
        method: "evm_mine" as any,
        params: [],
      });

      // PlayerB tries to cancel - should fail
      const { playerBattle: battleB } = await getPlayerContracts(2);
      await assert.rejects(
        battleB.write.cancelBattle([1n]),
        /NotChallenger/
      );
    });
  });

  describe("Cancel Pending Battle (VRF Timeout)", () => {
    it("should allow anyone to cancel after VRF timeout", async () => {
      // Create and accept battle
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [50, 50, 50]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Need to start battle first (go from BETTING to PENDING)
      await advanceTimeAndStartBattle(1n);

      const balanceABefore = await qlwyToken.read.balanceOf([playerA]);
      const balanceBBefore = await qlwyToken.read.balanceOf([playerB]);

      // Try to cancel before timeout - should fail
      await assert.rejects(
        battleA.write.cancelPendingBattle([1n]),
        /NotExpired/
      );

      // Advance time by 4 hours + 1 second (VRF timeout)
      await publicClient.request({
        method: "evm_increaseTime" as any,
        params: [14401],
      });
      await publicClient.request({
        method: "evm_mine" as any,
        params: [],
      });

      // Now cancel should work
      await battleA.write.cancelPendingBattle([1n]);

      // Check battle cancelled
      const battleData = await battle.read.getBattle([1n]);
      assert.equal(battleData[9], 4); // status = CANCELLED (now index 4)

      // Both players get NFTs and tokens back
      const ownerA1 = await coreMock.read.ownerOf([nftIdsA[0]]);
      assert.equal(getAddress(ownerA1 as string), getAddress(playerA));

      const ownerB1 = await coreMock.read.ownerOf([nftIdsB[0]]);
      assert.equal(getAddress(ownerB1 as string), getAddress(playerB));

      const balanceAAfter = await qlwyToken.read.balanceOf([playerA]);
      const balanceBAfter = await qlwyToken.read.balanceOf([playerB]);
      assert.equal(balanceAAfter - balanceABefore, parseEther("500"));
      assert.equal(balanceBAfter - balanceBBefore, parseEther("500"));
    });

    it("should revert if battle is not pending", async () => {
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1);
      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("1000")]);
      await playerBattle.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      // Battle is OPEN, not PENDING
      await assert.rejects(
        playerBattle.write.cancelPendingBattle([1n]),
        /BattleNotPending/
      );
    });
  });

  describe("Admin Functions", () => {
    it("should allow owner to set min/max bet", async () => {
      await battle.write.setMinBet([parseEther("50")]);
      await battle.write.setMaxBet([parseEther("20000")]);

      const minBet = await battle.read.minBet();
      assert.equal(minBet, parseEther("50"));

      const maxBet = await battle.read.maxBet();
      assert.equal(maxBet, parseEther("20000"));
    });

    it("should allow owner to set fee bps", async () => {
      await battle.write.setFeeBps([300]); // 3%
      const feeBps = await battle.read.feeBps();
      assert.equal(feeBps, 300);
    });

    it("should revert if fee too high", async () => {
      await assert.rejects(
        battle.write.setFeeBps([2500]), // 25% - too high (max is 20%)
        /fee too high/
      );
    });

    it("should allow owner to set rarity luck bonus", async () => {
      await battle.write.setRarityLuckBonus([[0, 10, 20, 30, 40]]);
      const bonuses = await battle.read.getRarityLuckBonus();
      assert.deepEqual(bonuses, [0, 10, 20, 30, 40]);
    });

    it("should allow owner to set rarity burn chance", async () => {
      await battle.write.setRarityBurnChance([[5000, 4000, 3000, 2000, 1000]]);
      const chances = await battle.read.getRarityBurnChance();
      assert.deepEqual(chances, [5000, 4000, 3000, 2000, 1000]);
    });

    it("should allow owner to set treasury", async () => {
      const newTreasury = "0x1234567890123456789012345678901234567890";
      await battle.write.setTreasury([newTreasury]);
      const treasuryAddr = await battle.read.treasury();
      assert.equal(getAddress(treasuryAddr as string), getAddress(newTreasury));
    });

    it("should allow owner to set timeouts", async () => {
      await battle.write.setTimeouts([48 * 3600, 8 * 3600, 60 * 60]); // 48h, 8h, 1h betting
      const openTimeout = await battle.read.openTimeout();
      const vrfTimeout = await battle.read.vrfTimeout();
      const bettingDuration = await battle.read.bettingDuration();
      assert.equal(openTimeout, 48 * 3600);
      assert.equal(vrfTimeout, 8 * 3600);
      assert.equal(bettingDuration, 60 * 60);
    });

    it("should allow owner to set betting fee", async () => {
      await battle.write.setBettingFeeBps([1000]); // 10%
      const bettingFeeBps = await battle.read.bettingFeeBps();
      assert.equal(bettingFeeBps, 1000);
    });

    it("should revert if betting fee too high", async () => {
      await assert.rejects(
        battle.write.setBettingFeeBps([2500]), // 25% - too high (max is 20%)
        /fee too high/
      );
    });

    it("should allow owner to pause/unpause", async () => {
      await battle.write.pause();

      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock, playerToken, playerBattle } = await getPlayerContracts(1);
      await playerCoreMock.write.setApprovalForAll([battle.address, true]);
      await playerToken.write.approve([battle.address, parseEther("1000")]);

      // Should fail when paused
      await assert.rejects(
        playerBattle.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]),
        /EnforcedPause/
      );

      await battle.write.unpause();

      // Should work after unpause
      await playerBattle.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);
      const battleData = await battle.read.getBattle([1n]);
      assert.equal(battleData[9], 0); // status = OPEN
    });
  });

  describe("Edge Cases", () => {
    it("should handle 50-50 win chance when both have zero luck", async () => {
      const nftIdsA = await mintNFTsForPlayer(playerA, [0, 0, 0]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [0, 0, 0]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // 50-50 chance, so <5000 = challenger wins
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [1000n, 6000n, 2000n, 10000n]]);

      const result = await battle.read.getBattleResult([1n]);
      assert.equal(result[1], 2); // challengerWins
      assert.equal(result[2], 1); // defenderWins
    });

    it("should revert if VRF callback called by non-coordinator", async () => {
      const nftIdsA = await mintNFTsForPlayer(playerA, [50, 50, 50]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [50, 50, 50]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // Try to call rawFulfillRandomWords directly
      await assert.rejects(
        battle.write.rawFulfillRandomWords([1n, [1000n, 1000n, 1000n, 1000n]]),
        /only coordinator/
      );
    });

    it("should send 10% fee to treasury", async () => {
      const nftIdsA = await mintNFTsForPlayer(playerA, [100, 100, 100]);
      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      const nftIdsB = await mintNFTsForPlayer(playerB, [1, 1, 1]);
      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      const treasuryBefore = await treasuryMock.read.totalDeposited();

      await vrfMock.write.fulfillRandomWords([1n, battle.address, [100n, 100n, 100n, 10000n]]);

      const treasuryAfter = await treasuryMock.read.totalDeposited();
      // 10% of 1000 QLWY = 100 QLWY
      assert.equal(treasuryAfter - treasuryBefore, parseEther("100"));
    });
  });

  describe("Rarity Luck Bonus", () => {
    it("should apply rarity luck bonus to win chance calculation", async () => {
      // PlayerA has Mythic NFTs (rarity=4, bonus=+20) with base luck 30
      // Effective luck = 30 + 20 = 50
      // PlayerB has Common NFTs (rarity=0, bonus=+0) with base luck 49
      // Effective luck = 49 + 0 = 49
      // PlayerA should have slightly higher win chance

      // Mint Mythic NFTs for playerA (rarity=4)
      const nftIdsA: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        await coreMock.write.mintWithRarityAndLuck([playerA, 4, 30]); // Mythic, luck=30
        const nextId = await coreMock.read.nextTokenId();
        nftIdsA.push(nextId - 1n);
      }

      const { playerCoreMock: coreMockA, playerToken: tokenA, playerBattle: battleA } = await getPlayerContracts(1);
      await coreMockA.write.setApprovalForAll([battle.address, true]);
      await tokenA.write.approve([battle.address, parseEther("1000")]);
      await battleA.write.createBattle([[nftIdsA[0], nftIdsA[1], nftIdsA[2]], parseEther("500")]);

      // Mint Common NFTs for playerB (rarity=0)
      const nftIdsB: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        await coreMock.write.mintWithRarityAndLuck([playerB, 0, 49]); // Common, luck=49
        const nextId = await coreMock.read.nextTokenId();
        nftIdsB.push(nextId - 1n);
      }

      const { playerCoreMock: coreMockB, playerToken: tokenB, playerBattle: battleB } = await getPlayerContracts(2);
      await coreMockB.write.setApprovalForAll([battle.address, true]);
      await tokenB.write.approve([battle.address, parseEther("1000")]);
      await battleB.write.acceptBattle([1n, [nftIdsB[0], nftIdsB[1], nftIdsB[2]]]);

      // Advance time and start battle
      await advanceTimeAndStartBattle(1n);

      // With effective luck 50 vs 49, challenger has ~50.5% win chance
      // Random value 0 should give challenger the win
      await vrfMock.write.fulfillRandomWords([1n, battle.address, [0n, 0n, 0n, 10000n]]);

      const battleData = await battle.read.getBattle([1n]);
      assert.equal(getAddress(battleData[10] as string), getAddress(playerA)); // winner = challenger
    });
  });
});

