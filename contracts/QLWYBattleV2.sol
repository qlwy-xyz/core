// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

interface IQLWYFortuneCore {
    struct TokenView {
        uint8 rarity;
        uint8 luck;
        uint8[6] lines;
        uint16 id;
    }
    function tokenView(uint256 tokenId) external view returns (TokenView memory);
}

interface IBattleTreasury {
    function deposit(uint256 amount) external;
}

interface IVRFCoordinatorV2_5 {
    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);
}

interface ISpiritAgent {
    function isWrapped(uint256 tokenId) external view returns (bool);
    function getLevelLuckBonus(uint256 tokenId) external view returns (uint8);
    function addExperience(uint256 tokenId, uint256 amount) external;
}

/// @title QLWYBattleV2
/// @notice Battle contract with slot-based team formation
/// @dev Supports 1-3 NFTs per join, multiple contributors per side
contract QLWYBattleV2 is ERC721Holder, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ============ Constants ============
    
    uint256 public constant SLOTS_PER_SIDE = 3;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ============ Structs ============
    
    struct Slot {
        uint256 nftId;
        address contributor;  // User address (for QLWY token rewards/bets)
        address nftSource;    // Where the NFT came from (for NFT returns; may differ from contributor for wrapped spirits)
        uint8 luck;
        uint8 rarity;
        bool filled;
    }

    struct Battle {
        // Slots
        Slot[3] challengerSlots;
        Slot[3] defenderSlots;
        uint8 challengerCount;
        uint8 defenderCount;
        
        // Creator of the battle
        address creator;

        // Betting
        uint256 betPerSlot;
        uint256 challengerBetPool;
        uint256 defenderBetPool;
        
        // Timing
        uint40 createdAt;
        uint40 filledAt;
        uint40 bettingEndsAt;
        
        // Status & Results
        BattleStatus status;
        bool challengerWon;
        uint8 challengerWins;
        uint8 defenderWins;
        bool[3] roundResults;
        bool[3] challengerBurned;
        bool[3] defenderBurned;
    }

    enum BattleStatus {
        FILLING,    // Waiting for both sides to fill 3 slots
        BETTING,    // Both sides full, waiting for bets
        PENDING,    // VRF requested
        RESOLVED,   // Battle complete
        CANCELLED   // Cancelled by captain
    }

    // ============ State ============

    IERC20 public immutable qlwyToken;
    IQLWYFortuneCore public immutable fortuneCore;
    ISpiritAgent public spiritAgent;
    IBattleTreasury public treasury;
    IVRFCoordinatorV2_5 public vrfCoordinator;
    
    bytes32 public vrfKeyHash;
    uint64 public vrfSubId;
    uint16 public vrfMinConfirmations = 3;
    uint32 public vrfCallbackGasLimit = 500_000;

    // Rarity bonus: [Common, Rare, Epic, Legendary, Mythic]
    uint8[5] rarityLuckBonus = [0, 5, 10, 15, 20];

    // Burn chance per rarity (BPS): 30%, 20%, 15%, 10%, 5%
    uint16[5] rarityBurnChance = [3000, 2000, 1500, 1000, 500];

    // Weighted scoring: score = effectiveLuck * statWeight + random(0-100) * randomWeight
    uint8 public statWeight = 70;
    uint8 public randomWeight = 30;

    uint256 public minBetPerSlot = 100 ether;
    uint256 public maxBetPerSlot = 10_000 ether;
    uint16 public feeBps = 1000;              // 10% battle fee
    uint16 public bettingFeeBps = 500;        // 5% to challenger captain
    uint16 public treasuryBettingFeeBps = 500; // 5% to treasury

    uint32 public fillTimeout = 24 hours;
    uint32 public vrfTimeout = 4 hours;
    uint32 public bettingDuration = 30 minutes;

    uint256 public nextBattleId = 1;

    mapping(uint256 => Battle) private battles;
    mapping(uint256 => uint256) private vrfRequestToBattle;

    // Betting: battleId => user => amount
    mapping(uint256 => mapping(address => uint256)) private challengerBets;
    mapping(uint256 => mapping(address => uint256)) private defenderBets;
    mapping(uint256 => mapping(address => bool)) private betsClaimed;
    mapping(uint256 => bool) private bettingFeePaid;
    mapping(uint256 => bool) private treasuryFeePaid;
    
    // Agent authorization: owner => agent => authorized
    mapping(address => mapping(address => bool)) public authorizedAgents;

    // Global NFT-in-battle tracking: nftId => battleId (0 = not in battle)
    mapping(uint256 => uint256) public nftInBattle;

    // ============ Events ============

    event BattleCreated(
        uint256 indexed battleId,
        address indexed captain,
        uint256 betPerSlot,
        uint8 slotsUsed
    );

    event SlotFilled(
        uint256 indexed battleId,
        bool isChallenger,
        address indexed contributor,
        uint256 nftId,
        uint8 slotIndex
    );

    event BattleFilled(
        uint256 indexed battleId,
        uint40 bettingEndsAt
    );

    event BattleStarted(
        uint256 indexed battleId,
        uint256 vrfRequestId,
        uint256 challengerBetPool,
        uint256 defenderBetPool
    );

    event BetPlaced(
        uint256 indexed battleId,
        address indexed bettor,
        bool betOnChallenger,
        uint256 amount
    );

    event BetClaimed(
        uint256 indexed battleId,
        address indexed bettor,
        uint256 amount
    );

    event BattleResolved(
        uint256 indexed battleId,
        bool challengerWon,
        bool[3] roundResults
    );

    event ContributorPaid(
        uint256 indexed battleId,
        address indexed contributor,
        uint256 amount,
        uint8 slotsContributed
    );

    event BattleCancelled(
        uint256 indexed battleId,
        address indexed by
    );

    event BattleLeft(
        uint256 indexed battleId,
        address indexed player,
        uint8 slotsFreed
    );

    event AgentAuthorized(
        address indexed owner,
        address indexed agent,
        bool authorized
    );

    // ============ Errors ============

    error InvalidBetAmount();
    error InvalidNFTCount();
    error NotOwnerOfNFT();
    error NotAuthorized();
    error BattleNotFilling();
    error BattleNotBetting();
    error BattleNotPending();
    error BattleNotResolved();
    error BettingNotEnded();
    error BettingEnded();
    error SideAlreadyFull();
    error CannotJoinOwnSide();
    error NotCreator();
    error NotExpired();
    error AlreadyClaimed();
    error NothingToClaim();
    error InvalidBattle();
    error TooManyNFTs();
    error SlotAlreadyFilled();
    error InvalidSlotIndex();
    error SlotCountMismatch();
    error NFTAlreadyInBattle();
    error DuplicateNFT();
    error CreatorCannotLeave();
    error NotParticipant();
    error OnlyCoordinator();
    error FeeTooHigh();
    error InvalidRate();

    // ============ Constructor ============

    constructor(
        address _qlwyToken,
        address _fortuneCore,
        address _treasury,
        address _vrfCoordinator,
        bytes32 _vrfKeyHash,
        uint64 _vrfSubId
    ) Ownable(msg.sender) {
        qlwyToken = IERC20(_qlwyToken);
        fortuneCore = IQLWYFortuneCore(_fortuneCore);
        treasury = IBattleTreasury(_treasury);
        vrfCoordinator = IVRFCoordinatorV2_5(_vrfCoordinator);
        vrfKeyHash = _vrfKeyHash;
        vrfSubId = _vrfSubId;
    }

    // ============ Agent Authorization ============

    /// @notice Authorize an agent to act on your behalf
    function authorizeAgent(address agent, bool authorized) external {
        authorizedAgents[msg.sender][agent] = authorized;
        emit AgentAuthorized(msg.sender, agent, authorized);
    }

    /// @notice Check if caller is owner or authorized agent
    function _isAuthorized(address owner) internal view returns (bool) {
        return msg.sender == owner || authorizedAgents[owner][msg.sender];
    }

    /// @notice Resolve the NFT source address for transfers
    /// @dev For direct calls: NFT must be owned by owner. For agent calls: NFT can be
    ///      held by a third party (e.g., SpiritAgent) that has approved this contract.
    function _resolveNftSource(
        address nftOwner,
        address owner,
        bool isAgentCall
    ) internal pure returns (address) {
        if (nftOwner == owner) {
            return owner;
        }
        // Agent calls allow NFTs held by approved third parties (e.g., wrapped spirits in SpiritAgent)
        // The safeTransferFrom will enforce that the source has approved this contract
        if (isAgentCall) {
            return nftOwner;
        }
        revert NotOwnerOfNFT();
    }

    // ============ Create Battle ============

    /// @notice Create a new battle with 1-3 NFTs
    /// @param nftIds Array of 1-3 NFT IDs
    /// @param betPerSlot Bet amount per slot
    function createBattle(
        uint256[] calldata nftIds,
        uint256 betPerSlot
    ) external whenNotPaused nonReentrant returns (uint256 battleId) {
        return _createBattleFor(msg.sender, nftIds, betPerSlot, false);
    }

    /// @notice Create battle on behalf of owner (for agents)
    function createBattleFor(
        address owner,
        uint256[] calldata nftIds,
        uint256 betPerSlot
    ) external whenNotPaused nonReentrant returns (uint256 battleId) {
        if (!_isAuthorized(owner)) revert NotAuthorized();
        return _createBattleFor(owner, nftIds, betPerSlot, true);
    }

    /// @notice Create a new battle with NFTs at specific slot indices
    function createBattleWithSlots(
        uint256[] calldata nftIds,
        uint8[] calldata slotIndices,
        uint256 betPerSlot
    ) external whenNotPaused nonReentrant returns (uint256 battleId) {
        return _createBattleWithSlotsFor(msg.sender, nftIds, slotIndices, betPerSlot, false);
    }


    function _createBattleFor(
        address owner,
        uint256[] calldata nftIds,
        uint256 betPerSlot,
        bool isAgentCall
    ) internal returns (uint256 battleId) {
        uint8[] memory indices = new uint8[](nftIds.length);
        for (uint256 i = 0; i < nftIds.length; i++) {
            indices[i] = uint8(i);
        }
        return _createBattleWithSlotsFor(owner, nftIds, indices, betPerSlot, isAgentCall);
    }

    function _createBattleWithSlotsFor(
        address owner,
        uint256[] calldata nftIds,
        uint8[] memory slotIndices,
        uint256 betPerSlot,
        bool isAgentCall
    ) internal returns (uint256 battleId) {
        uint256 count = nftIds.length;
        if (count == 0 || count > SLOTS_PER_SIDE) revert InvalidNFTCount();
        if (count != slotIndices.length) revert SlotCountMismatch();
        if (betPerSlot < minBetPerSlot || betPerSlot > maxBetPerSlot) revert InvalidBetAmount();

        battleId = nextBattleId++;
        Battle storage battle = battles[battleId];

        battle.creator = owner;
        battle.betPerSlot = betPerSlot;
        battle.status = BattleStatus.FILLING;
        battle.createdAt = uint40(block.timestamp);

        // Check for duplicate NFTs in input
        for (uint256 i = 1; i < count; i++) {
            for (uint256 j = 0; j < i; j++) {
                if (nftIds[j] == nftIds[i]) revert DuplicateNFT();
            }
        }

        // Transfer NFTs and fill specified slots
        IERC721 nft = IERC721(address(fortuneCore));
        for (uint256 i = 0; i < count; i++) {
            uint8 si = slotIndices[i];
            if (si >= SLOTS_PER_SIDE) revert InvalidSlotIndex();
            if (battle.challengerSlots[si].filled) revert SlotAlreadyFilled();

            if (nftInBattle[nftIds[i]] != 0) revert NFTAlreadyInBattle();

            address nftOwner = nft.ownerOf(nftIds[i]);
            address source = _resolveNftSource(nftOwner, owner, isAgentCall);
            nft.safeTransferFrom(source, address(this), nftIds[i]);
            nftInBattle[nftIds[i]] = battleId;

            IQLWYFortuneCore.TokenView memory tokenData = fortuneCore.tokenView(nftIds[i]);

            battle.challengerSlots[si] = Slot({
                nftId: nftIds[i],
                contributor: owner,
                nftSource: source,
                luck: tokenData.luck,
                rarity: tokenData.rarity,
                filled: true
            });

            emit SlotFilled(battleId, true, owner, nftIds[i], si);
        }

        battle.challengerCount = uint8(count);

        // Transfer bet amount
        uint256 totalBet = betPerSlot * count;
        qlwyToken.safeTransferFrom(owner, address(this), totalBet);

        emit BattleCreated(battleId, owner, betPerSlot, uint8(count));
    }

    // ============ Join Battle ============

    /// @notice Join challenger side with 1-3 NFTs
    function joinChallenger(
        uint256 battleId,
        uint256[] calldata nftIds
    ) external whenNotPaused nonReentrant {
        _joinSideFor(battleId, msg.sender, nftIds, true, false);
    }

    /// @notice Join challenger side on behalf of owner
    function joinChallengerFor(
        uint256 battleId,
        address owner,
        uint256[] calldata nftIds
    ) external whenNotPaused nonReentrant {
        if (!_isAuthorized(owner)) revert NotAuthorized();
        _joinSideFor(battleId, owner, nftIds, true, true);
    }

    /// @notice Join defender side with 1-3 NFTs
    function joinDefender(
        uint256 battleId,
        uint256[] calldata nftIds
    ) external whenNotPaused nonReentrant {
        _joinSideFor(battleId, msg.sender, nftIds, false, false);
    }

    /// @notice Join defender side on behalf of owner
    function joinDefenderFor(
        uint256 battleId,
        address owner,
        uint256[] calldata nftIds
    ) external whenNotPaused nonReentrant {
        if (!_isAuthorized(owner)) revert NotAuthorized();
        _joinSideFor(battleId, owner, nftIds, false, true);
    }

    function _joinSideFor(
        uint256 battleId,
        address owner,
        uint256[] calldata nftIds,
        bool isChallenger,
        bool isAgentCall
    ) internal {
        Battle storage battle = battles[battleId];
        Slot[3] storage slots = isChallenger
            ? battle.challengerSlots
            : battle.defenderSlots;

        // Scan for empty slots instead of assuming sequential filling
        uint8[] memory indices = new uint8[](nftIds.length);
        uint256 foundCount = 0;
        for (uint8 s = 0; s < SLOTS_PER_SIDE && foundCount < nftIds.length; s++) {
            if (!slots[s].filled) {
                indices[foundCount] = s;
                foundCount++;
            }
        }
        if (foundCount != nftIds.length) revert TooManyNFTs();

        _joinSideWithSlotsFor(battleId, owner, nftIds, indices, isChallenger, isAgentCall);
    }

    /// @notice Join challenger side with NFTs at specific slot indices
    function joinChallengerWithSlots(
        uint256 battleId,
        uint256[] calldata nftIds,
        uint8[] calldata slotIndices
    ) external whenNotPaused nonReentrant {
        _joinSideWithSlotsFor(battleId, msg.sender, nftIds, slotIndices, true, false);
    }

    /// @notice Join defender side with NFTs at specific slot indices
    function joinDefenderWithSlots(
        uint256 battleId,
        uint256[] calldata nftIds,
        uint8[] calldata slotIndices
    ) external whenNotPaused nonReentrant {
        _joinSideWithSlotsFor(battleId, msg.sender, nftIds, slotIndices, false, false);
    }

    function _joinSideWithSlotsFor(
        uint256 battleId,
        address owner,
        uint256[] calldata nftIds,
        uint8[] memory slotIndices,
        bool isChallenger,
        bool isAgentCall
    ) internal {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.FILLING) revert BattleNotFilling();

        uint256 count = nftIds.length;
        if (count == 0 || count > SLOTS_PER_SIDE) revert InvalidNFTCount();
        if (count != slotIndices.length) revert SlotCountMismatch();

        Slot[3] storage slots = isChallenger ? battle.challengerSlots : battle.defenderSlots;
        uint8 currentCount = isChallenger ? battle.challengerCount : battle.defenderCount;

        // Check if joining own side when already on other side (prevent self-battle)
        {
            Slot[3] storage otherSlots = isChallenger ? battle.defenderSlots : battle.challengerSlots;
            for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
                if (otherSlots[i].filled && otherSlots[i].contributor == owner) revert CannotJoinOwnSide();
            }
        }
        if (!isChallenger && battle.creator == owner) revert CannotJoinOwnSide();

        // Check available slots
        uint8 availableSlots = uint8(SLOTS_PER_SIDE) - currentCount;
        if (count > availableSlots) revert TooManyNFTs();

        // Check for duplicate NFTs already in this battle
        for (uint256 i = 0; i < count; i++) {
            for (uint256 j = 0; j < SLOTS_PER_SIDE; j++) {
                if (battle.challengerSlots[j].filled && battle.challengerSlots[j].nftId == nftIds[i]) revert NFTAlreadyInBattle();
                if (battle.defenderSlots[j].filled && battle.defenderSlots[j].nftId == nftIds[i]) revert NFTAlreadyInBattle();
            }
            for (uint256 k = 0; k < i; k++) {
                if (nftIds[k] == nftIds[i]) revert DuplicateNFT();
            }
        }

        // Transfer NFTs and fill specified slots
        IERC721 nft = IERC721(address(fortuneCore));

        for (uint256 i = 0; i < count; i++) {
            uint8 si = slotIndices[i];
            if (si >= SLOTS_PER_SIDE) revert InvalidSlotIndex();
            if (slots[si].filled) revert SlotAlreadyFilled();

            if (nftInBattle[nftIds[i]] != 0) revert NFTAlreadyInBattle();

            address nftOwner = nft.ownerOf(nftIds[i]);
            address source = _resolveNftSource(nftOwner, owner, isAgentCall);
            nft.safeTransferFrom(source, address(this), nftIds[i]);
            nftInBattle[nftIds[i]] = battleId;

            IQLWYFortuneCore.TokenView memory tokenData = fortuneCore.tokenView(nftIds[i]);

            slots[si] = Slot({
                nftId: nftIds[i],
                contributor: owner,
                nftSource: source,
                luck: tokenData.luck,
                rarity: tokenData.rarity,
                filled: true
            });

            emit SlotFilled(battleId, isChallenger, owner, nftIds[i], si);
        }

        // Update count
        uint8 newCount = currentCount + uint8(count);
        if (isChallenger) {
            battle.challengerCount = newCount;
        } else {
            battle.defenderCount = newCount;
        }

        // Transfer bet amount
        uint256 totalBet = battle.betPerSlot * count;
        qlwyToken.safeTransferFrom(owner, address(this), totalBet);

        // Check if battle is now full
        if (battle.challengerCount == SLOTS_PER_SIDE && battle.defenderCount == SLOTS_PER_SIDE) {
            battle.status = BattleStatus.BETTING;
            battle.filledAt = uint40(block.timestamp);
            battle.bettingEndsAt = uint40(block.timestamp + bettingDuration);
            emit BattleFilled(battleId, battle.bettingEndsAt);
        }
    }

    // ============ Betting ============

    /// @notice Place a bet on a battle
    function placeBet(
        uint256 battleId,
        bool betOnChallenger,
        uint256 amount
    ) external whenNotPaused nonReentrant {
        _placeBetFor(battleId, msg.sender, betOnChallenger, amount);
    }

    /// @notice Place bet on behalf of owner (for agents)
    function placeBetFor(
        uint256 battleId,
        address owner,
        bool betOnChallenger,
        uint256 amount
    ) external whenNotPaused nonReentrant {
        if (!_isAuthorized(owner)) revert NotAuthorized();
        _placeBetFor(battleId, owner, betOnChallenger, amount);
    }

    function _placeBetFor(
        uint256 battleId,
        address owner,
        bool betOnChallenger,
        uint256 amount
    ) internal {
        if (amount == 0) revert InvalidBetAmount();

        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.BETTING) revert BattleNotBetting();
        if (block.timestamp >= battle.bettingEndsAt) revert BettingEnded();

        qlwyToken.safeTransferFrom(owner, address(this), amount);

        if (betOnChallenger) {
            challengerBets[battleId][owner] += amount;
            battle.challengerBetPool += amount;
        } else {
            defenderBets[battleId][owner] += amount;
            battle.defenderBetPool += amount;
        }

        emit BetPlaced(battleId, owner, betOnChallenger, amount);
    }

    // ============ Start Battle ============

    /// @notice Start battle after betting period ends
    function startBattle(uint256 battleId)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 vrfRequestId)
    {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.BETTING) revert BattleNotBetting();
        if (block.timestamp < battle.bettingEndsAt) revert BettingNotEnded();

        battle.status = BattleStatus.PENDING;

        vrfRequestId = vrfCoordinator.requestRandomWords(
            vrfKeyHash,
            vrfSubId,
            vrfMinConfirmations,
            vrfCallbackGasLimit,
            4
        );

        vrfRequestToBattle[vrfRequestId] = battleId;

        emit BattleStarted(battleId, vrfRequestId, battle.challengerBetPool, battle.defenderBetPool);
    }

    // ============ VRF Callback ============

    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyCoordinator();

        uint256 battleId = vrfRequestToBattle[requestId];
        if (battleId == 0) revert InvalidBattle();

        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.PENDING) revert InvalidBattle();

        battle.status = BattleStatus.RESOLVED;

        // Calculate round results with weighted scoring
        // score = effectiveLuck * statWeight + random(0-100) * randomWeight
        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            uint8 rarityA = battle.challengerSlots[i].rarity;
            uint8 rarityB = battle.defenderSlots[i].rarity;

            // Level luck bonus (0 if not a spirit or spiritAgent not set)
            uint256 levelBonusA = 0;
            uint256 levelBonusB = 0;
            if (address(spiritAgent) != address(0)) {
                levelBonusA = uint256(spiritAgent.getLevelLuckBonus(battle.challengerSlots[i].nftId));
                levelBonusB = uint256(spiritAgent.getLevelLuckBonus(battle.defenderSlots[i].nftId));
            }

            uint256 effectiveLuckA = uint256(battle.challengerSlots[i].luck) + uint256(rarityLuckBonus[rarityA]) + levelBonusA;
            uint256 effectiveLuckB = uint256(battle.defenderSlots[i].luck) + uint256(rarityLuckBonus[rarityB]) + levelBonusB;

            // Split random word into two independent random values (0-100)
            uint256 randomA = (randomWords[i] >> 128) % 101;
            uint256 randomB = (randomWords[i] & type(uint128).max) % 101;

            // Weighted score: stats dominate, randomness is a small perturbation
            uint256 scoreA = effectiveLuckA * uint256(statWeight) + randomA * uint256(randomWeight);
            uint256 scoreB = effectiveLuckB * uint256(statWeight) + randomB * uint256(randomWeight);

            // Tiebreaker: higher effective luck wins; if still tied, challenger wins
            bool challengerWins = scoreA > scoreB || (scoreA == scoreB && effectiveLuckA >= effectiveLuckB);

            battle.roundResults[i] = challengerWins;
            if (challengerWins) {
                battle.challengerWins++;
            } else {
                battle.defenderWins++;
            }
        }

        battle.challengerWon = battle.challengerWins >= 2;

        // Handle NFT transfers with burn logic
        uint256 burnSeed = randomWords[3];
        IERC721 nft = IERC721(address(fortuneCore));

        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            bool challengerWonRound = battle.roundResults[i];
            uint256 burnRoll = (burnSeed >> (i * 16)) % BPS_DENOMINATOR;

            Slot storage cSlot = battle.challengerSlots[i];
            Slot storage dSlot = battle.defenderSlots[i];

            if (challengerWonRound) {
                // Challenger won - defender's NFT may burn
                uint16 burnChance = rarityBurnChance[dSlot.rarity];
                if (burnRoll < burnChance) {
                    nft.safeTransferFrom(address(this), DEAD_ADDRESS, dSlot.nftId);
                    battle.defenderBurned[i] = true;
                } else {
                    nft.safeTransferFrom(address(this), dSlot.nftSource, dSlot.nftId);
                }
                nft.safeTransferFrom(address(this), cSlot.nftSource, cSlot.nftId);
            } else {
                // Defender won - challenger's NFT may burn
                uint16 burnChance = rarityBurnChance[cSlot.rarity];
                if (burnRoll < burnChance) {
                    nft.safeTransferFrom(address(this), DEAD_ADDRESS, cSlot.nftId);
                    battle.challengerBurned[i] = true;
                } else {
                    nft.safeTransferFrom(address(this), cSlot.nftSource, cSlot.nftId);
                }
                nft.safeTransferFrom(address(this), dSlot.nftSource, dSlot.nftId);
            }
            nftInBattle[cSlot.nftId] = 0;
            nftInBattle[dSlot.nftId] = 0;
        }

        // Distribute battle rewards to contributors
        _distributeBattleRewards(battleId);

        // Grant experience to participating spirits
        if (address(spiritAgent) != address(0)) {
            for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
                uint256 cNftId = battle.challengerSlots[i].nftId;
                uint256 dNftId = battle.defenderSlots[i].nftId;

                // Win: 50 exp (20 base + 30 bonus), Lose: 20 exp
                if (battle.roundResults[i]) {
                    // Challenger won this round
                    spiritAgent.addExperience(cNftId, 50);
                    spiritAgent.addExperience(dNftId, 20);
                } else {
                    // Defender won this round
                    spiritAgent.addExperience(cNftId, 20);
                    spiritAgent.addExperience(dNftId, 50);
                }
            }
        }

        emit BattleResolved(battleId, battle.challengerWon, battle.roundResults);
    }

    // ============ Reward Distribution ============

    function _distributeBattleRewards(uint256 battleId) internal {
        Battle storage battle = battles[battleId];

        uint256 totalPot = battle.betPerSlot * SLOTS_PER_SIDE * 2; // Both sides
        uint256 feeAmount = (totalPot * feeBps) / BPS_DENOMINATOR;
        uint256 distributablePot = totalPot - feeAmount;

        // Pay fee to treasury
        if (feeAmount > 0) {
            qlwyToken.approve(address(treasury), feeAmount);
            treasury.deposit(feeAmount);
        }

        // Distribute to winning side contributors
        Slot[3] storage winnerSlots = battle.challengerWon
            ? battle.challengerSlots
            : battle.defenderSlots;

        // Track unique contributors and their slot counts
        address[3] memory contributors;
        uint8[3] memory slotCounts;
        uint8 uniqueCount = 0;

        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            address contributor = winnerSlots[i].contributor;
            bool found = false;

            for (uint8 j = 0; j < uniqueCount; j++) {
                if (contributors[j] == contributor) {
                    slotCounts[j]++;
                    found = true;
                    break;
                }
            }

            if (!found) {
                contributors[uniqueCount] = contributor;
                slotCounts[uniqueCount] = 1;
                uniqueCount++;
            }
        }

        // Pay each contributor their share
        for (uint8 i = 0; i < uniqueCount; i++) {
            uint256 share = (distributablePot * slotCounts[i]) / SLOTS_PER_SIDE;
            if (share > 0) {
                qlwyToken.safeTransfer(contributors[i], share);
                emit ContributorPaid(battleId, contributors[i], share, slotCounts[i]);
            }
        }
    }

    // ============ Cancel Battle ============

    /// @notice Cancel battle (only captain, only in FILLING status after timeout)
    function cancelBattle(uint256 battleId) external nonReentrant {
        Battle storage battle = battles[battleId];
        if (battle.creator != msg.sender) revert NotCreator();
        if (battle.status != BattleStatus.FILLING) revert BattleNotFilling();
        if (block.timestamp < uint256(battle.createdAt) + fillTimeout) revert NotExpired();

        battle.status = BattleStatus.CANCELLED;

        IERC721 nft = IERC721(address(fortuneCore));

        // Return NFTs and bets to challenger side contributors (slots may be non-contiguous)
        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            Slot storage slot = battle.challengerSlots[i];
            if (!slot.filled) continue;
            nft.safeTransferFrom(address(this), slot.nftSource, slot.nftId);
            nftInBattle[slot.nftId] = 0;
            qlwyToken.safeTransfer(slot.contributor, battle.betPerSlot);
        }

        // Return NFTs and bets to defender side contributors (slots may be non-contiguous)
        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            Slot storage slot = battle.defenderSlots[i];
            if (!slot.filled) continue;
            nft.safeTransferFrom(address(this), slot.nftSource, slot.nftId);
            nftInBattle[slot.nftId] = 0;
            qlwyToken.safeTransfer(slot.contributor, battle.betPerSlot);
        }

        emit BattleCancelled(battleId, msg.sender);
    }

    /// @notice Leave a battle (non-creator participants only, after fillTimeout)
    function leaveBattle(uint256 battleId) external nonReentrant {
        _leaveBattleFor(battleId, msg.sender);
    }

    /// @notice Leave a battle on behalf of owner (for agent/spirit)
    function leaveBattleFor(uint256 battleId, address owner) external nonReentrant {
        if (!_isAuthorized(owner)) revert NotAuthorized();
        _leaveBattleFor(battleId, owner);
    }

    function _leaveBattleFor(uint256 battleId, address owner) internal {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.FILLING) revert BattleNotFilling();
        if (block.timestamp < uint256(battle.createdAt) + fillTimeout) revert NotExpired();
        if (battle.creator == owner) revert CreatorCannotLeave();

        IERC721 nft = IERC721(address(fortuneCore));
        uint8 slotsFreed = 0;

        // Return NFTs and bets from challenger side
        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            Slot storage slot = battle.challengerSlots[i];
            if (slot.filled && slot.contributor == owner) {
                nft.safeTransferFrom(address(this), slot.nftSource, slot.nftId);
                nftInBattle[slot.nftId] = 0;
                qlwyToken.safeTransfer(owner, battle.betPerSlot);
                delete battle.challengerSlots[i];
                battle.challengerCount--;
                slotsFreed++;
            }
        }

        // Return NFTs and bets from defender side
        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            Slot storage slot = battle.defenderSlots[i];
            if (slot.filled && slot.contributor == owner) {
                nft.safeTransferFrom(address(this), slot.nftSource, slot.nftId);
                nftInBattle[slot.nftId] = 0;
                qlwyToken.safeTransfer(owner, battle.betPerSlot);
                delete battle.defenderSlots[i];
                battle.defenderCount--;
                slotsFreed++;
            }
        }

        if (slotsFreed == 0) revert NotParticipant();

        emit BattleLeft(battleId, owner, slotsFreed);
    }

    /// @notice Cancel pending battle if VRF timed out
    function cancelPendingBattle(uint256 battleId) external nonReentrant {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.PENDING) revert BattleNotPending();
        if (block.timestamp < uint256(battle.filledAt) + vrfTimeout) revert NotExpired();

        _cancelPendingBattle(battleId, battle);
    }

    /// @notice Emergency cancel a pending battle (admin only, skips timeout check)
    function emergencyCancelPending(uint256 battleId) external onlyOwner nonReentrant {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.PENDING) revert BattleNotPending();

        _cancelPendingBattle(battleId, battle);
    }

    function _cancelPendingBattle(uint256 battleId, Battle storage battle) internal {
        battle.status = BattleStatus.CANCELLED;

        IERC721 nft = IERC721(address(fortuneCore));

        // Return all NFTs and bets (use try-catch for NFT transfers in case NFT is no longer held)
        for (uint256 i = 0; i < SLOTS_PER_SIDE; i++) {
            Slot storage cSlot = battle.challengerSlots[i];
            try nft.safeTransferFrom(address(this), cSlot.nftSource, cSlot.nftId) {
                nftInBattle[cSlot.nftId] = 0;
            } catch {}
            qlwyToken.safeTransfer(cSlot.contributor, battle.betPerSlot);

            Slot storage dSlot = battle.defenderSlots[i];
            try nft.safeTransferFrom(address(this), dSlot.nftSource, dSlot.nftId) {
                nftInBattle[dSlot.nftId] = 0;
            } catch {}
            qlwyToken.safeTransfer(dSlot.contributor, battle.betPerSlot);
        }

        // Return betting pools
        // Note: Bettors need to claim refunds individually via claimBetRefund

        emit BattleCancelled(battleId, msg.sender);
    }

    // ============ Claim Betting Winnings ============

    /// @notice Claim betting winnings after battle resolved
    function claimBetWinnings(uint256 battleId) external nonReentrant {
        _claimBetWinningsFor(battleId, msg.sender);
    }

    /// @notice Claim betting winnings on behalf of owner
    function claimBetWinningsFor(uint256 battleId, address owner) external nonReentrant {
        if (!_isAuthorized(owner)) revert NotAuthorized();
        _claimBetWinningsFor(battleId, owner);
    }

    function _claimBetWinningsFor(uint256 battleId, address owner) internal {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.RESOLVED) revert BattleNotResolved();
        if (betsClaimed[battleId][owner]) revert AlreadyClaimed();

        uint256 userBetOnWinner = battle.challengerWon
            ? challengerBets[battleId][owner]
            : defenderBets[battleId][owner];
        uint256 userBetOnLoser = battle.challengerWon
            ? defenderBets[battleId][owner]
            : challengerBets[battleId][owner];

        if (userBetOnWinner == 0 && userBetOnLoser == 0) revert NothingToClaim();

        betsClaimed[battleId][owner] = true;

        uint256 payout = userBetOnWinner; // Principal

        if (userBetOnWinner > 0) {
            uint256 winningPool = battle.challengerWon
                ? battle.challengerBetPool
                : battle.defenderBetPool;
            uint256 losingPool = battle.challengerWon
                ? battle.defenderBetPool
                : battle.challengerBetPool;

            if (winningPool > 0 && losingPool > 0) {
                uint256 bettingFee = (losingPool * bettingFeeBps) / BPS_DENOMINATOR;
                uint256 treasuryFee = (losingPool * treasuryBettingFeeBps) / BPS_DENOMINATOR;
                uint256 distributablePool = losingPool - bettingFee - treasuryFee;

                // Pay betting fee to challenger captain
                if (!bettingFeePaid[battleId] && bettingFee > 0) {
                    bettingFeePaid[battleId] = true;
                    qlwyToken.safeTransfer(battle.creator, bettingFee);
                }

                // Pay treasury fee
                if (!treasuryFeePaid[battleId] && treasuryFee > 0) {
                    treasuryFeePaid[battleId] = true;
                    qlwyToken.approve(address(treasury), treasuryFee);
                    treasury.deposit(treasuryFee);
                }

                uint256 userShare = (distributablePool * userBetOnWinner) / winningPool;
                payout += userShare;
            }
        }

        if (payout > 0) {
            qlwyToken.safeTransfer(owner, payout);
        }

        emit BetClaimed(battleId, owner, payout);
    }

    /// @notice Claim bet refund if battle was cancelled
    function claimBetRefund(uint256 battleId) external nonReentrant {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.CANCELLED) revert InvalidBattle();
        if (betsClaimed[battleId][msg.sender]) revert AlreadyClaimed();

        uint256 refund = challengerBets[battleId][msg.sender] + defenderBets[battleId][msg.sender];
        if (refund == 0) revert NothingToClaim();

        betsClaimed[battleId][msg.sender] = true;
        qlwyToken.safeTransfer(msg.sender, refund);

        emit BetClaimed(battleId, msg.sender, refund);
    }

    // ============ View Functions ============

    /// @notice Get battle info
    function getBattle(uint256 battleId) external view returns (
        address creator,
        uint8 challengerCount,
        uint8 defenderCount,
        uint256 betPerSlot,
        BattleStatus status,
        bool challengerWon,
        uint40 createdAt,
        uint40 bettingEndsAt
    ) {
        Battle storage battle = battles[battleId];
        creator = battle.creator;
        challengerCount = battle.challengerCount;
        defenderCount = battle.defenderCount;
        betPerSlot = battle.betPerSlot;
        status = battle.status;
        challengerWon = battle.challengerWon;
        createdAt = battle.createdAt;
        bettingEndsAt = battle.bettingEndsAt;
    }

    /// @notice Get battle slots
    function getBattleSlots(uint256 battleId) external view returns (
        Slot[3] memory challengerSlots,
        Slot[3] memory defenderSlots
    ) {
        Battle storage battle = battles[battleId];
        challengerSlots = battle.challengerSlots;
        defenderSlots = battle.defenderSlots;
    }

    // ============ Admin Functions ============

    function setBetLimits(uint256 _minBet, uint256 _maxBet) external onlyOwner {
        minBetPerSlot = _minBet;
        maxBetPerSlot = _maxBet;
    }

    function setFees(uint16 _feeBps, uint16 _bettingFeeBps, uint16 _treasuryBettingFeeBps) external onlyOwner {
        if (_feeBps > 2000 || _bettingFeeBps > 2000 || _treasuryBettingFeeBps > 2000) revert FeeTooHigh();
        feeBps = _feeBps;
        bettingFeeBps = _bettingFeeBps;
        treasuryBettingFeeBps = _treasuryBettingFeeBps;
    }

    function setRarityLuckBonus(uint8[5] calldata _bonuses) external onlyOwner {
        rarityLuckBonus = _bonuses;
    }

    function setScoreWeights(uint8 _statWeight, uint8 _randomWeight) external onlyOwner {
        statWeight = _statWeight;
        randomWeight = _randomWeight;
    }

    function setRarityBurnChance(uint16[5] calldata _burnChances) external onlyOwner {
        for (uint256 i = 0; i < 5; i++) {
            if (_burnChances[i] > BPS_DENOMINATOR) revert InvalidRate();
        }
        rarityBurnChance = _burnChances;
    }

    function setTimeouts(uint32 _fillTimeout, uint32 _vrfTimeout, uint32 _bettingDuration) external onlyOwner {
        fillTimeout = _fillTimeout;
        vrfTimeout = _vrfTimeout;
        bettingDuration = _bettingDuration;
    }

    function setVRFConfig(
        bytes32 _keyHash,
        uint64 _subId,
        uint16 _minConfirmations,
        uint32 _callbackGasLimit
    ) external onlyOwner {
        vrfKeyHash = _keyHash;
        vrfSubId = _subId;
        vrfMinConfirmations = _minConfirmations;
        vrfCallbackGasLimit = _callbackGasLimit;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = IBattleTreasury(_treasury);
    }

    function setSpiritAgent(address _spiritAgent) external onlyOwner {
        spiritAgent = ISpiritAgent(_spiritAgent);
    }

    function getRarityLuckBonus() external view returns (uint8[5] memory) {
        return rarityLuckBonus;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}