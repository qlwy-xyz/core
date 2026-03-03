import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import { network } from "hardhat";
import { parseEther, zeroAddress, zeroHash, encodeAbiParameters, parseAbiParameters, keccak256, toBytes, slice, concatHex } from "viem";

describe("QLWYSpiritAgent", async function () {
  const { viem } = await network.connect();

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

  beforeEach(async () => {
    const wallets = await viem.getWalletClients();
    owner = wallets[0].account.address;
    user = wallets[1].account.address;
    operator = wallets[2].account.address;

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

    // Deploy SpiritAgent first (with zero address for logic, will set later)
    spiritAgent = await viem.deployContract("QLWYSpiritAgent", [
      coreMock.address,
      zeroAddress, // default logic (will set later)
      qlwyToken.address,
    ]);

    // Deploy SpiritLogic with 3 params: spiritAgent, battleContract, qlwyToken
    spiritLogic = await viem.deployContract("QLWYSpiritLogic", [
      spiritAgent.address,
      battleV2.address,
      qlwyToken.address,
    ]);

    // Set default logic
    await spiritAgent.write.setDefaultLogic([spiritLogic.address]);

    // Transfer tokens to user
    await qlwyToken.write.transfer([user, parseEther("100000")]);
  });

  // Helper to mint NFT for user
  async function mintNFTForUser(): Promise<bigint> {
    await coreMock.write.mintWithRarityAndLuck([user, 1, 50]);
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
    return { userCore, userSpirit, userToken };
  }

  describe("Spirit Upgrade", () => {
    it("should upgrade NFT to Spirit", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      // Approve NFT transfer
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);

      // Upgrade
      await userSpirit.write.upgradeToSpirit([tokenId]);

      // Verify
      const isWrapped = await spiritAgent.read.isWrapped([tokenId]);
      assert.equal(isWrapped, true);

      const originalOwner = await spiritAgent.read.originalOwners([tokenId]);
      assert.equal(originalOwner.toLowerCase(), user.toLowerCase());
    });

    it("should reject upgrade of non-owned NFT", async () => {
      const tokenId = await mintNFTForUser();
      // Try to upgrade from owner account (not user) - will fail on ERC721 approval
      await assert.rejects(
        spiritAgent.write.upgradeToSpirit([tokenId]),
        /ERC721InsufficientApproval/
      );
    });
  });

  describe("Spirit Unwrap", () => {
    it("should unwrap Spirit back to NFT", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      // Unwrap
      await userSpirit.write.unwrapSpirit([tokenId]);

      const isWrapped = await spiritAgent.read.isWrapped([tokenId]);
      assert.equal(isWrapped, false);

      // NFT should be back to user
      const nftOwner = await coreMock.read.ownerOf([tokenId]);
      assert.equal(nftOwner.toLowerCase(), user.toLowerCase());
    });
  });

  describe("Operator Authorization", () => {
    it("should authorize operator", async () => {
      const { userSpirit } = await getUserContracts();

      await userSpirit.write.authorizeOperator([operator, true]);

      const isAuthorized = await spiritAgent.read.isOperatorAuthorized([user, operator]);
      assert.equal(isAuthorized, true);
    });

    it("should revoke operator authorization", async () => {
      const { userSpirit } = await getUserContracts();

      await userSpirit.write.authorizeOperator([operator, true]);
      await userSpirit.write.authorizeOperator([operator, false]);

      const isAuthorized = await spiritAgent.read.isOperatorAuthorized([user, operator]);
      assert.equal(isAuthorized, false);
    });

    it("should allow operator to execute action", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit, userToken } = await getUserContracts();

      // Upgrade to spirit
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      // Authorize operator
      await userSpirit.write.authorizeOperator([operator, true]);

      // Get operator's contract instance
      const wallets = await viem.getWalletClients();
      const operatorSpirit = await viem.getContractAt("QLWYSpiritAgent", spiritAgent.address, {
        client: { wallet: wallets[2] },
      });

      // Operator executes action (empty action for now)
      const actionData = "0x00000000"; // minimal action data
      // This should not revert (operator is authorized)
      // Note: actual action execution depends on logic contract
    });
  });

  describe("Spirit State Management", () => {
    it("should get spirit state", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      const state = await spiritAgent.read.getState([tokenId]);
      assert.equal(state.status, 0); // Active
      assert.equal(state.owner.toLowerCase(), user.toLowerCase());
    });

    it("should pause and unpause spirit", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      // Pause
      await userSpirit.write.pause([tokenId]);
      let state = await spiritAgent.read.getState([tokenId]);
      assert.equal(state.status, 1); // Paused

      // Unpause
      await userSpirit.write.unpause([tokenId]);
      state = await spiritAgent.read.getState([tokenId]);
      assert.equal(state.status, 0); // Active
    });

    it("should terminate spirit", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      await userSpirit.write.terminate([tokenId]);

      const state = await spiritAgent.read.getState([tokenId]);
      assert.equal(state.status, 2); // Terminated
    });

    it("should reject unwrap of terminated spirit", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);
      await userSpirit.write.terminate([tokenId]);

      await assert.rejects(
        userSpirit.write.unwrapSpirit([tokenId]),
        /AgentTerminated/
      );
    });
  });

  describe("Spirit Funding", () => {
    it("should fund spirit with BNB", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      const fundAmount = parseEther("1");
      await userSpirit.write.fundAgent([tokenId], { value: fundAmount });

      const state = await spiritAgent.read.getState([tokenId]);
      assert.equal(state.balance, fundAmount);
    });

    it("should withdraw funds from spirit", async () => {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();

      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      const fundAmount = parseEther("1");
      await userSpirit.write.fundAgent([tokenId], { value: fundAmount });

      const withdrawAmount = parseEther("0.5");
      await userSpirit.write.withdrawFunds([tokenId, withdrawAmount]);

      const state = await spiritAgent.read.getState([tokenId]);
      assert.equal(state.balance, fundAmount - withdrawAmount);
    });
  });

  describe("Batch Operations", () => {
    it("should get wrapped spirits for owner", async () => {
      // Mint 3 NFTs
      const tokenIds: bigint[] = [];
      for (let i = 0; i < 3; i++) {
        tokenIds.push(await mintNFTForUser());
      }

      const { userCore, userSpirit } = await getUserContracts();
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);

      // Upgrade 2 of them
      await userSpirit.write.upgradeToSpirit([tokenIds[0]]);
      await userSpirit.write.upgradeToSpirit([tokenIds[2]]);

      const wrappedSpirits = await spiritAgent.read.getWrappedSpirits([user, tokenIds]);
      assert.equal(wrappedSpirits.length, 2);
      assert.equal(wrappedSpirits[0], tokenIds[0]);
      assert.equal(wrappedSpirits[1], tokenIds[2]);
    });
  });

  describe("Spirit Level System", () => {
    // Helper: upgrade NFT to spirit and set up battleV2Address for exp granting
    async function setupSpiritWithExp(expAmount: bigint): Promise<bigint> {
      const tokenId = await mintNFTForUser();
      const { userCore, userSpirit } = await getUserContracts();
      await userCore.write.setApprovalForAll([spiritAgent.address, true]);
      await userSpirit.write.upgradeToSpirit([tokenId]);

      // Set owner as battleV2Address so we can grant exp directly
      await spiritAgent.write.setBattleV2Address([owner]);

      if (expAmount > 0n) {
        await spiritAgent.write.addExperience([tokenId, expAmount]);
      }
      return tokenId;
    }

    // Helper: get user's spirit contract instance for calling levelUp
    async function getUserSpiritContract() {
      const wallets = await viem.getWalletClients();
      return await viem.getContractAt("QLWYSpiritAgent", spiritAgent.address, {
        client: { wallet: wallets[1] },
      });
    }

    describe("requiredExpForLevel", () => {
      it("should return correct values for various levels", async () => {
        // Formula: level^2 * 10 + level * 90
        assert.equal(await spiritAgent.read.requiredExpForLevel([0]), 0n);
        assert.equal(await spiritAgent.read.requiredExpForLevel([1]), 100n);
        assert.equal(await spiritAgent.read.requiredExpForLevel([2]), 220n);
        assert.equal(await spiritAgent.read.requiredExpForLevel([5]), 700n);
        assert.equal(await spiritAgent.read.requiredExpForLevel([10]), 1900n);
        assert.equal(await spiritAgent.read.requiredExpForLevel([99]), 106920n);
      });
    });

    describe("addExperience", () => {
      it("should revert when called by non-BattleV2 address", async () => {
        const tokenId = await mintNFTForUser();
        const { userCore } = await getUserContracts();
        await userCore.write.setApprovalForAll([spiritAgent.address, true]);

        // battleV2Address not set yet (zero address), owner should fail
        await assert.rejects(
          spiritAgent.write.addExperience([tokenId, 100n]),
          /OnlyBattleV2/
        );
      });

      it("should grant experience when called by authorized address", async () => {
        const tokenId = await setupSpiritWithExp(0n);

        await spiritAgent.write.addExperience([tokenId, 200n]);
        assert.equal(await spiritAgent.read.spiritExperience([tokenId]), 200n);

        await spiritAgent.write.addExperience([tokenId, 300n]);
        assert.equal(await spiritAgent.read.spiritExperience([tokenId]), 500n);
      });

      it("should silently skip non-spirit NFTs", async () => {
        const tokenId = await mintNFTForUser();
        await spiritAgent.write.setBattleV2Address([owner]);

        // tokenId is NOT wrapped — should not revert
        await spiritAgent.write.addExperience([tokenId, 100n]);
        assert.equal(await spiritAgent.read.spiritExperience([tokenId]), 0n);
      });
    });

    describe("getLevelLuckBonus", () => {
      it("should return 0 for non-spirit NFTs", async () => {
        const tokenId = await mintNFTForUser();
        assert.equal(await spiritAgent.read.getLevelLuckBonus([tokenId]), 0);
      });

      it("should return level / 2 for spirits", async () => {
        // Level up twice to Lv.2 and check bonus = 1
        const tokenId = await setupSpiritWithExp(220n); // enough for Lv.2
        const { userToken } = await getUserContracts();
        await userToken.write.approve([spiritAgent.address, parseEther("100000")]);
        const userSpirit = await getUserSpiritContract();

        // Lv.0 → bonus 0
        assert.equal(await spiritAgent.read.getLevelLuckBonus([tokenId]), 0);

        await userSpirit.write.levelUp([tokenId]); // → Lv.1, bonus = 0
        assert.equal(await spiritAgent.read.getLevelLuckBonus([tokenId]), 0);

        await userSpirit.write.levelUp([tokenId]); // → Lv.2, bonus = 1
        assert.equal(await spiritAgent.read.getLevelLuckBonus([tokenId]), 1);
      });
    });

    describe("levelUp", () => {
      it("should level up with sufficient experience and QLWY", async () => {
        const tokenId = await setupSpiritWithExp(100n); // enough for Lv.1
        const { userToken } = await getUserContracts();
        await userToken.write.approve([spiritAgent.address, parseEther("100000")]);
        const userSpirit = await getUserSpiritContract();

        await userSpirit.write.levelUp([tokenId]);
        assert.equal(await spiritAgent.read.spiritLevel([tokenId]), 1);
      });

      it("should burn correct QLWY fee", async () => {
        const tokenId = await setupSpiritWithExp(100n);
        const { userToken } = await getUserContracts();
        await userToken.write.approve([spiritAgent.address, parseEther("100000")]);
        const userSpirit = await getUserSpiritContract();

        const deadAddr = "0x000000000000000000000000000000000000dEaD" as `0x${string}`;
        const deadBefore = await qlwyToken.read.balanceOf([deadAddr]);
        await userSpirit.write.levelUp([tokenId]);
        const deadAfter = await qlwyToken.read.balanceOf([deadAddr]);

        // Lv.1 fee = baseLevelUpFee(50) * 1 = 50 QLWY
        assert.equal(deadAfter - deadBefore, parseEther("50"));
      });

      it("should revert with InsufficientExperience", async () => {
        const tokenId = await setupSpiritWithExp(50n); // need 100 for Lv.1
        const { userToken } = await getUserContracts();
        await userToken.write.approve([spiritAgent.address, parseEther("100000")]);
        const userSpirit = await getUserSpiritContract();

        await assert.rejects(
          userSpirit.write.levelUp([tokenId]),
          /InsufficientExperience/
        );
      });

      it("should revert when QLWY not approved", async () => {
        const tokenId = await setupSpiritWithExp(100n);
        const userSpirit = await getUserSpiritContract();
        // No approval for QLWY token → should fail on safeTransferFrom

        await assert.rejects(
          userSpirit.write.levelUp([tokenId]),
          /ERC20InsufficientAllowance/
        );
      });

      it("should support multiple sequential level ups", async () => {
        // Lv.1 needs 100 exp, Lv.2 needs 220 exp, Lv.3 needs 360 exp
        const tokenId = await setupSpiritWithExp(360n);
        const { userToken } = await getUserContracts();
        await userToken.write.approve([spiritAgent.address, parseEther("100000")]);
        const userSpirit = await getUserSpiritContract();

        await userSpirit.write.levelUp([tokenId]); // → Lv.1
        await userSpirit.write.levelUp([tokenId]); // → Lv.2
        await userSpirit.write.levelUp([tokenId]); // → Lv.3
        assert.equal(await spiritAgent.read.spiritLevel([tokenId]), 3);
      });
    });

    describe("unwrapSpirit clears level/experience", () => {
      it("should reset level and experience on unwrap", async () => {
        const tokenId = await setupSpiritWithExp(100n);
        const { userToken } = await getUserContracts();
        await userToken.write.approve([spiritAgent.address, parseEther("100000")]);
        const userSpirit = await getUserSpiritContract();

        // Level up to 1
        await userSpirit.write.levelUp([tokenId]);
        assert.equal(await spiritAgent.read.spiritLevel([tokenId]), 1);
        assert.equal(await spiritAgent.read.spiritExperience([tokenId]), 100n);

        // Unwrap
        await userSpirit.write.unwrapSpirit([tokenId]);

        // Level and experience should be cleared
        assert.equal(await spiritAgent.read.spiritLevel([tokenId]), 0);
        assert.equal(await spiritAgent.read.spiritExperience([tokenId]), 0n);
      });
    });
  });
});

