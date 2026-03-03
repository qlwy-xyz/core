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

/// @title QLWYBattle
contract QLWYBattle is ERC721Holder, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    uint256 public constant CARDS_PER_PLAYER = 3;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Rarity bonus for luck calculation: [Common, Rare, Epic, Legendary, Mythic]
    uint8[5] public rarityLuckBonus = [0, 5, 10, 15, 20];

    // Burn chance per rarity (in BPS): [Common, Rare, Epic, Legendary, Mythic]
    // 30%, 20%, 15%, 10%, 5%
    uint16[5] public rarityBurnChance = [3000, 2000, 1500, 1000, 500];

    // Weighted scoring: score = effectiveLuck * statWeight + random(0-100) * randomWeight
    uint8 public statWeight = 70;
    uint8 public randomWeight = 30;

    enum BattleStatus {
        OPEN,
        BETTING,    // New: waiting for betting period to end
        PENDING,
        RESOLVED,
        CANCELLED
    }

    struct Battle {
        address challenger;
        uint256[3] challengerNFTs;
        uint8[3] challengerLucks;
        uint8[3] challengerRarities;

        address defender;
        uint256[3] defenderNFTs;
        uint8[3] defenderLucks;
        uint8[3] defenderRarities;

        uint256 betAmount;

        BattleStatus status;
        uint40 createdAt;
        uint40 acceptedAt;
        uint40 bettingEndsAt;       // New: when betting period ends

        address winner;
        uint8 challengerWins;
        uint8 defenderWins;
        bool[3] roundResults;
        bool[3] challengerBurned;
        bool[3] defenderBurned;

        // Betting pools
        uint256 challengerBetPool;  // Total bets on challenger
        uint256 defenderBetPool;    // Total bets on defender
    }

    IERC20 public immutable qlwyToken;
    IQLWYFortuneCore public immutable fortuneCore;
    IBattleTreasury public treasury;
    IVRFCoordinatorV2_5 public vrfCoordinator;
    
    bytes32 public vrfKeyHash;
    uint64 public vrfSubId;
    uint16 public vrfMinConfirmations = 3;
    uint32 public vrfCallbackGasLimit = 500_000;

    uint256 public minBet = 100 ether;
    uint256 public maxBet = 10_000 ether;
    uint16 public feeBps = 1000;
    uint16 public bettingFeeBps = 500;  // 5% fee on betting winnings to challenger
    uint16 public treasuryBettingFeeBps = 500;  // 5% fee on betting winnings to treasury

    uint32 public openTimeout = 24 hours;
    uint32 public vrfTimeout = 4 hours;
    uint32 public bettingDuration = 30 minutes;  // Betting period duration

    uint256 public nextBattleId = 1;

    mapping(uint256 => Battle) public battles;
    mapping(uint256 => uint256) public vrfRequestToBattle;

    // Betting mappings: battleId => user => amount
    mapping(uint256 => mapping(address => uint256)) public challengerBets;
    mapping(uint256 => mapping(address => uint256)) public defenderBets;
    mapping(uint256 => mapping(address => bool)) public betsClaimed;
    mapping(uint256 => bool) public bettingFeePaid;  // Track if betting fee has been paid to challenger
    mapping(uint256 => bool) public treasuryBettingFeePaid;  // Track if treasury betting fee has been paid

    event BattleCreated(
        uint256 indexed battleId,
        address indexed challenger,
        uint256[3] nftIds,
        uint256 betAmount
    );

    event BattleAccepted(
        uint256 indexed battleId,
        address indexed defender,
        uint256[3] nftIds,
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

    event BettingFeePaid(
        uint256 indexed battleId,
        address indexed challenger,
        uint256 amount
    );

    event BattleResolved(
        uint256 indexed battleId,
        address indexed winner,
        address indexed loser,
        uint256 winnerPayout,
        uint256 feeAmount,
        bool[3] roundResults,
        bool[3] loserBurned
    );

    event BattleCancelled(uint256 indexed battleId, address indexed by);

    error InvalidBetAmount();
    error NotOwnerOfNFT();
    error BattleNotOpen();
    error BattleNotPending();
    error BattleNotBetting();
    error BettingNotEnded();
    error BettingEnded();
    error CannotFightSelf();
    error NotChallenger();
    error NotExpired();
    error AlreadyResolved();
    error AlreadyClaimed();
    error NothingToClaim();
    error InvalidBattle();

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
    function createBattle(uint256[3] calldata nftIds, uint256 betAmount)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 battleId)
    {
        if (betAmount < minBet || betAmount > maxBet) revert InvalidBetAmount();

        IERC721 nft = IERC721(address(fortuneCore));
        uint8[3] memory lucks;
        uint8[3] memory rarities;

        for (uint256 i = 0; i < CARDS_PER_PLAYER; i++) {
            if (nft.ownerOf(nftIds[i]) != msg.sender) revert NotOwnerOfNFT();
            nft.safeTransferFrom(msg.sender, address(this), nftIds[i]);
            IQLWYFortuneCore.TokenView memory tokenData = fortuneCore.tokenView(nftIds[i]);
            lucks[i] = tokenData.luck;
            rarities[i] = tokenData.rarity;
        }

        qlwyToken.safeTransferFrom(msg.sender, address(this), betAmount);

        battleId = nextBattleId++;
        Battle storage battle = battles[battleId];
        battle.challenger = msg.sender;
        battle.challengerNFTs = nftIds;
        battle.challengerLucks = lucks;
        battle.challengerRarities = rarities;
        battle.betAmount = betAmount;
        battle.status = BattleStatus.OPEN;
        battle.createdAt = uint40(block.timestamp);

        emit BattleCreated(battleId, msg.sender, nftIds, betAmount);
    }

    function acceptBattle(uint256 battleId, uint256[3] calldata nftIds)
        external
        whenNotPaused
        nonReentrant
    {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.OPEN) revert BattleNotOpen();
        if (battle.challenger == msg.sender) revert CannotFightSelf();

        IERC721 nft = IERC721(address(fortuneCore));
        uint8[3] memory lucks;
        uint8[3] memory rarities;

        for (uint256 i = 0; i < CARDS_PER_PLAYER; i++) {
            if (nft.ownerOf(nftIds[i]) != msg.sender) revert NotOwnerOfNFT();
            nft.safeTransferFrom(msg.sender, address(this), nftIds[i]);
            IQLWYFortuneCore.TokenView memory tokenData = fortuneCore.tokenView(nftIds[i]);
            lucks[i] = tokenData.luck;
            rarities[i] = tokenData.rarity;
        }

        qlwyToken.safeTransferFrom(msg.sender, address(this), battle.betAmount);

        battle.defender = msg.sender;
        battle.defenderNFTs = nftIds;
        battle.defenderLucks = lucks;
        battle.defenderRarities = rarities;
        battle.status = BattleStatus.BETTING;
        battle.acceptedAt = uint40(block.timestamp);
        battle.bettingEndsAt = uint40(block.timestamp + bettingDuration);

        emit BattleAccepted(battleId, msg.sender, nftIds, battle.bettingEndsAt);
    }

    /// @notice Place a bet on a battle during the betting period
    function placeBet(uint256 battleId, bool betOnChallenger, uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert InvalidBetAmount();

        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.BETTING) revert BattleNotBetting();
        if (block.timestamp >= battle.bettingEndsAt) revert BettingEnded();

        qlwyToken.safeTransferFrom(msg.sender, address(this), amount);

        if (betOnChallenger) {
            challengerBets[battleId][msg.sender] += amount;
            battle.challengerBetPool += amount;
        } else {
            defenderBets[battleId][msg.sender] += amount;
            battle.defenderBetPool += amount;
        }

        emit BetPlaced(battleId, msg.sender, betOnChallenger, amount);
    }

    /// @notice Start the battle after betting period ends - requests VRF
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

    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        require(msg.sender == address(vrfCoordinator), "only coordinator");

        uint256 battleId = vrfRequestToBattle[requestId];
        if (battleId == 0) revert InvalidBattle();

        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.PENDING) revert AlreadyResolved();

        battle.status = BattleStatus.RESOLVED;

        // Calculate round results with weighted scoring
        // score = effectiveLuck * statWeight + random(0-100) * randomWeight
        for (uint256 i = 0; i < CARDS_PER_PLAYER; i++) {
            // Effective luck = base luck + rarity bonus
            uint8 rarityA = battle.challengerRarities[i];
            uint8 rarityB = battle.defenderRarities[i];
            uint256 effectiveLuckA = uint256(battle.challengerLucks[i]) + uint256(rarityLuckBonus[rarityA]);
            uint256 effectiveLuckB = uint256(battle.defenderLucks[i]) + uint256(rarityLuckBonus[rarityB]);

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

        bool challengerIsWinner = battle.challengerWins >= 2;
        address winner = challengerIsWinner ? battle.challenger : battle.defender;
        address loser = challengerIsWinner ? battle.defender : battle.challenger;
        battle.winner = winner;

        uint256 burnSeed = randomWords[3];
        IERC721 nft = IERC721(address(fortuneCore));

        // Handle NFT transfers with rarity-based burn chance
        for (uint256 i = 0; i < CARDS_PER_PLAYER; i++) {
            bool challengerWonRound = battle.roundResults[i];
            uint256 burnRoll = (burnSeed >> (i * 16)) % BPS_DENOMINATOR;

            if (challengerWonRound) {
                // Defender lost this round - check burn based on defender's NFT rarity
                uint8 defenderRarity = battle.defenderRarities[i];
                uint16 burnChance = rarityBurnChance[defenderRarity];

                if (burnRoll < burnChance) {
                    nft.safeTransferFrom(address(this), DEAD_ADDRESS, battle.defenderNFTs[i]);
                    battle.defenderBurned[i] = true;
                } else {
                    nft.safeTransferFrom(address(this), battle.defender, battle.defenderNFTs[i]);
                }
                nft.safeTransferFrom(address(this), battle.challenger, battle.challengerNFTs[i]);
            } else {
                // Challenger lost this round - check burn based on challenger's NFT rarity
                uint8 challengerRarity = battle.challengerRarities[i];
                uint16 burnChance = rarityBurnChance[challengerRarity];

                if (burnRoll < burnChance) {
                    nft.safeTransferFrom(address(this), DEAD_ADDRESS, battle.challengerNFTs[i]);
                    battle.challengerBurned[i] = true;
                } else {
                    nft.safeTransferFrom(address(this), battle.challenger, battle.challengerNFTs[i]);
                }
                nft.safeTransferFrom(address(this), battle.defender, battle.defenderNFTs[i]);
            }
        }

        uint256 totalPot = battle.betAmount * 2;
        uint256 feeAmount = (totalPot * feeBps) / BPS_DENOMINATOR;
        uint256 winnerPayout = totalPot - feeAmount;

        qlwyToken.safeTransfer(winner, winnerPayout);

        if (feeAmount > 0) {
            qlwyToken.approve(address(treasury), feeAmount);
            treasury.deposit(feeAmount);
        }

        bool[3] memory loserBurned = challengerIsWinner ? battle.defenderBurned : battle.challengerBurned;

        emit BattleResolved(battleId, winner, loser, winnerPayout, feeAmount, battle.roundResults, loserBurned);
    }

    function cancelBattle(uint256 battleId) external nonReentrant {
        Battle storage battle = battles[battleId];
        if (battle.challenger != msg.sender) revert NotChallenger();
        if (battle.status != BattleStatus.OPEN) revert BattleNotOpen();
        if (block.timestamp < uint256(battle.createdAt) + openTimeout) revert NotExpired();

        battle.status = BattleStatus.CANCELLED;

        IERC721 nft = IERC721(address(fortuneCore));
        for (uint256 i = 0; i < CARDS_PER_PLAYER; i++) {
            nft.safeTransferFrom(address(this), msg.sender, battle.challengerNFTs[i]);
        }

        qlwyToken.safeTransfer(msg.sender, battle.betAmount);

        emit BattleCancelled(battleId, msg.sender);
    }

    function cancelPendingBattle(uint256 battleId) external nonReentrant {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.PENDING) revert BattleNotPending();
        if (block.timestamp < uint256(battle.acceptedAt) + vrfTimeout) revert NotExpired();

        battle.status = BattleStatus.CANCELLED;

        IERC721 nft = IERC721(address(fortuneCore));

        for (uint256 i = 0; i < CARDS_PER_PLAYER; i++) {
            nft.safeTransferFrom(address(this), battle.challenger, battle.challengerNFTs[i]);
        }
        qlwyToken.safeTransfer(battle.challenger, battle.betAmount);

        for (uint256 i = 0; i < CARDS_PER_PLAYER; i++) {
            nft.safeTransferFrom(address(this), battle.defender, battle.defenderNFTs[i]);
        }
        qlwyToken.safeTransfer(battle.defender, battle.betAmount);

        emit BattleCancelled(battleId, msg.sender);
    }

    /// @notice Claim betting winnings after battle is resolved
    function claimBetWinnings(uint256 battleId) external nonReentrant {
        Battle storage battle = battles[battleId];
        if (battle.status != BattleStatus.RESOLVED) revert AlreadyResolved();
        if (betsClaimed[battleId][msg.sender]) revert AlreadyClaimed();

        bool challengerWon = battle.winner == battle.challenger;
        uint256 userBetOnWinner = challengerWon
            ? challengerBets[battleId][msg.sender]
            : defenderBets[battleId][msg.sender];
        uint256 userBetOnLoser = challengerWon
            ? defenderBets[battleId][msg.sender]
            : challengerBets[battleId][msg.sender];

        if (userBetOnWinner == 0 && userBetOnLoser == 0) revert NothingToClaim();

        betsClaimed[battleId][msg.sender] = true;

        uint256 payout = 0;

        // Return the winning bet principal
        payout += userBetOnWinner;

        // Calculate share of losing pool and pay betting fees
        if (userBetOnWinner > 0) {
            uint256 winningPool = challengerWon ? battle.challengerBetPool : battle.defenderBetPool;
            uint256 losingPool = challengerWon ? battle.defenderBetPool : battle.challengerBetPool;

            if (winningPool > 0 && losingPool > 0) {
                // Deduct betting fees from losing pool
                uint256 bettingFee = (losingPool * bettingFeeBps) / BPS_DENOMINATOR;
                uint256 treasuryFee = (losingPool * treasuryBettingFeeBps) / BPS_DENOMINATOR;
                uint256 distributablePool = losingPool - bettingFee - treasuryFee;

                // Pay betting fee to challenger (battle creator) - only once per battle
                if (!bettingFeePaid[battleId] && bettingFee > 0) {
                    bettingFeePaid[battleId] = true;
                    qlwyToken.safeTransfer(battle.challenger, bettingFee);
                    emit BettingFeePaid(battleId, battle.challenger, bettingFee);
                }

                // Pay treasury fee - only once per battle
                if (!treasuryBettingFeePaid[battleId] && treasuryFee > 0) {
                    treasuryBettingFeePaid[battleId] = true;
                    qlwyToken.approve(address(treasury), treasuryFee);
                    treasury.deposit(treasuryFee);
                }

                // User's share based on their proportion of winning pool
                uint256 userShare = (distributablePool * userBetOnWinner) / winningPool;
                payout += userShare;
            }
        }

        // Losing bets are forfeited (already accounted for in the pool distribution)

        if (payout > 0) {
            qlwyToken.safeTransfer(msg.sender, payout);
        }

        emit BetClaimed(battleId, msg.sender, payout);
    }

    /// @notice Get user's bet amounts on a battle
    function getUserBets(uint256 battleId, address user) external view returns (
        uint256 betOnChallenger,
        uint256 betOnDefender,
        bool claimed
    ) {
        betOnChallenger = challengerBets[battleId][user];
        betOnDefender = defenderBets[battleId][user];
        claimed = betsClaimed[battleId][user];
    }

    /// @notice Calculate potential winnings for a user
    function calculatePotentialWinnings(uint256 battleId, address user, bool ifChallengerWins)
        external
        view
        returns (uint256 potentialPayout)
    {
        Battle storage battle = battles[battleId];

        uint256 userBetOnWinner = ifChallengerWins
            ? challengerBets[battleId][user]
            : defenderBets[battleId][user];

        if (userBetOnWinner == 0) return 0;

        // Principal
        potentialPayout = userBetOnWinner;

        uint256 winningPool = ifChallengerWins ? battle.challengerBetPool : battle.defenderBetPool;
        uint256 losingPool = ifChallengerWins ? battle.defenderBetPool : battle.challengerBetPool;

        if (winningPool > 0 && losingPool > 0) {
            uint256 bettingFee = (losingPool * bettingFeeBps) / BPS_DENOMINATOR;
            uint256 treasuryFee = (losingPool * treasuryBettingFeeBps) / BPS_DENOMINATOR;
            uint256 distributablePool = losingPool - bettingFee - treasuryFee;
            uint256 userShare = (distributablePool * userBetOnWinner) / winningPool;
            potentialPayout += userShare;
        }
    }

    function getBattle(uint256 battleId) external view returns (
        address challenger,
        address defender,
        uint256[3] memory challengerNFTs,
        uint256[3] memory defenderNFTs,
        uint8[3] memory challengerLucks,
        uint8[3] memory defenderLucks,
        uint8[3] memory challengerRarities,
        uint8[3] memory defenderRarities,
        uint256 betAmount,
        BattleStatus status,
        address winner
    ) {
        Battle storage battle = battles[battleId];
        challenger = battle.challenger;
        defender = battle.defender;
        challengerNFTs = battle.challengerNFTs;
        defenderNFTs = battle.defenderNFTs;
        challengerLucks = battle.challengerLucks;
        defenderLucks = battle.defenderLucks;
        challengerRarities = battle.challengerRarities;
        defenderRarities = battle.defenderRarities;
        betAmount = battle.betAmount;
        status = battle.status;
        winner = battle.winner;
    }

    function getBattleResult(uint256 battleId) external view returns (
        bool[3] memory roundResults,
        uint8 challengerWins,
        uint8 defenderWins,
        bool[3] memory challengerBurned,
        bool[3] memory defenderBurned
    ) {
        Battle storage battle = battles[battleId];
        roundResults = battle.roundResults;
        challengerWins = battle.challengerWins;
        defenderWins = battle.defenderWins;
        challengerBurned = battle.challengerBurned;
        defenderBurned = battle.defenderBurned;
    }

    function getBattleBettingInfo(uint256 battleId) external view returns (
        uint40 bettingEndsAt,
        uint256 challengerBetPool,
        uint256 defenderBetPool,
        BattleStatus status
    ) {
        Battle storage battle = battles[battleId];
        bettingEndsAt = battle.bettingEndsAt;
        challengerBetPool = battle.challengerBetPool;
        defenderBetPool = battle.defenderBetPool;
        status = battle.status;
    }

    function setMinBet(uint256 _minBet) external onlyOwner {
        minBet = _minBet;
    }

    function setMaxBet(uint256 _maxBet) external onlyOwner {
        maxBet = _maxBet;
    }

    function setFeeBps(uint16 _feeBps) external onlyOwner {
        require(_feeBps <= 2000, "fee too high");  // max 20%
        feeBps = _feeBps;
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
            require(_burnChances[i] <= BPS_DENOMINATOR, "invalid rate");
        }
        rarityBurnChance = _burnChances;
    }

    function setTimeouts(uint32 _openTimeout, uint32 _vrfTimeout, uint32 _bettingDuration) external onlyOwner {
        openTimeout = _openTimeout;
        vrfTimeout = _vrfTimeout;
        bettingDuration = _bettingDuration;
    }

    function setBettingFeeBps(uint16 _bettingFeeBps) external onlyOwner {
        require(_bettingFeeBps <= 2000, "fee too high");  // max 20%
        bettingFeeBps = _bettingFeeBps;
    }

    function setTreasuryBettingFeeBps(uint16 _treasuryBettingFeeBps) external onlyOwner {
        require(_treasuryBettingFeeBps <= 2000, "fee too high");  // max 20%
        treasuryBettingFeeBps = _treasuryBettingFeeBps;
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

    // View functions for rarity config
    function getRarityLuckBonus() external view returns (uint8[5] memory) {
        return rarityLuckBonus;
    }

    function getRarityBurnChance() external view returns (uint16[5] memory) {
        return rarityBurnChance;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}