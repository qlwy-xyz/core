// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface IQLWYFortuneCore {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenRarityOf(uint256 tokenId) external view returns (uint8);
    function mythicMintedCount() external view returns (uint256);
    function mythicTokenIds(uint256 index) external view returns (uint256);
}

// ─── Contract ────────────────────────────────────────────────────────────────

/// @title QLWYPredictionArbitration
/// @notice Registered arbitrators (staked Mythic NFT + QLWY tokens) vote on
///         prediction market disputes. 1 arbitrator = 1 vote. Quorum + majority
///         determines outcome. Arbitration fee distributed to voters as reward.
contract QLWYPredictionArbitration is Ownable, ReentrancyGuard, ERC721Holder {
    using SafeERC20 for IERC20;

    // ─── Constants ───────────────────────────────────────────────────────────

    uint8 public constant MYTHIC_RARITY = 4;

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Arbitration {
        uint256 marketId;
        uint8   outcomeA;           // proposed outcome (auto-trigger or proposer)
        uint8   outcomeB;           // disputed outcome (disputer)
        uint48  createdAt;
        uint48  deadline;           // voting deadline
        uint256 snapshotBlock;      // block number for ownership snapshot
        uint256 votesA;             // votes for outcomeA
        uint256 votesB;             // votes for outcomeB
        bool    resolved;
        uint8   finalOutcome;
        uint256 arbitrationFee;     // fee paid by disputer, distributed to voters
        uint256 totalVoters;        // count of unique voters (for fee distribution)
        uint256 arbitratorCountSnapshot; // active arbitrator count when created
        uint16  quorumBpsSnapshot;  // quorum bps when created
        uint8   extensionCount;     // number of times voting window was extended
        bool    exists;             // arbitration record exists
    }

    struct ArbitratorInfo {
        uint256 tokenId;            // staked Mythic NFT tokenId
        uint256 stakedAmount;       // staked QLWY token amount
        uint48  registeredAt;
        uint48  exitRequestedAt;    // 0 = not requested
        bool    active;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    IQLWYFortuneCore public immutable fortuneCore;
    IERC20 public immutable stablecoin;
    IERC20 public immutable qlwyToken;

    uint256 public nextArbitrationId = 1;
    mapping(uint256 => Arbitration) public arbitrations;

    /// @notice arbId => voter address => voted
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    /// @notice arbId => Mythic tokenId => voted (prevents re-register/re-vote with same NFT)
    mapping(uint256 => mapping(uint256 => bool)) public hasTokenVoted;

    /// @notice arbId => voter address => has claimed voter reward
    mapping(uint256 => mapping(address => bool)) public hasClaimedReward;
    mapping(uint256 => bool) public arbitrationDustClaimed;

    /// @notice Addresses authorized to create arbitration requests (prediction market contracts)
    mapping(address => bool) public authorizedRequesters;

    // ─── Arbitrator Registry ─────────────────────────────────────────────────

    mapping(address => ArbitratorInfo) public arbitrators;
    address[] public arbitratorList;
    mapping(address => uint256) private _arbitratorIndex; // index + 1 in arbitratorList (0 = not in list)
    uint256 public activeArbitratorCount;

    // ─── Configuration ───────────────────────────────────────────────────────

    uint48 public votingPeriod = 72 hours;
    uint16 public quorumBps = 2000;  // 20% of registered arbitrators
    uint256 public minArbitrationFee = 0;  // admin-controlled minimum fee, default 0
    uint256 public requiredStakeAmount = 1_000_000 * 1e18;  // 100万 QLWY tokens
    uint48 public exitCooldownPeriod = 7 days;
    uint256 public minActiveArbitrators = 1; // minimum active arbitrators required to start arbitration
    uint48 public emergencyGracePeriod = 7 days; // grace period after deadline before owner can emergency-resolve

    // ─── Events ──────────────────────────────────────────────────────────────

    event ArbitrationCreated(uint256 indexed arbId, uint256 indexed marketId, uint8 outcomeA, uint8 outcomeB, uint48 deadline, uint256 arbitrationFee);
    event VoteCast(uint256 indexed arbId, address indexed voter, uint8 outcome);
    event ArbitrationResolved(uint256 indexed arbId, uint8 outcome, uint256 votesA, uint256 votesB);
    event VotingExtended(uint256 indexed arbId, uint48 newDeadline);
    event VoterRewardClaimed(uint256 indexed arbId, address indexed voter, uint256 amount);
    event ArbitrationFeeAdded(uint256 indexed arbId, address indexed contributor, uint256 amount, uint256 newTotal);
    event ArbitratorRegistered(address indexed arbitrator, uint256 tokenId, uint256 stakedAmount);
    event ArbitratorExitRequested(address indexed arbitrator);
    event ArbitratorExited(address indexed arbitrator, uint256 tokenId, uint256 stakedAmount);
    event MinActiveArbitratorsUpdated(uint256 value);
    event ArbitrationDustClaimed(uint256 indexed arbId, address indexed recipient, uint256 amount);
    event EmergencyArbitrationResolved(uint256 indexed arbId, uint8 outcome);
    event EmergencyGracePeriodUpdated(uint48 period);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotAuthorized();
    error NotRegisteredArbitrator();
    error AlreadyRegistered();
    error NotMythicOwner();
    error NotMythicToken();
    error AlreadyVoted();
    error VotingNotOver();
    error VotingOver();
    error AlreadyResolved();
    error NotResolved();
    error AlreadyClaimed();
    error DidNotVote();
    error NoRewardAvailable();
    error FeeBelowMinimum();
    error ExitNotRequested();
    error ExitAlreadyRequested();
    error CooldownNotExpired();
    error ArbitrationNotFound();
    error InsufficientActiveArbitrators();
    error DustAlreadyClaimed();
    error NoDustAvailable();
    error EmergencyGracePeriodNotExpired();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address owner_,
        IQLWYFortuneCore fortuneCore_,
        IERC20 stablecoin_,
        IERC20 qlwyToken_
    ) Ownable(owner_) {
        fortuneCore = fortuneCore_;
        stablecoin = stablecoin_;
        qlwyToken = qlwyToken_;
    }

    // ─── Arbitrator Registration ─────────────────────────────────────────────

    /// @notice Register as an arbitrator by staking a Mythic NFT + QLWY tokens.
    ///         The caller must own the Mythic NFT and have approved this contract
    ///         for both the NFT and the QLWY token transfer.
    function registerAsArbitrator(uint256 tokenId) external nonReentrant {
        if (arbitrators[msg.sender].active) revert AlreadyRegistered();
        if (fortuneCore.tokenRarityOf(tokenId) != MYTHIC_RARITY) revert NotMythicToken();
        if (fortuneCore.ownerOf(tokenId) != msg.sender) revert NotMythicOwner();

        // Transfer NFT to this contract (requires prior approval)
        IERC721(address(fortuneCore)).safeTransferFrom(msg.sender, address(this), tokenId);

        // Transfer QLWY tokens to this contract (requires prior approval)
        if (requiredStakeAmount > 0) {
            qlwyToken.safeTransferFrom(msg.sender, address(this), requiredStakeAmount);
        }

        // Record arbitrator info
        arbitrators[msg.sender] = ArbitratorInfo({
            tokenId: tokenId,
            stakedAmount: requiredStakeAmount,
            registeredAt: uint48(block.timestamp),
            exitRequestedAt: 0,
            active: true
        });

        // Add to arbitrator list
        arbitratorList.push(msg.sender);
        _arbitratorIndex[msg.sender] = arbitratorList.length; // 1-indexed
        activeArbitratorCount++;

        emit ArbitratorRegistered(msg.sender, tokenId, requiredStakeAmount);
    }

    /// @notice Request to exit as arbitrator. Starts a cooldown period.
    function requestExit() external {
        ArbitratorInfo storage info = arbitrators[msg.sender];
        if (!info.active) revert NotRegisteredArbitrator();
        if (info.exitRequestedAt != 0) revert ExitAlreadyRequested();

        info.exitRequestedAt = uint48(block.timestamp);
        emit ArbitratorExitRequested(msg.sender);
    }

    /// @notice Complete exit after cooldown period. Returns staked NFT and QLWY tokens.
    function completeExit() external nonReentrant {
        ArbitratorInfo storage info = arbitrators[msg.sender];
        if (!info.active) revert NotRegisteredArbitrator();
        if (info.exitRequestedAt == 0) revert ExitNotRequested();
        if (uint48(block.timestamp) < info.exitRequestedAt + exitCooldownPeriod) revert CooldownNotExpired();

        uint256 tokenId = info.tokenId;
        uint256 stakedAmount = info.stakedAmount;

        // Deactivate
        info.active = false;
        activeArbitratorCount--;

        // Remove from arbitratorList (swap with last, then pop)
        uint256 idx = _arbitratorIndex[msg.sender];
        if (idx > 0) {
            uint256 lastIdx = arbitratorList.length;
            if (idx != lastIdx) {
                address lastAddr = arbitratorList[lastIdx - 1];
                arbitratorList[idx - 1] = lastAddr;
                _arbitratorIndex[lastAddr] = idx;
            }
            arbitratorList.pop();
            _arbitratorIndex[msg.sender] = 0;
        }

        // Return staked NFT
        IERC721(address(fortuneCore)).safeTransferFrom(address(this), msg.sender, tokenId);

        // Return staked QLWY tokens
        if (stakedAmount > 0) {
            qlwyToken.safeTransfer(msg.sender, stakedAmount);
        }

        emit ArbitratorExited(msg.sender, tokenId, stakedAmount);
    }

    // ─── Arbitration Lifecycle ───────────────────────────────────────────────

    /// @notice Request a new arbitration (called by prediction market contract)
    /// @dev The caller must have already transferred `arbitrationFee` stablecoin to this contract
    function requestArbitration(
        uint256 marketId,
        uint8 currentOutcome,
        uint8 disputedOutcome,
        uint256 arbitrationFee
    ) external returns (uint256 arbId) {
        if (!authorizedRequesters[msg.sender]) revert NotAuthorized();
        if (arbitrationFee < minArbitrationFee) revert FeeBelowMinimum();
        if (activeArbitratorCount < minActiveArbitrators) revert InsufficientActiveArbitrators();

        arbId = nextArbitrationId++;
        Arbitration storage arb = arbitrations[arbId];
        arb.marketId = marketId;
        arb.outcomeA = currentOutcome;
        arb.outcomeB = disputedOutcome;
        arb.createdAt = uint48(block.timestamp);
        arb.deadline = uint48(block.timestamp) + votingPeriod;
        arb.snapshotBlock = block.number;
        arb.arbitratorCountSnapshot = activeArbitratorCount;
        arb.quorumBpsSnapshot = quorumBps;
        arb.extensionCount = 0;
        arb.exists = true;
        arb.votesA = 0;
        arb.votesB = 0;
        arb.resolved = false;
        arb.finalOutcome = 0;
        arb.arbitrationFee = arbitrationFee;
        arb.totalVoters = 0;

        emit ArbitrationCreated(arbId, marketId, currentOutcome, disputedOutcome, arb.deadline, arbitrationFee);
    }

    /// @notice Cast a vote as a registered arbitrator (1 arbitrator = 1 vote)
    function vote(uint256 arbId, uint8 outcome) external {
        Arbitration storage arb = arbitrations[arbId];
        if (!arb.exists) revert ArbitrationNotFound();
        if (!arbitrators[msg.sender].active) revert NotRegisteredArbitrator();
        if (block.timestamp > arb.deadline) revert VotingOver();
        if (arb.resolved) revert AlreadyResolved();
        if (hasVoted[arbId][msg.sender]) revert AlreadyVoted();

        uint256 tokenId = arbitrators[msg.sender].tokenId;
        if (hasTokenVoted[arbId][tokenId]) revert AlreadyVoted();

        hasVoted[arbId][msg.sender] = true;
        hasTokenVoted[arbId][tokenId] = true;
        arb.totalVoters++;

        if (outcome == arb.outcomeA) {
            arb.votesA++;
        } else if (outcome == arb.outcomeB) {
            arb.votesB++;
        } else {
            revert("invalid outcome");
        }

        emit VoteCast(arbId, msg.sender, outcome);
    }

    /// @notice Resolve arbitration after voting period ends.
    ///         If quorum is not met, extends deadline by votingPeriod (no extension limit).
    function resolve(uint256 arbId) external {
        Arbitration storage arb = arbitrations[arbId];
        if (!arb.exists) revert ArbitrationNotFound();
        if (arb.resolved) revert AlreadyResolved();
        if (block.timestamp <= arb.deadline) revert VotingNotOver();

        // Check quorum based on snapshot at arbitration creation
        uint256 totalVotes = arb.votesA + arb.votesB;
        uint256 quorumRequired = (arb.arbitratorCountSnapshot * arb.quorumBpsSnapshot + 9_999) / 10_000;
        if (quorumRequired == 0) quorumRequired = 1;

        if (totalVotes < quorumRequired) {
            // Quorum not met → extend deadline, do not resolve yet
            arb.extensionCount++;
            arb.deadline = uint48(block.timestamp) + votingPeriod;
            emit VotingExtended(arbId, arb.deadline);
            return;
        }

        // Majority wins (tie goes to outcomeA — the proposer)
        arb.finalOutcome = arb.votesA >= arb.votesB ? arb.outcomeA : arb.outcomeB;
        arb.resolved = true;

        emit ArbitrationResolved(arbId, arb.finalOutcome, arb.votesA, arb.votesB);
    }

    /// @notice Emergency resolve a stuck arbitration (owner only).
    /// @dev    Callable only after deadline + emergencyGracePeriod has elapsed.
    ///         Used when quorum can never be met (e.g., all arbitrators exited).
    ///         Owner may set outcome to outcomeA, outcomeB, or INVALID (0).
    function emergencyResolveArbitration(uint256 arbId, uint8 outcome) external onlyOwner {
        Arbitration storage arb = arbitrations[arbId];
        if (!arb.exists) revert ArbitrationNotFound();
        if (arb.resolved) revert AlreadyResolved();
        if (block.timestamp <= arb.deadline + emergencyGracePeriod) revert EmergencyGracePeriodNotExpired();

        // Allow outcomeA, outcomeB, or INVALID (0)
        if (outcome != arb.outcomeA && outcome != arb.outcomeB && outcome != 0)
            revert("invalid outcome");

        arb.finalOutcome = outcome;
        arb.resolved = true;

        emit EmergencyArbitrationResolved(arbId, outcome);
    }

    /// @notice Anyone can add more arbitration fee to attract voter participation
    function addArbitrationFee(uint256 arbId, uint256 amount) external nonReentrant {
        Arbitration storage arb = arbitrations[arbId];
        if (!arb.exists) revert ArbitrationNotFound();
        if (arb.resolved) revert AlreadyResolved();
        if (amount == 0) revert("zero amount");

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);
        arb.arbitrationFee += amount;

        emit ArbitrationFeeAdded(arbId, msg.sender, amount, arb.arbitrationFee);
    }

    /// @notice Voter claims their share of the arbitration fee
    function claimVoterReward(uint256 arbId) external nonReentrant {
        Arbitration storage arb = arbitrations[arbId];
        if (!arb.exists) revert ArbitrationNotFound();
        if (!arb.resolved) revert NotResolved();
        if (!hasVoted[arbId][msg.sender]) revert DidNotVote();
        if (hasClaimedReward[arbId][msg.sender]) revert AlreadyClaimed();
        if (arb.arbitrationFee == 0) revert NoRewardAvailable();

        hasClaimedReward[arbId][msg.sender] = true;

        // Equal share per vote: arbitrationFee / totalVoters
        uint256 reward = arb.arbitrationFee / arb.totalVoters;
        if (reward == 0) revert NoRewardAvailable();

        stablecoin.safeTransfer(msg.sender, reward);

        emit VoterRewardClaimed(arbId, msg.sender, reward);
    }

    /// @notice Claim non-distributable reward dust for a resolved arbitration.
    /// @dev This does not affect voters' claimable rewards.
    function claimArbitrationDust(uint256 arbId) external onlyOwner nonReentrant {
        Arbitration storage arb = arbitrations[arbId];
        if (!arb.exists) revert ArbitrationNotFound();
        if (!arb.resolved) revert NotResolved();
        if (arbitrationDustClaimed[arbId]) revert DustAlreadyClaimed();

        uint256 dust = arb.totalVoters == 0
            ? arb.arbitrationFee
            : arb.arbitrationFee % arb.totalVoters;
        if (dust == 0) revert NoDustAvailable();

        arbitrationDustClaimed[arbId] = true;
        address recipient = owner();
        stablecoin.safeTransfer(recipient, dust);

        emit ArbitrationDustClaimed(arbId, recipient, dust);
    }

    /// @notice Get arbitration result (called by prediction market contract)
    function getResult(uint256 arbId) external view returns (bool resolved, uint8 outcome) {
        Arbitration storage arb = arbitrations[arbId];
        if (!arb.exists) return (false, 0);
        return (arb.resolved, arb.finalOutcome);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function isRegisteredArbitrator(address addr) external view returns (bool) {
        return arbitrators[addr].active;
    }

    function getArbitratorCount() external view returns (uint256) {
        return activeArbitratorCount;
    }

    function getArbitratorListLength() external view returns (uint256) {
        return arbitratorList.length;
    }

    /// @notice Get a page of arbitrator addresses for UI display
    function getArbitrators(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 len = arbitratorList.length;
        if (offset >= len) return new address[](0);
        uint256 end = offset + limit;
        if (end > len) end = len;
        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = arbitratorList[i];
        }
        return result;
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setAuthorizedRequester(address requester, bool authorized) external onlyOwner {
        authorizedRequesters[requester] = authorized;
    }

    function setVotingPeriod(uint48 period) external onlyOwner {
        votingPeriod = period;
    }

    function setQuorumBps(uint16 bps) external onlyOwner {
        require(bps <= 10_000, "invalid bps");
        quorumBps = bps;
    }

    function setMinArbitrationFee(uint256 fee) external onlyOwner {
        minArbitrationFee = fee;
    }

    function setRequiredStakeAmount(uint256 amount) external onlyOwner {
        requiredStakeAmount = amount;
    }

    function setExitCooldownPeriod(uint48 period) external onlyOwner {
        exitCooldownPeriod = period;
    }

    function setMinActiveArbitrators(uint256 value) external onlyOwner {
        if (value == 0) revert("min active must be >= 1");
        minActiveArbitrators = value;
        emit MinActiveArbitratorsUpdated(value);
    }

    function setEmergencyGracePeriod(uint48 period) external onlyOwner {
        emergencyGracePeriod = period;
        emit EmergencyGracePeriodUpdated(period);
    }

}
