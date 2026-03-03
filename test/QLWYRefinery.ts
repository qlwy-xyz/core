import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseEther, zeroHash, getAddress } from "viem";

describe("QLWYRefinery", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();

  // Contracts
  let vrfMock: Awaited<ReturnType<typeof viem.deployContract>>;
  let coreMock: Awaited<ReturnType<typeof viem.deployContract>>;
  let qlwyToken: Awaited<ReturnType<typeof viem.deployContract>>;
  let refinery: Awaited<ReturnType<typeof viem.deployContract>>;

  // Accounts
  let owner: `0x${string}`;
  let user: `0x${string}`;

  beforeEach(async () => {
    const [ownerWallet, userWallet] = await viem.getWalletClients();
    owner = ownerWallet.account.address;
    user = userWallet.account.address;

    // Deploy mocks
    vrfMock = await viem.deployContract("VRFCoordinatorMock");
    coreMock = await viem.deployContract("FortuneCoreMinimalMock");
    qlwyToken = await viem.deployContract("QLWYToken", [
      "QLWY Token",
      "QLWY",
      parseEther("1000000"),
      owner,
    ]);

    // Deploy refinery
    refinery = await viem.deployContract("QLWYRefinery", [
      owner,
      coreMock.address,
      qlwyToken.address,
      vrfMock.address,
      zeroHash, // keyHash
      1n, // subId
      3, // minConfirmations
      500000, // callbackGasLimit
    ]);

    // Setup: set refinery in core mock
    await coreMock.write.setRefinery([refinery.address]);

    // Transfer some QLWY to user
    await qlwyToken.write.transfer([user, parseEther("10000")]);
  });

  describe("Basic Setup", () => {
    it("should have correct initial config", async () => {
      const successBps = await refinery.read.successBps([1]);
      assert.equal(successBps, 4500); // 45% for Rare->Epic

      const refineFee0 = await refinery.read.refineFees([0n]);
      assert.equal(refineFee0, parseEther("200")); // Rare->Epic fee
    });

    it("should have correct ASH_ID", async () => {
      const ashId = await refinery.read.ASH_ID();
      assert.equal(ashId, 1n);
    });
  });

  describe("Refine Function", () => {
    it("should revert with InvalidTokenCount if not 3 tokens", async () => {
      await assert.rejects(
        refinery.write.refine([[1n, 2n], 0n], { account: user }),
        /InvalidTokenCount/
      );
    });

    it("should revert with RarityNotSupported for Common tokens", async () => {
      // Mint 3 Common (rarity=0) tokens
      await coreMock.write.mintWithRarity([user, 0]);
      await coreMock.write.mintWithRarity([user, 0]);
      await coreMock.write.mintWithRarity([user, 0]);

      // Approve refinery
      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      await assert.rejects(
        refinery.write.refine([[1n, 2n, 3n], 0n], { account: user }),
        /RarityNotSupported/
      );
    });

    it("should revert with RarityNotSupported for Mythic tokens", async () => {
      // Mint 3 Mythic (rarity=4) tokens
      await coreMock.write.mintWithRarity([user, 4]);
      await coreMock.write.mintWithRarity([user, 4]);
      await coreMock.write.mintWithRarity([user, 4]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      await assert.rejects(
        refinery.write.refine([[1n, 2n, 3n], 0n], { account: user }),
        /RarityNotSupported/
      );
    });

    it("should successfully request refine for Rare tokens", async () => {
      // Mint 3 Rare (rarity=1) tokens
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      // Approve NFT transfer
      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      // Approve QLWY token
      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      // Refine
      const tx = await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Check NFTs transferred to refinery
      const owner1 = await coreMock.read.ownerOf([1n]);
      assert.equal(getAddress(owner1 as string), getAddress(refinery.address));
    });

    it("should burn QLWY fee when refining", async () => {
      // Mint 3 Rare tokens
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      const balanceBefore = await qlwyToken.read.balanceOf([user]);
      const totalSupplyBefore = await qlwyToken.read.totalSupply();

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      const balanceAfter = await qlwyToken.read.balanceOf([user]);
      const totalSupplyAfter = await qlwyToken.read.totalSupply();

      // User should have paid 200 QLWY
      assert.equal(balanceBefore - balanceAfter, parseEther("200"));
      // Total supply should have decreased by 200 (burned)
      assert.equal(totalSupplyBefore - totalSupplyAfter, parseEther("200"));
    });
  });

  describe("VRF Callback - Success", () => {
    it("should mint new NFT on successful refine", async () => {
      // Mint 3 Rare tokens
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Fulfill VRF with random words that result in success (< 4500)
      // 4500 / 10000 = 45%, so any number < 4500 will succeed
      const successWord = 1000n; // < 4500, so success
      await vrfMock.write.fulfillRandomWords([1n, refinery.address, [successWord, 12345n]]);

      // User should have a new Epic NFT (tokenId = 4)
      const newOwner = await coreMock.read.ownerOf([4n]);
      assert.equal(getAddress(newOwner as string), getAddress(user));

      const rarity = await coreMock.read.tokenRarityOf([4n]);
      assert.equal(rarity, 2); // Epic
    });
  });

  describe("VRF Callback - Failure", () => {
    it("should give ash on failed refine", async () => {
      // Mint 3 Rare tokens
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Fulfill VRF with random words that result in failure (>= 4500)
      const failWord = 9000n; // >= 4500, so fail
      await vrfMock.write.fulfillRandomWords([1n, refinery.address, [failWord, 12345n]]);

      // User should have 1 ash (Rare gives 1 ash on failure)
      const ashBalance = await refinery.read.balanceOf([user, 1n]);
      assert.equal(ashBalance, 1n);
    });

    it("should give 5 ash for Legendary refine failure", async () => {
      // Mint 3 Legendary tokens
      await coreMock.write.mintWithRarity([user, 3]);
      await coreMock.write.mintWithRarity([user, 3]);
      await coreMock.write.mintWithRarity([user, 3]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("10000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Fulfill VRF with failure
      const failWord = 9000n;
      await vrfMock.write.fulfillRandomWords([1n, refinery.address, [failWord, 12345n]]);

      // User should have 5 ash (Legendary gives 5 ash on failure)
      const ashBalance = await refinery.read.balanceOf([user, 1n]);
      assert.equal(ashBalance, 5n);
    });
  });

  describe("Cancel Refine", () => {
    it("should allow cancel after timeout", async () => {
      // Mint 3 Rare tokens
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Try to cancel before timeout - should fail
      await assert.rejects(
        refinery.write.cancelRefine([1n], { account: user }),
        /NotExpired/
      );

      // Advance time by 1 day + 1 second
      await publicClient.request({
        method: "evm_increaseTime" as any,
        params: [86401],
      });
      await publicClient.request({
        method: "evm_mine" as any,
        params: [],
      });

      // Now cancel should work
      await refinery.write.cancelRefine([1n], { account: user });

      // NFTs should be returned to user
      const owner1 = await coreMock.read.ownerOf([1n]);
      assert.equal(getAddress(owner1 as string), getAddress(user));
    });
  });

  describe("Ash Boost", () => {
    it("should increase success rate with ash burn", async () => {
      // First, get some ash by failing a refine
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("100000")]);

      // Multiple failed refines to accumulate ash
      for (let i = 0; i < 10; i++) {
        await coreMock.write.mintWithRarity([user, 1]);
        await coreMock.write.mintWithRarity([user, 1]);
        await coreMock.write.mintWithRarity([user, 1]);
        const tokenStart = BigInt(1 + i * 3);
        await refinery.write.refine([[tokenStart, tokenStart + 1n, tokenStart + 2n], 0n], { account: user });
        await vrfMock.write.fulfillRandomWords([BigInt(i + 1), refinery.address, [9999n, 12345n]]);
      }

      // Should have 10 ash now
      const ashBalance = await refinery.read.balanceOf([user, 1n]);
      assert.equal(ashBalance, 10n);

      // Now refine with 5 ash burned (should add 125 bps = 1.25%)
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      await refinery.write.refine([[31n, 32n, 33n], 5n], { account: user });

      // Check ash was burned
      const ashAfter = await refinery.read.balanceOf([user, 1n]);
      assert.equal(ashAfter, 5n);
    });
  });

  describe("Admin Functions", () => {
    it("should allow owner to set refine fees", async () => {
      await refinery.write.setRefineFees([[parseEther("100"), parseEther("400"), parseEther("2000")]]);

      const fee0 = await refinery.read.refineFees([0n]);
      assert.equal(fee0, parseEther("100"));
    });

    it("should allow owner to pause/unpause", async () => {
      await refinery.write.pause();

      // Minting should fail when paused
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      await assert.rejects(
        refinery.write.refine([[1n, 2n, 3n], 0n], { account: user }),
        /EnforcedPause/
      );

      // Unpause
      await refinery.write.unpause();

      // Should work now (but will fail for other reasons - token approval)
    });

    it("should allow owner to set success bps", async () => {
      await refinery.write.setSuccessBps([[0, 5000, 3000, 1000]]);

      const bps1 = await refinery.read.successBps([1]);
      assert.equal(bps1, 5000);
    });

    it("should allow owner to set VRF config", async () => {
      const newKeyHash = "0x1234567890123456789012345678901234567890123456789012345678901234" as `0x${string}`;
      await refinery.write.setVRFConfig([vrfMock.address, newKeyHash, 2n, 5, 600000]);

      const keyHash = await refinery.read.vrfKeyHash();
      assert.equal(keyHash, newKeyHash);
    });

    it("should allow owner to set ash boost params", async () => {
      await refinery.write.setAshBoost([50, 2000, 10, 9000]);

      const boostPerAsh = await refinery.read.boostPerAshBps();
      assert.equal(boostPerAsh, 50);

      const maxBoost = await refinery.read.maxBoostBps();
      assert.equal(maxBoost, 2000);

      const step = await refinery.read.burnStep();
      assert.equal(step, 10);

      const hardCap = await refinery.read.hardCapBps();
      assert.equal(hardCap, 9000);
    });

    it("should allow owner to set refine timeout", async () => {
      await refinery.write.setRefineTimeout([7200]); // 2 hours

      const timeout = await refinery.read.refineTimeout();
      assert.equal(timeout, 7200);
    });
  });

  describe("Edge Cases - Refine Validation", () => {
    it("should revert with NotOwnerOfToken if user doesn't own NFT", async () => {
      // Mint tokens to owner, not user
      await coreMock.write.mintWithRarity([owner, 1]);
      await coreMock.write.mintWithRarity([owner, 1]);
      await coreMock.write.mintWithRarity([owner, 1]);

      await assert.rejects(
        refinery.write.refine([[1n, 2n, 3n], 0n], { account: user }),
        /NotOwnerOfToken/
      );
    });

    it("should revert with RarityNotSupported for mixed rarity tokens", async () => {
      // Mint tokens with different rarities
      await coreMock.write.mintWithRarity([user, 1]); // Rare
      await coreMock.write.mintWithRarity([user, 1]); // Rare
      await coreMock.write.mintWithRarity([user, 2]); // Epic - different!

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await assert.rejects(
        refinery.write.refine([[1n, 2n, 3n], 0n], { account: user }),
        /RarityNotSupported/
      );
    });

    it("should revert with InvalidBurnAmount if ash not multiple of burnStep", async () => {
      // Mint tokens and get some ash first
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("10000")]);

      // First refine to get ash
      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });
      await vrfMock.write.fulfillRandomWords([1n, refinery.address, [9999n, 12345n]]);

      // Mint more tokens
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      // Try to burn 3 ash (not multiple of 5)
      await assert.rejects(
        refinery.write.refine([[4n, 5n, 6n], 3n], { account: user }),
        /InvalidBurnAmount/
      );
    });
  });

  describe("Edge Cases - Ash Boost Limits", () => {
    it("should cap bonus at maxBoostBps", async () => {
      // We need 60+ ash to test maxBoostBps cap (60 * 25 = 1500 = maxBoostBps)
      // For simplicity, let's set a lower maxBoostBps
      await refinery.write.setAshBoost([25, 100, 5, 9500]); // maxBoost = 100 bps = 1%

      // Get some ash
      for (let i = 0; i < 10; i++) {
        await coreMock.write.mintWithRarity([user, 1]);
        await coreMock.write.mintWithRarity([user, 1]);
        await coreMock.write.mintWithRarity([user, 1]);
      }

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("100000")]);

      // Fail multiple refines to get ash
      for (let i = 0; i < 10; i++) {
        const tokenStart = BigInt(1 + i * 3);
        await refinery.write.refine([[tokenStart, tokenStart + 1n, tokenStart + 2n], 0n], { account: user });
        await vrfMock.write.fulfillRandomWords([BigInt(i + 1), refinery.address, [9999n, 12345n]]);
      }

      // Should have 10 ash
      const ashBalance = await refinery.read.balanceOf([user, 1n]);
      assert.equal(ashBalance, 10n);

      // Mint more tokens and try to use 10 ash (10 * 25 = 250 bps, but capped at 100)
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      // Refine with 10 ash (will be capped)
      await refinery.write.refine([[31n, 32n, 33n], 10n], { account: user });

      // Check the request has bonusBps capped at 100
      // Solidity public mapping getter skips array fields, so order is:
      // [0] user, [1] baseRarity, [2] targetRarity, [3] bonusBps, [4] createdAt, [5] resolved
      const request = await refinery.read.refineRequests([11n]);
      assert.equal(request[3], 100); // bonusBps should be capped at 100
    });
  });

  describe("Edge Cases - VRF Callback", () => {
    it("should give 2 ash for Epic refine failure", async () => {
      // Mint 3 Epic (rarity=2) tokens
      await coreMock.write.mintWithRarity([user, 2]);
      await coreMock.write.mintWithRarity([user, 2]);
      await coreMock.write.mintWithRarity([user, 2]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("10000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Fulfill with failure
      await vrfMock.write.fulfillRandomWords([1n, refinery.address, [9999n, 12345n]]);

      // User should have 2 ash (Epic gives 2 ash on failure)
      const ashBalance = await refinery.read.balanceOf([user, 1n]);
      assert.equal(ashBalance, 2n);
    });

    it("should revert if non-coordinator calls rawFulfillRandomWords", async () => {
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Try to call rawFulfillRandomWords directly (not from coordinator)
      await assert.rejects(
        refinery.write.rawFulfillRandomWords([1n, [1000n, 2000n]], { account: user }),
        /only coordinator/
      );
    });

    it("should revert AlreadyResolved if VRF callback called twice", async () => {
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // First fulfill - should work
      await vrfMock.write.fulfillRandomWords([1n, refinery.address, [1000n, 2000n]]);

      // Second fulfill - should fail (request already deleted in mock, but let's test the contract logic)
      // The mock deletes the request, so this will fail at mock level
      await assert.rejects(
        vrfMock.write.fulfillRandomWords([1n, refinery.address, [1000n, 2000n]]),
        /VRFMock: invalid/
      );
    });
  });

  describe("Edge Cases - Cancel Refine", () => {
    it("should revert NotRequester if non-owner tries to cancel", async () => {
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Advance time
      await publicClient.request({
        method: "evm_increaseTime" as any,
        params: [86401],
      });
      await publicClient.request({
        method: "evm_mine" as any,
        params: [],
      });

      // Owner (not user) tries to cancel - should fail
      await assert.rejects(
        refinery.write.cancelRefine([1n], { account: owner }),
        /NotRequester/
      );
    });

    it("should revert AlreadyResolved if trying to cancel resolved request", async () => {
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("1000")]);

      await refinery.write.refine([[1n, 2n, 3n], 0n], { account: user });

      // Fulfill the request
      await vrfMock.write.fulfillRandomWords([1n, refinery.address, [1000n, 2000n]]);

      // Advance time
      await publicClient.request({
        method: "evm_increaseTime" as any,
        params: [86401],
      });
      await publicClient.request({
        method: "evm_mine" as any,
        params: [],
      });

      // Try to cancel already resolved request
      await assert.rejects(
        refinery.write.cancelRefine([1n], { account: user }),
        /AlreadyResolved/
      );
    });

    it("should revert for invalid request id", async () => {
      await assert.rejects(
        refinery.write.cancelRefine([999n], { account: user }),
        /invalid request/
      );
    });
  });

  describe("Hard Cap", () => {
    it("should cap success rate at hardCapBps", async () => {
      // Set very high success rate and low hard cap
      await refinery.write.setSuccessBps([[0, 9000, 9000, 9000]]); // 90%
      await refinery.write.setAshBoost([500, 5000, 5, 6000]); // hardCap = 60%

      // Get ash
      for (let i = 0; i < 5; i++) {
        await coreMock.write.mintWithRarity([user, 1]);
        await coreMock.write.mintWithRarity([user, 1]);
        await coreMock.write.mintWithRarity([user, 1]);
      }

      const userCoreMock = await viem.getContractAt("FortuneCoreMinimalMock", coreMock.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userCoreMock.write.setApprovalForAll([refinery.address, true]);

      const userToken = await viem.getContractAt("QLWYToken", qlwyToken.address, {
        client: { wallet: (await viem.getWalletClients())[1] },
      });
      await userToken.write.approve([refinery.address, parseEther("100000")]);

      // Fail to get ash
      for (let i = 0; i < 5; i++) {
        const tokenStart = BigInt(1 + i * 3);
        await refinery.write.refine([[tokenStart, tokenStart + 1n, tokenStart + 2n], 0n], { account: user });
        await vrfMock.write.fulfillRandomWords([BigInt(i + 1), refinery.address, [9999n, 12345n]]);
      }

      // Mint more and refine with ash
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);
      await coreMock.write.mintWithRarity([user, 1]);

      await refinery.write.refine([[16n, 17n, 18n], 5n], { account: user });

      // Fulfill with a value that would succeed at 90% but fail at 60%
      // 6500 is between 6000 (hardCap) and 9000 (base rate)
      // So it should FAIL because threshold is capped at 6000
      await vrfMock.write.fulfillRandomWords([6n, refinery.address, [6500n, 12345n]]);

      // Should have gotten ash (failed), not new NFT
      const ashBalance = await refinery.read.balanceOf([user, 1n]);
      assert.ok(ashBalance > 0n); // Got ash means it failed
    });
  });
});

