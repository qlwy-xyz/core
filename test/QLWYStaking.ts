import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseEther, zeroAddress, type WalletClient } from "viem";

describe("QLWYStaking", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // Contracts
  let qlwyToken: Awaited<ReturnType<typeof viem.deployContract>>;
  let staking: Awaited<ReturnType<typeof viem.deployContract>>;
  let treasury: Awaited<ReturnType<typeof viem.deployContract>>;

  // Accounts
  let owner: `0x${string}`;
  let user1: `0x${string}`;
  let user2: `0x${string}`;
  let ownerWallet: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let user1Wallet: Awaited<ReturnType<typeof viem.getWalletClients>>[0];
  let user2Wallet: Awaited<ReturnType<typeof viem.getWalletClients>>[0];

  const INITIAL_TOKEN_SUPPLY = parseEther("1000000");
  const USER_TOKEN_AMOUNT = parseEther("10000");

  // Helper function to send ETH
  async function sendETH(from: typeof ownerWallet, to: `0x${string}`, value: bigint) {
    const hash = await from.sendTransaction({
      to,
      value,
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  beforeEach(async () => {
    const wallets = await viem.getWalletClients();
    ownerWallet = wallets[0];
    user1Wallet = wallets[1];
    user2Wallet = wallets[2];
    owner = ownerWallet.account.address;
    user1 = user1Wallet.account.address;
    user2 = user2Wallet.account.address;

    // Deploy QLWY Token
    qlwyToken = await viem.deployContract("QLWYToken", [
      "QLWY Token",
      "QLWY",
      INITIAL_TOKEN_SUPPLY,
      owner,
    ]);

    // Deploy Treasury
    treasury = await viem.deployContract("QLWYTreasury", [owner]);

    // Deploy Staking
    staking = await viem.deployContract("QLWYStaking", [
      owner,
      qlwyToken.address,
      treasury.address,
    ]);

    // Setup: connect treasury to staking
    await treasury.write.setStaking([staking.address]);

    // Transfer tokens to users
    await qlwyToken.write.transfer([user1, USER_TOKEN_AMOUNT]);
    await qlwyToken.write.transfer([user2, USER_TOKEN_AMOUNT]);
  });

  describe("QLWYStaking - Basic Setup", () => {
    it("should have correct initial config", async () => {
      const tokenAddr = await staking.read.qlwyToken();
      assert.equal(tokenAddr.toLowerCase(), qlwyToken.address.toLowerCase());
      
      const treasuryAddr = await staking.read.treasury();
      assert.equal(treasuryAddr.toLowerCase(), treasury.address.toLowerCase());
      
      const totalStaked = await staking.read.totalStaked();
      assert.equal(totalStaked, 0n);
    });
  });

  describe("QLWYStaking - Stake", () => {
    it("should allow user to stake tokens", async () => {
      const stakeAmount = parseEther("1000");
      
      // Approve first
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      
      // Stake
      const txHash = await staking.write.stake([stakeAmount], { account: user1 });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      
      const stakedBalance = await staking.read.stakedBalance([user1]);
      assert.equal(stakedBalance, stakeAmount);
      
      const totalStaked = await staking.read.totalStaked();
      assert.equal(totalStaked, stakeAmount);
    });

    it("should revert when staking zero amount", async () => {
      await assert.rejects(
        staking.write.stake([0n], { account: user1 }),
        /ZeroAmount/
      );
    });

    it("should revert when paused", async () => {
      await staking.write.pause();
      const stakeAmount = parseEther("1000");
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      
      await assert.rejects(
        staking.write.stake([stakeAmount], { account: user1 }),
        /EnforcedPause/
      );
    });
  });

  describe("QLWYStaking - Unstake", () => {
    const stakeAmount = parseEther("1000");
    
    beforeEach(async () => {
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });
    });

    it("should allow user to unstake tokens", async () => {
      const unstakeAmount = parseEther("500");

      const txHash = await staking.write.unstake([unstakeAmount], { account: user1 });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const stakedBalance = await staking.read.stakedBalance([user1]);
      assert.equal(stakedBalance, stakeAmount - unstakeAmount);

      // 1% burn on unstake
      const burnAmount = (unstakeAmount * 100n) / 10000n;
      const returnAmount = unstakeAmount - burnAmount;

      const tokenBalance = await qlwyToken.read.balanceOf([user1]);
      assert.equal(tokenBalance, USER_TOKEN_AMOUNT - stakeAmount + returnAmount);
    });

    it("should revert when unstaking zero amount", async () => {
      await assert.rejects(
        staking.write.unstake([0n], { account: user1 }),
        /ZeroAmount/
      );
    });

    it("should revert when unstaking more than staked", async () => {
      await assert.rejects(
        staking.write.unstake([stakeAmount + 1n], { account: user1 }),
        /InsufficientBalance/
      );
    });
  });

  describe("QLWYStaking - Rewards", () => {
    const stakeAmount = parseEther("1000");
    const rewardAmount = parseEther("1");
    
    beforeEach(async () => {
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });
    });

    it("should distribute rewards correctly to single staker", async () => {
      // Send reward via treasury
      // Disable buyback for simpler testing (set buybackBps to 0)
      await treasury.write.setBuybackBps([0]);
      await treasury.write.setMinStakingThreshold([0n]);
      await sendETH(ownerWallet, treasury.address, rewardAmount);

      const earned = await staking.read.earned([user1]);
      // All rewards go to user1 (70% of rewardAmount due to treasury split, no buyback)
      const expectedReward = (rewardAmount * 7000n) / 10000n;
      assert.equal(earned, expectedReward);
    });

    it("should distribute rewards proportionally to multiple stakers", async () => {
      // User2 stakes same amount
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user2 });
      await staking.write.stake([stakeAmount], { account: user2 });

      // Send reward directly from owner (as treasury)
      await staking.write.notifyReward({ value: rewardAmount });

      // Each user should earn half
      const earned1 = await staking.read.earned([user1]);
      const earned2 = await staking.read.earned([user2]);

      assert.equal(earned1, rewardAmount / 2n);
      assert.equal(earned2, rewardAmount / 2n);
    });

    it("should allow user to claim rewards", async () => {
      await staking.write.notifyReward({ value: rewardAmount });

      const balanceBefore = await publicClient.getBalance({ address: user1 });
      const txHash = await staking.write.claimReward({ account: user1 });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
      const balanceAfter = await publicClient.getBalance({ address: user1 });

      // Balance should increase by reward amount minus gas
      assert.equal(balanceAfter, balanceBefore + rewardAmount - gasUsed);

      // Earned should be 0 after claim
      const earned = await staking.read.earned([user1]);
      assert.equal(earned, 0n);
    });

    it("should handle late staker correctly", async () => {
      // First reward - only user1 staked
      await staking.write.notifyReward({ value: rewardAmount });

      // User2 stakes after first reward
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user2 });
      await staking.write.stake([stakeAmount], { account: user2 });

      // User2 should not have earned from first reward
      const earned2Before = await staking.read.earned([user2]);
      assert.equal(earned2Before, 0n);

      // Second reward - both staked
      await staking.write.notifyReward({ value: rewardAmount });

      // User1 gets all of first reward + half of second
      const earned1 = await staking.read.earned([user1]);
      assert.equal(earned1, rewardAmount + rewardAmount / 2n);

      // User2 gets half of second reward only
      const earned2 = await staking.read.earned([user2]);
      assert.equal(earned2, rewardAmount / 2n);
    });

    it("should allow exit (unstake + claim)", async () => {
      await staking.write.notifyReward({ value: rewardAmount });

      const tokenBalanceBefore = await qlwyToken.read.balanceOf([user1]);
      const ethBalanceBefore = await publicClient.getBalance({ address: user1 });

      const txHash = await staking.write.exit({ account: user1 });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

      const tokenBalanceAfter = await qlwyToken.read.balanceOf([user1]);
      const ethBalanceAfter = await publicClient.getBalance({ address: user1 });

      // Token balance restored (minus 1% burn)
      const burnAmount = (stakeAmount * 100n) / 10000n;
      const returnAmount = stakeAmount - burnAmount;
      assert.equal(tokenBalanceAfter, tokenBalanceBefore + returnAmount);
      // ETH balance increased by reward minus gas
      assert.equal(ethBalanceAfter, ethBalanceBefore + rewardAmount - gasUsed);
      // Staked balance is 0
      const stakedBalance = await staking.read.stakedBalance([user1]);
      assert.equal(stakedBalance, 0n);
    });
  });

  describe("QLWYStaking - Access Control", () => {
    it("should revert notifyReward from non-treasury", async () => {
      await assert.rejects(
        staking.write.notifyReward({ account: user1, value: parseEther("1") }),
        /NotTreasury/
      );
    });

    it("should allow owner to call notifyReward", async () => {
      const stakeAmount = parseEther("1000");
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });

      // Owner can call notifyReward
      await staking.write.notifyReward({ value: parseEther("1") });

      const earned = await staking.read.earned([user1]);
      assert.equal(earned, parseEther("1"));
    });

    it("should revert notifyReward with no stakers", async () => {
      await assert.rejects(
        staking.write.notifyReward({ value: parseEther("1") }),
        /NoStakers/
      );
    });

    it("should allow owner to set treasury", async () => {
      const newTreasury = user2;
      await staking.write.setTreasury([newTreasury]);

      const treasuryAddr = await staking.read.treasury();
      assert.equal(treasuryAddr.toLowerCase(), newTreasury.toLowerCase());
    });

    it("should revert setTreasury from non-owner", async () => {
      await assert.rejects(
        staking.write.setTreasury([user2], { account: user1 }),
        /OwnableUnauthorizedAccount/
      );
    });
  });

  // =========================================================================
  // QLWYTreasury Tests
  // =========================================================================

  describe("QLWYTreasury - Basic Setup", () => {
    it("should have correct initial config", async () => {
      const stakingAddr = await treasury.read.staking();
      assert.equal(stakingAddr.toLowerCase(), staking.address.toLowerCase());

      const buybackBps = await treasury.read.buybackBps();
      assert.equal(buybackBps, 3000); // 30%

      const stakingBps = await treasury.read.stakingBps();
      assert.equal(stakingBps, 7000); // 70% of remaining

      const stakingThreshold = await treasury.read.minStakingThreshold();
      assert.equal(stakingThreshold, parseEther("0.01"));

      const buybackThreshold = await treasury.read.minBuybackThreshold();
      assert.equal(buybackThreshold, parseEther("0.01"));
    });
  });

  describe("QLWYTreasury - Receive and Split", () => {
    const sendAmount = parseEther("1");

    beforeEach(async () => {
      // User1 needs to stake first so staking can receive rewards
      const stakeAmount = parseEther("1000");
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });

      // Disable buyback for simpler split testing, lower thresholds
      await treasury.write.setBuybackBps([0]);
      await treasury.write.setMinStakingThreshold([0n]);
    });

    it("should split received BNB correctly", async () => {
      await sendETH(ownerWallet, treasury.address, sendAmount);

      // Ops balance should be 30% (no buyback, so 100% goes to staking/ops split)
      const opsBalance = await treasury.read.opsBalance();
      assert.equal(opsBalance, (sendAmount * 3000n) / 10000n);

      // Staking should have received 70%
      const earned = await staking.read.earned([user1]);
      assert.equal(earned, (sendAmount * 7000n) / 10000n);
    });

    it("should accumulate pending when below threshold", async () => {
      // Set high threshold
      await treasury.write.setMinStakingThreshold([parseEther("10")]);

      await sendETH(ownerWallet, treasury.address, sendAmount);

      // Pending should accumulate
      const pending = await treasury.read.pendingStakingBalance();
      assert.equal(pending, (sendAmount * 7000n) / 10000n);

      // Staking didn't receive anything yet
      const earned = await staking.read.earned([user1]);
      assert.equal(earned, 0n);
    });

    it("should accumulate to ops when no stakers", async () => {
      // Unstake all
      await staking.write.exit({ account: user1 });

      await sendETH(ownerWallet, treasury.address, sendAmount);

      // Pending staking balance (not transferred because no stakers)
      const pending = await treasury.read.pendingStakingBalance();
      assert.equal(pending, (sendAmount * 7000n) / 10000n);

      // Ops gets its share
      const opsBalance = await treasury.read.opsBalance();
      assert.equal(opsBalance, (sendAmount * 3000n) / 10000n);
    });
  });

  describe("QLWYTreasury - Ops Withdrawal", () => {
    beforeEach(async () => {
      // Send BNB to treasury directly (skip staking distribution)
      // First need staker
      const stakeAmount = parseEther("1000");
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });
      await treasury.write.setBuybackBps([0]);
      await treasury.write.setMinStakingThreshold([0n]);

      await sendETH(ownerWallet, treasury.address, parseEther("1"));
    });

    it("should allow owner to withdraw ops balance", async () => {
      const opsBalance = await treasury.read.opsBalance();
      const balanceBefore = await publicClient.getBalance({ address: user2 });

      await treasury.write.withdrawOps([user2, opsBalance]);

      const balanceAfter = await publicClient.getBalance({ address: user2 });
      assert.equal(balanceAfter, balanceBefore + opsBalance);

      const newOpsBalance = await treasury.read.opsBalance();
      assert.equal(newOpsBalance, 0n);
    });

    it("should revert withdrawOps if amount exceeds balance", async () => {
      const opsBalance = await treasury.read.opsBalance();

      await assert.rejects(
        treasury.write.withdrawOps([user2, opsBalance + 1n]),
        /InsufficientOpsBalance/
      );
    });

    it("should allow owner to withdraw all ops", async () => {
      const opsBalance = await treasury.read.opsBalance();
      const balanceBefore = await publicClient.getBalance({ address: user2 });

      await treasury.write.withdrawAllOps([user2]);

      const balanceAfter = await publicClient.getBalance({ address: user2 });
      assert.equal(balanceAfter, balanceBefore + opsBalance);
    });

    it("should revert withdrawAllOps if no balance", async () => {
      await treasury.write.withdrawAllOps([user2]);

      await assert.rejects(
        treasury.write.withdrawAllOps([user2]),
        /NoOpsBalance/
      );
    });

    it("should revert withdrawOps from non-owner", async () => {
      await assert.rejects(
        treasury.write.withdrawOps([user2, parseEther("0.1")], { account: user1 }),
        /OwnableUnauthorizedAccount/
      );
    });
  });

  describe("QLWYTreasury - Manual Fund Staking", () => {
    it("should allow manual fundStaking call", async () => {
      // Setup staker
      const stakeAmount = parseEther("1000");
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });

      // Disable buyback, set high threshold so auto-fund doesn't trigger
      await treasury.write.setBuybackBps([0]);
      await treasury.write.setMinStakingThreshold([parseEther("10")]);

      // Send BNB
      await sendETH(ownerWallet, treasury.address, parseEther("1"));

      // Verify pending
      const pending = await treasury.read.pendingStakingBalance();
      assert.ok(pending > 0n);

      // Lower threshold and manually fund
      await treasury.write.setMinStakingThreshold([0n]);
      await treasury.write.fundStaking();

      // Pending should be 0 now
      const pendingAfter = await treasury.read.pendingStakingBalance();
      assert.equal(pendingAfter, 0n);

      // User1 should have earned
      const earned = await staking.read.earned([user1]);
      assert.equal(earned, pending);
    });

    it("should revert fundStaking when no pending", async () => {
      await assert.rejects(
        treasury.write.fundStaking(),
        /NoPendingStaking/
      );
    });
  });

  describe("QLWYTreasury - Config Updates", () => {
    it("should allow owner to set staking bps", async () => {
      await treasury.write.setStakingBps([5000]); // 50%

      const bps = await treasury.read.stakingBps();
      assert.equal(bps, 5000);
    });

    it("should revert setStakingBps if over 100%", async () => {
      await assert.rejects(
        treasury.write.setStakingBps([10001]),
        /InvalidBps/
      );
    });

    it("should allow owner to set staking threshold", async () => {
      await treasury.write.setMinStakingThreshold([parseEther("0.5")]);

      const threshold = await treasury.read.minStakingThreshold();
      assert.equal(threshold, parseEther("0.5"));
    });

    it("should allow owner to set buyback threshold", async () => {
      await treasury.write.setMinBuybackThreshold([parseEther("0.5")]);

      const threshold = await treasury.read.minBuybackThreshold();
      assert.equal(threshold, parseEther("0.5"));
    });

    it("should allow owner to set buyback bps", async () => {
      await treasury.write.setBuybackBps([5000]);

      const bps = await treasury.read.buybackBps();
      assert.equal(bps, 5000);
    });

    it("should revert setBuybackBps if over 100%", async () => {
      await assert.rejects(
        treasury.write.setBuybackBps([10001]),
        /InvalidBps/
      );
    });

    it("should allow owner to set staking address", async () => {
      await treasury.write.setStaking([user2]);

      const stakingAddr = await treasury.read.staking();
      assert.equal(stakingAddr.toLowerCase(), user2.toLowerCase());
    });

    it("should allow owner to set router", async () => {
      const fakeRouter = user2;
      const fakeWbnb = user1;
      await treasury.write.setRouter([fakeRouter, fakeWbnb]);

      const routerAddr = await treasury.read.router();
      const wbnbAddr = await treasury.read.wbnb();
      assert.equal(routerAddr.toLowerCase(), fakeRouter.toLowerCase());
      assert.equal(wbnbAddr.toLowerCase(), fakeWbnb.toLowerCase());
    });

    it("should allow owner to set QLWY token", async () => {
      await treasury.write.setQLWYToken([qlwyToken.address]);

      const tokenAddr = await treasury.read.qlwyToken();
      assert.equal(tokenAddr.toLowerCase(), qlwyToken.address.toLowerCase());
    });
  });

  describe("QLWYTreasury - Buyback", () => {
    it("should accumulate pending buyback when router not configured", async () => {
      const sendAmount = parseEther("1");
      // buybackBps is 30% by default

      await sendETH(ownerWallet, treasury.address, sendAmount);

      // 30% should go to pending buyback
      const pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, (sendAmount * 3000n) / 10000n);
    });

    it("should revert executeBuyback when no pending", async () => {
      await treasury.write.setBuybackBps([0]);
      await assert.rejects(
        treasury.write.executeBuyback(),
        /NoPendingBuyback/
      );
    });

    it("should revert forceBuyback when router not configured", async () => {
      const sendAmount = parseEther("1");
      await sendETH(ownerWallet, treasury.address, sendAmount);

      await assert.rejects(
        treasury.write.forceBuyback(),
        /RouterNotConfigured/
      );
    });

    it("should split funds correctly with buyback enabled", async () => {
      const sendAmount = parseEther("1");
      // Default: 30% buyback, then 70% staking / 30% ops of remaining

      // Need staker
      const stakeAmount = parseEther("1000");
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });
      await treasury.write.setMinStakingThreshold([0n]);

      await sendETH(ownerWallet, treasury.address, sendAmount);

      // 30% to buyback (pending since no router)
      const pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, (sendAmount * 3000n) / 10000n);

      // Remaining 70% split: 70% to staking, 30% to ops
      const remaining = sendAmount - pendingBuyback;
      const expectedStaking = (remaining * 7000n) / 10000n;
      const expectedOps = remaining - expectedStaking;

      const earned = await staking.read.earned([user1]);
      assert.equal(earned, expectedStaking);

      const opsBalance = await treasury.read.opsBalance();
      assert.equal(opsBalance, expectedOps);
    });
  });

  describe("QLWYTreasury - Auto Buyback", () => {
    let mockRouter: Awaited<ReturnType<typeof viem.deployContract>>;
    const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD";

    beforeEach(async () => {
      // Deploy mock router
      mockRouter = await viem.deployContract("MockPancakeRouter", []);

      // Fund mock router with QLWY tokens for swaps
      await qlwyToken.write.transfer([mockRouter.address, parseEther("100000")]);

      // Configure treasury with router and token
      await treasury.write.setRouter([mockRouter.address, qlwyToken.address]); // Using qlwyToken as fake WBNB
      await treasury.write.setQLWYToken([qlwyToken.address]);
      await treasury.write.setMinBuybackThreshold([0n]); // No threshold for testing
    });

    it("should auto-execute buyback when configured", async () => {
      const sendAmount = parseEther("1");

      // Check dead address balance before
      const deadBalanceBefore = await qlwyToken.read.balanceOf([DEAD_ADDRESS]);

      await sendETH(ownerWallet, treasury.address, sendAmount);

      // Pending buyback should be 0 (executed)
      const pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, 0n);

      // Dead address should have received tokens
      const deadBalanceAfter = await qlwyToken.read.balanceOf([DEAD_ADDRESS]);
      const burned = deadBalanceAfter - deadBalanceBefore;

      // 30% of 1 BNB = 0.3 BNB, at 1000x rate = 300 QLWY
      const expectedBuyback = (sendAmount * 3000n) / 10000n;
      const expectedBurned = expectedBuyback * 1000n; // Mock router rate
      assert.equal(burned, expectedBurned);
    });

    it("should accumulate pending when below threshold", async () => {
      // Set high threshold
      await treasury.write.setMinBuybackThreshold([parseEther("1")]);

      const sendAmount = parseEther("0.1");
      await sendETH(ownerWallet, treasury.address, sendAmount);

      // Should accumulate, not execute
      const pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, (sendAmount * 3000n) / 10000n);

      // Dead address should not have received tokens
      const deadBalance = await qlwyToken.read.balanceOf([DEAD_ADDRESS]);
      assert.equal(deadBalance, 0n);
    });

    it("should execute when threshold reached", async () => {
      // Set threshold
      await treasury.write.setMinBuybackThreshold([parseEther("0.1")]);

      // First send - below threshold
      await sendETH(ownerWallet, treasury.address, parseEther("0.2"));
      // 0.2 * 30% = 0.06 BNB pending (below 0.1 threshold)

      let pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, parseEther("0.06"));

      // Second send - should trigger (0.06 + 0.06 = 0.12 >= 0.1)
      await sendETH(ownerWallet, treasury.address, parseEther("0.2"));

      pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, 0n);

      // Dead address should have received tokens
      const deadBalance = await qlwyToken.read.balanceOf([DEAD_ADDRESS]);
      assert.ok(deadBalance > 0n);
    });

    it("should restore pending if swap fails", async () => {
      // Make router fail
      await mockRouter.write.setShouldFail([true]);

      const sendAmount = parseEther("1");
      await sendETH(ownerWallet, treasury.address, sendAmount);

      // Should restore to pending
      const pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, (sendAmount * 3000n) / 10000n);

      // Dead address should not have received tokens
      const deadBalance = await qlwyToken.read.balanceOf([DEAD_ADDRESS]);
      assert.equal(deadBalance, 0n);
    });

    it("should execute manual buyback after router fixed", async () => {
      // Make router fail first
      await mockRouter.write.setShouldFail([true]);

      const sendAmount = parseEther("1");
      await sendETH(ownerWallet, treasury.address, sendAmount);

      // Pending should have accumulated
      let pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.ok(pendingBuyback > 0n);

      // Fix router
      await mockRouter.write.setShouldFail([false]);

      // Manual trigger
      await treasury.write.executeBuyback();

      // Pending should be 0 now
      pendingBuyback = await treasury.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, 0n);

      // Dead address should have received tokens
      const deadBalance = await qlwyToken.read.balanceOf([DEAD_ADDRESS]);
      assert.ok(deadBalance > 0n);
    });

    it("should not execute buyback when router not configured", async () => {
      // Create new treasury without router
      const treasuryNoRouter = await viem.deployContract("QLWYTreasury", [owner]);
      await treasuryNoRouter.write.setMinBuybackThreshold([0n]);

      const sendAmount = parseEther("1");
      await sendETH(ownerWallet, treasuryNoRouter.address, sendAmount);

      // Should accumulate pending
      const pendingBuyback = await treasuryNoRouter.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, (sendAmount * 3000n) / 10000n);
    });

    it("should not execute buyback when qlwyToken not configured", async () => {
      // Create new treasury with router but no token
      const treasuryNoToken = await viem.deployContract("QLWYTreasury", [owner]);
      await treasuryNoToken.write.setRouter([mockRouter.address, qlwyToken.address]);
      await treasuryNoToken.write.setMinBuybackThreshold([0n]);

      const sendAmount = parseEther("1");
      await sendETH(ownerWallet, treasuryNoToken.address, sendAmount);

      // Should accumulate pending
      const pendingBuyback = await treasuryNoToken.read.pendingBuybackBalance();
      assert.equal(pendingBuyback, (sendAmount * 3000n) / 10000n);
    });
  });

  // =========================================================================
  // Integration Tests
  // =========================================================================

  describe("Integration - Full Flow", () => {
    it("should handle multiple reward cycles correctly", async () => {
      const stakeAmount = parseEther("1000");
      const rewardAmount = parseEther("1");

      await treasury.write.setBuybackBps([0]);
      await treasury.write.setMinStakingThreshold([0n]);

      // User1 stakes
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });

      // First reward
      await sendETH(ownerWallet, treasury.address, rewardAmount);

      const earned1After1 = await staking.read.earned([user1]);
      const expectedReward1 = (rewardAmount * 7000n) / 10000n;
      assert.equal(earned1After1, expectedReward1);

      // User2 stakes
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user2 });
      await staking.write.stake([stakeAmount], { account: user2 });

      // Second reward
      await sendETH(ownerWallet, treasury.address, rewardAmount);

      // User1 has first full reward + half of second
      const earned1After2 = await staking.read.earned([user1]);
      assert.equal(earned1After2, expectedReward1 + expectedReward1 / 2n);

      // User2 has half of second reward
      const earned2After2 = await staking.read.earned([user2]);
      assert.equal(earned2After2, expectedReward1 / 2n);
    });

    it("should handle user exiting and rejoining", async () => {
      const stakeAmount = parseEther("1000");
      const rewardAmount = parseEther("1");

      await treasury.write.setBuybackBps([0]);
      await treasury.write.setMinStakingThreshold([0n]);

      // User1 stakes
      await qlwyToken.write.approve([staking.address, stakeAmount * 2n], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });

      // First reward
      await sendETH(ownerWallet, treasury.address, rewardAmount);

      // User1 exits
      await staking.write.exit({ account: user1 });

      // User2 stakes
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user2 });
      await staking.write.stake([stakeAmount], { account: user2 });

      // Second reward
      await sendETH(ownerWallet, treasury.address, rewardAmount);

      // User1 rejoins
      await staking.write.stake([stakeAmount], { account: user1 });

      // User1 should have no earned (just rejoined)
      const earned1 = await staking.read.earned([user1]);
      assert.equal(earned1, 0n);

      // User2 should have second full reward
      const expectedReward = (rewardAmount * 7000n) / 10000n;
      const earned2 = await staking.read.earned([user2]);
      assert.equal(earned2, expectedReward);
    });

    it("should distribute rewards with different stake amounts", async () => {
      const stake1 = parseEther("3000"); // 75%
      const stake2 = parseEther("1000"); // 25%
      const rewardAmount = parseEther("1");

      await treasury.write.setBuybackBps([0]);
      await treasury.write.setMinStakingThreshold([0n]);

      // User1 stakes 3x more
      await qlwyToken.write.approve([staking.address, stake1], { account: user1 });
      await staking.write.stake([stake1], { account: user1 });

      await qlwyToken.write.approve([staking.address, stake2], { account: user2 });
      await staking.write.stake([stake2], { account: user2 });

      // Reward
      await sendETH(ownerWallet, treasury.address, rewardAmount);

      const stakingReward = (rewardAmount * 7000n) / 10000n;

      // User1 should get 75%
      const earned1 = await staking.read.earned([user1]);
      assert.equal(earned1, (stakingReward * 3n) / 4n);

      // User2 should get 25%
      const earned2 = await staking.read.earned([user2]);
      assert.equal(earned2, stakingReward / 4n);
    });

    it("should handle treasury with no staking contract", async () => {
      const sendAmount = parseEther("1");

      // Create new treasury without staking
      const treasuryNoStaking = await viem.deployContract("QLWYTreasury", [owner]);
      // Disable buyback for simpler testing
      await treasuryNoStaking.write.setBuybackBps([0]);

      // Send BNB
      await sendETH(ownerWallet, treasuryNoStaking.address, sendAmount);

      // All goes to pending (can't send to staking)
      const pending = await treasuryNoStaking.read.pendingStakingBalance();
      assert.equal(pending, (sendAmount * 7000n) / 10000n);

      // Ops still gets its share
      const opsBalance = await treasuryNoStaking.read.opsBalance();
      assert.equal(opsBalance, (sendAmount * 3000n) / 10000n);
    });
  });

  describe("Edge Cases", () => {
    it("should handle zero staking bps (all to ops)", async () => {
      const sendAmount = parseEther("1");

      await treasury.write.setBuybackBps([0]);
      await treasury.write.setStakingBps([0]);

      await sendETH(ownerWallet, treasury.address, sendAmount);

      // All to ops
      const opsBalance = await treasury.read.opsBalance();
      assert.equal(opsBalance, sendAmount);

      // None to staking
      const pending = await treasury.read.pendingStakingBalance();
      assert.equal(pending, 0n);
    });

    it("should handle 100% staking bps (all to staking)", async () => {
      const sendAmount = parseEther("1");
      const stakeAmount = parseEther("1000");

      await treasury.write.setBuybackBps([0]);
      await treasury.write.setStakingBps([10000]);
      await treasury.write.setMinStakingThreshold([0n]);

      // Need staker
      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });

      await sendETH(ownerWallet, treasury.address, sendAmount);

      // None to ops
      const opsBalance = await treasury.read.opsBalance();
      assert.equal(opsBalance, 0n);

      // All to staking
      const earned = await staking.read.earned([user1]);
      assert.equal(earned, sendAmount);
    });

    it("should handle very small reward amounts", async () => {
      // Use 1 token staked so small rewards don't get rounded to zero
      const stakeAmount = parseEther("1"); // 1 token
      const tinyReward = 1000n; // 1000 wei - needs to be >= stake amount to avoid precision loss

      await qlwyToken.write.approve([staking.address, stakeAmount], { account: user1 });
      await staking.write.stake([stakeAmount], { account: user1 });

      await staking.write.notifyReward({ value: tinyReward });

      const earned = await staking.read.earned([user1]);
      assert.equal(earned, tinyReward);
    });

    it("should handle large stake amounts", async () => {
      // Give user1 more tokens
      await qlwyToken.write.mint([user1, parseEther("1000000000")]);

      const hugeStake = parseEther("1000000000"); // 1 billion tokens
      const rewardAmount = parseEther("1000");

      await qlwyToken.write.approve([staking.address, hugeStake], { account: user1 });
      await staking.write.stake([hugeStake], { account: user1 });

      await staking.write.notifyReward({ value: rewardAmount });

      const earned = await staking.read.earned([user1]);
      assert.equal(earned, rewardAmount);
    });
  });
});

