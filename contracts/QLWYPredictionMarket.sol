// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface IQLWYPredictionArbitration {
    function requestArbitration(uint256 marketId, uint8 currentOutcome, uint8 disputedOutcome, uint256 arbitrationFee) external returns (uint256 arbitrationId);
    function getResult(uint256 arbitrationId) external view returns (bool resolved, uint8 outcome);
}

// ─── Contract ────────────────────────────────────────────────────────────────

/// @title QLWYPredictionMarket
/// @notice Permissionless prediction markets with LMSR AMM, dynamic liquidity,
///         creator-initiated settlement, and Mythic NFT arbitration.
contract QLWYPredictionMarket is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    using FixedPointMathLib for uint256;
    using FixedPointMathLib for int256;

    // ─── Constants ───────────────────────────────────────────────────────────

    /// @dev ln(2) in WAD (1e18) precision
    int256 internal constant LN2_WAD = 693147180559945309;

    /// @dev 1e18
    int256 internal constant WAD = 1e18;

    uint16 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Outcome indices
    uint8 public constant YES = 1;
    uint8 public constant NO = 2;
    uint8 public constant INVALID = 0;

    // ─── Enums ───────────────────────────────────────────────────────────────

    enum MarketStatus {
        Trading,        // 0 — active trading
        DisputePeriod,  // 1 — 24h dispute window (auto-triggered)
        Arbitration,    // 2 — Mythic NFT voting
        Resolved        // 3 — final, payouts claimable
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct Market {
        // Metadata (immutable after creation)
        string  metadataUri;
        bytes32 metadataHash;

        // Participants
        address creator;

        // Timing
        uint48  createdAt;
        uint48  expiresAt;          // mandatory market expiry timestamp
        uint48  lastTradeAt;        // timestamp of last trade

        // LMSR state (WAD precision, stored as int256 for math)
        int256  b;          // liquidity parameter
        int256  qYes;       // quantity of YES shares
        int256  qNo;        // quantity of NO shares

        // Economics
        uint256 subsidyPool;        // total subsidy deposited
        uint256 totalVolume;        // cumulative trade volume
        uint256 creatorFeeAccrued;  // creator's accumulated fees
        uint256 protocolFeeAccrued; // protocol's accumulated fees

        // Settlement
        MarketStatus status;
        uint8   resolvedOutcome;    // YES / NO / INVALID
        uint8   proposedOutcome;    // proposed outcome during DisputePeriod
        uint48  settledAt;          // when outcome was proposed (DisputePeriod start)
        uint256 arbitrationId;      // reference to arbitration contract
        uint256 pendingWinnings;    // reserved, unclaimed winner payout
    }

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20 public immutable stablecoin;
    uint8 public immutable stablecoinDecimals;
    uint256 public immutable stablecoinToWadFactor;
    IQLWYPredictionArbitration public arbitration;

    uint256 public nextMarketId = 1;
    mapping(uint256 => Market) public markets;

    /// @notice User holdings: marketId => user => outcome => shares (WAD)
    mapping(uint256 => mapping(address => mapping(uint8 => int256))) public positions;

    /// @notice LP subsidy shares: marketId => provider => amount
    mapping(uint256 => mapping(address => uint256)) public subsidyShares;
    /// @notice Total LP shares per market
    mapping(uint256 => uint256) public totalSubsidyShares;

    // ─── Configuration ───────────────────────────────────────────────────────

    uint256 public minSubsidy;                      // default = 10 stablecoin units
    uint48  public disputePeriod = 24 hours;
    uint48  public minDuration = 1 hours;
    uint48  public creatorSettlementGracePeriod = 24 hours; // after expiry, anyone can force INVALID
    uint16  public creatorFeeBps = 100;              // 1%
    uint16  public protocolFeeBps = 100;             // 1%
    uint16  public lpFeeBps = 100;                   // 1% — accrued to subsidyPool for LP reward
    address public protocolFeeRecipient;

    // ─── Events ──────────────────────────────────────────────────────────────

    event MarketCreated(
        uint256 indexed marketId,
        address indexed creator,
        string  metadataUri,
        bytes32 metadataHash,
        uint48  expiresAt,
        int256  b
    );
    event SubsidyAdded(uint256 indexed marketId, address indexed provider, uint256 amount, int256 newB);
    event SharesBought(uint256 indexed marketId, address indexed buyer, uint8 outcome, int256 shares, uint256 cost);
    event SharesSold(uint256 indexed marketId, address indexed seller, uint8 outcome, int256 shares, uint256 payout);
    event CreatorSettlementProposed(uint256 indexed marketId, address indexed creator, uint8 proposedOutcome);
    event OutcomeDisputed(uint256 indexed marketId, address indexed disputer, uint8 disputedOutcome, uint256 arbitrationFee);
    event MarketResolved(uint256 indexed marketId, uint8 outcome);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 payout);
    event CreatorFeeClaimed(uint256 indexed marketId, address indexed creator, uint256 amount);
    event SubsidyClaimed(uint256 indexed marketId, address indexed provider, uint256 amount);
    event ArbitrationRequested(uint256 indexed marketId, uint256 indexed arbitrationId);
    event MarketDustSwept(uint256 indexed marketId, address indexed recipient, uint256 amount);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error MarketNotTrading();
    error MarketNotExpired();
    error MarketExpired();
    error MarketNotFound();
    error InvalidOutcome();
    error InsufficientShares();
    error BelowMinSubsidy();
    error InvalidMetadata();
    error DurationTooShort();
    error NotCreator();
    error NotInPhase(MarketStatus expected);
    error DisputePeriodNotOver();
    error DisputePeriodOver();
    error AlreadyResolved();
    error NothingToClaim();
    error ZeroShares();
    error ArbitrationNotConfigured();
    error UnsupportedStablecoinDecimals(uint8 decimals);
    error InsufficientPoolLiquidity();
    error PendingWinningsRemaining();
    error SubsidySharesRemaining();
    error InvalidInitialProbability();

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address owner_,
        IERC20 stablecoin_,
        address protocolFeeRecipient_
    ) Ownable(owner_) {
        stablecoin = stablecoin_;
        protocolFeeRecipient = protocolFeeRecipient_;

        uint8 decimals_ = IERC20Metadata(address(stablecoin_)).decimals();
        if (decimals_ > 18) revert UnsupportedStablecoinDecimals(decimals_);
        stablecoinDecimals = decimals_;
        stablecoinToWadFactor = 10 ** (18 - decimals_);
        minSubsidy = 10 * (10 ** decimals_);
    }

    // ─── LMSR Math (internal) ────────────────────────────────────────────────

    function _tokenToWad(uint256 amount) internal view returns (uint256) {
        return amount * stablecoinToWadFactor;
    }

    function _wadToTokenDown(uint256 amountWad) internal view returns (uint256) {
        return amountWad / stablecoinToWadFactor;
    }

    function _wadToTokenUp(uint256 amountWad) internal view returns (uint256) {
        uint256 factor = stablecoinToWadFactor;
        if (amountWad == 0) return 0;
        return (amountWad + factor - 1) / factor;
    }

    /// @dev Cost function: C(q) = b * ln(exp(qYes/b) + exp(qNo/b))
    ///      Uses log-sum-exp trick: C = b * (max/b + ln(1 + exp((min - max)/b)))
    function _cost(int256 b_, int256 qYes_, int256 qNo_) internal pure returns (int256) {
        int256 maxQ = qYes_ > qNo_ ? qYes_ : qNo_;
        int256 minQ = qYes_ > qNo_ ? qNo_ : qYes_;

        // (minQ - maxQ) * WAD / b_  — guaranteed <= 0, so exp won't overflow
        int256 diff = (minQ - maxQ) * WAD / b_;
        int256 expDiff = diff.expWad();

        // ln(1 + expDiff) in WAD
        int256 lnPart = (WAD + expDiff).lnWad();

        // C = maxQ + b * lnPart / WAD
        return maxQ + b_ * lnPart / WAD;
    }

    /// @dev Price of YES outcome: p = exp(qYes/b) / (exp(qYes/b) + exp(qNo/b))
    ///      = 1 / (1 + exp((qNo - qYes) / b))
    function _priceYes(int256 b_, int256 qYes_, int256 qNo_) internal pure returns (int256) {
        int256 diff = (qNo_ - qYes_) * WAD / b_;
        int256 expDiff = diff.expWad();
        return WAD * WAD / (WAD + expDiff);
    }

    /// @dev Price of NO outcome
    function _priceNo(int256 b_, int256 qYes_, int256 qNo_) internal pure returns (int256) {
        return WAD - _priceYes(b_, qYes_, qNo_);
    }

    // ─── Market Creation ─────────────────────────────────────────────────────

    /// @notice Create a new prediction market
    /// @param metadataUri      URI pointing to the metadata JSON (IPFS/HTTP)
    /// @param metadataHash     keccak256 of the metadata JSON bytes
    /// @param expiresAt        Market expiry timestamp (must be in the future)
    /// @param subsidyAmount    Initial liquidity subsidy in stablecoin
    /// @param initialProbBps   Initial YES probability in basis points (1–9999, e.g. 7000 = 70%). Use 5000 for 50:50.
    function createMarket(
        string calldata metadataUri,
        bytes32 metadataHash,
        uint48 expiresAt,
        uint256 subsidyAmount,
        uint16 initialProbBps
    ) external whenNotPaused nonReentrant returns (uint256 marketId) {
        if (bytes(metadataUri).length == 0 || metadataHash == bytes32(0)) revert InvalidMetadata();
        if (expiresAt < block.timestamp + minDuration) revert DurationTooShort();
        if (subsidyAmount < minSubsidy) revert BelowMinSubsidy();
        if (initialProbBps == 0 || initialProbBps >= BPS_DENOMINATOR) revert InvalidInitialProbability();

        stablecoin.safeTransferFrom(msg.sender, address(this), subsidyAmount);
        uint256 subsidyWad = _tokenToWad(subsidyAmount);

        marketId = nextMarketId++;
        Market storage mkt = markets[marketId];

        mkt.metadataUri = metadataUri;
        mkt.metadataHash = metadataHash;
        mkt.creator = msg.sender;
        mkt.createdAt = uint48(block.timestamp);
        mkt.expiresAt = expiresAt;
        mkt.lastTradeAt = uint48(block.timestamp);

        // b = subsidyAmount * WAD / ln(2)  — subsidy is the max loss
        int256 b_ = int256(subsidyWad) * WAD / LN2_WAD;
        mkt.b = b_;
        mkt.subsidyPool = subsidyAmount;
        mkt.status = MarketStatus.Trading;

        // Set initial probability via qYes/qNo offset
        // Formula: qYes - qNo = b * ln(p / (1-p))
        if (initialProbBps != 5000) {
            int256 pWad = int256(uint256(initialProbBps)) * WAD / int256(uint256(BPS_DENOMINATOR));
            // ln(p / (1-p))  —  logit function in WAD
            int256 logOdds = (pWad * WAD / (WAD - pWad)).lnWad();
            int256 delta = b_ * logOdds / WAD;
            if (delta > 0) {
                mkt.qYes = delta;
            } else {
                mkt.qNo = -delta;
            }
        }
        // When initialProbBps == 5000, qYes = qNo = 0 (default) → 50:50

        // Track LP shares for creator
        subsidyShares[marketId][msg.sender] = subsidyAmount;
        totalSubsidyShares[marketId] = subsidyAmount;

        emit MarketCreated(marketId, msg.sender, metadataUri, metadataHash, expiresAt, b_);
    }

    // ─── Dynamic Liquidity ───────────────────────────────────────────────────

    /// @notice Add subsidy to increase liquidity depth (anyone can call)
    function addSubsidy(uint256 marketId, uint256 amount) external whenNotPaused nonReentrant {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Trading) revert MarketNotTrading();
        if (amount < minSubsidy) revert BelowMinSubsidy();

        stablecoin.safeTransferFrom(msg.sender, address(this), amount);

        mkt.b += int256(_tokenToWad(amount)) * WAD / LN2_WAD;
        mkt.subsidyPool += amount;

        subsidyShares[marketId][msg.sender] += amount;
        totalSubsidyShares[marketId] += amount;

        emit SubsidyAdded(marketId, msg.sender, amount, mkt.b);
    }

    // ─── Trading ─────────────────────────────────────────────────────────────

    /// @notice Buy outcome shares
    /// @param marketId Market ID
    /// @param outcome  YES (1) or NO (2)
    /// @param shares   Number of shares to buy (WAD precision)
    /// @param maxCost  Maximum stablecoin cost (slippage protection)
    function buy(
        uint256 marketId,
        uint8 outcome,
        int256 shares,
        uint256 maxCost
    ) external whenNotPaused nonReentrant {
        if (outcome != YES && outcome != NO) revert InvalidOutcome();
        if (shares <= 0) revert ZeroShares();
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Trading) revert MarketNotTrading();
        if (block.timestamp >= mkt.expiresAt) revert MarketExpired();

        // Calculate cost = C(q + shares) - C(q)
        int256 newQYes = mkt.qYes;
        int256 newQNo  = mkt.qNo;
        if (outcome == YES) {
            newQYes += shares;
        } else {
            newQNo += shares;
        }

        int256 costBefore = _cost(mkt.b, mkt.qYes, mkt.qNo);
        int256 costAfter  = _cost(mkt.b, newQYes, newQNo);
        int256 rawCost    = costAfter - costBefore;
        if (rawCost <= 0) revert("invalid cost");

        // Calculate fees
        uint256 absCost      = _wadToTokenUp(uint256(rawCost));
        uint256 creatorFee   = absCost * creatorFeeBps / BPS_DENOMINATOR;
        uint256 protocolFee  = absCost * protocolFeeBps / BPS_DENOMINATOR;
        uint256 lpFee        = absCost * lpFeeBps / BPS_DENOMINATOR;
        uint256 totalCost    = absCost + creatorFee + protocolFee + lpFee;

        require(totalCost <= maxCost, "cost exceeds max");

        stablecoin.safeTransferFrom(msg.sender, address(this), totalCost);

        // Update state
        mkt.qYes = newQYes;
        mkt.qNo  = newQNo;
        mkt.creatorFeeAccrued  += creatorFee;
        mkt.protocolFeeAccrued += protocolFee;
        // Pool excludes creator/protocol fee liabilities, so only base cost + LP fee accrues.
        mkt.subsidyPool        += absCost + lpFee;
        mkt.totalVolume        += absCost;
        mkt.lastTradeAt        = uint48(block.timestamp);

        positions[marketId][msg.sender][outcome] += shares;

        emit SharesBought(marketId, msg.sender, outcome, shares, totalCost);
    }

    /// @notice Sell outcome shares back to the AMM
    /// @param marketId  Market ID
    /// @param outcome   YES (1) or NO (2)
    /// @param shares    Number of shares to sell (WAD precision)
    /// @param minPayout Minimum stablecoin received (slippage protection)
    function sell(
        uint256 marketId,
        uint8 outcome,
        int256 shares,
        uint256 minPayout
    ) external whenNotPaused nonReentrant {
        if (outcome != YES && outcome != NO) revert InvalidOutcome();
        if (shares <= 0) revert ZeroShares();
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Trading) revert MarketNotTrading();
        if (block.timestamp >= mkt.expiresAt) revert MarketExpired();
        if (positions[marketId][msg.sender][outcome] < shares) revert InsufficientShares();

        // Calculate payout = C(q) - C(q - shares)
        int256 newQYes = mkt.qYes;
        int256 newQNo  = mkt.qNo;
        if (outcome == YES) {
            newQYes -= shares;
        } else {
            newQNo -= shares;
        }

        int256 costBefore = _cost(mkt.b, mkt.qYes, mkt.qNo);
        int256 costAfter  = _cost(mkt.b, newQYes, newQNo);
        int256 rawPayout  = costBefore - costAfter;
        if (rawPayout <= 0) revert("invalid payout");

        // Deduct fees from payout
        uint256 absPayout    = _wadToTokenDown(uint256(rawPayout));
        uint256 creatorFee   = absPayout * creatorFeeBps / BPS_DENOMINATOR;
        uint256 protocolFee  = absPayout * protocolFeeBps / BPS_DENOMINATOR;
        uint256 lpFee        = absPayout * lpFeeBps / BPS_DENOMINATOR;
        uint256 netPayout    = absPayout - creatorFee - protocolFee - lpFee;
        uint256 poolDecrease = absPayout - lpFee;

        require(netPayout >= minPayout, "payout below min");
        if (mkt.subsidyPool < poolDecrease) revert InsufficientPoolLiquidity();

        // Update state
        mkt.qYes = newQYes;
        mkt.qNo  = newQNo;
        mkt.creatorFeeAccrued  += creatorFee;
        mkt.protocolFeeAccrued += protocolFee;
        // Pool excludes creator/protocol fee liabilities.
        mkt.subsidyPool        -= poolDecrease;
        mkt.totalVolume        += absPayout;
        mkt.lastTradeAt        = uint48(block.timestamp);

        positions[marketId][msg.sender][outcome] -= shares;

        stablecoin.safeTransfer(msg.sender, netPayout);

        emit SharesSold(marketId, msg.sender, outcome, shares, netPayout);
    }

    // ─── View Functions ──────────────────────────────────────────────────────

    /// @notice Get the current price of YES in WAD (0 to 1e18)
    function getPrice(uint256 marketId) external view returns (int256 yesPrice, int256 noPrice) {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        yesPrice = _priceYes(mkt.b, mkt.qYes, mkt.qNo);
        noPrice  = WAD - yesPrice;
    }

    /// @notice Calculate cost to buy `shares` of `outcome`
    function costToBuy(uint256 marketId, uint8 outcome, int256 shares) external view returns (uint256 totalCost) {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (outcome != YES && outcome != NO) revert InvalidOutcome();
        if (shares <= 0) revert ZeroShares();
        int256 newQYes = mkt.qYes;
        int256 newQNo  = mkt.qNo;
        if (outcome == YES) newQYes += shares;
        else                newQNo  += shares;

        int256 rawCost = _cost(mkt.b, newQYes, newQNo) - _cost(mkt.b, mkt.qYes, mkt.qNo);
        if (rawCost <= 0) revert("invalid cost");
        uint256 absCost = _wadToTokenUp(uint256(rawCost));
        totalCost = absCost + absCost * (creatorFeeBps + protocolFeeBps + lpFeeBps) / BPS_DENOMINATOR;
    }

    /// @notice Calculate payout for selling `shares` of `outcome`
    function payoutForSell(uint256 marketId, uint8 outcome, int256 shares) external view returns (uint256 netPayout) {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (outcome != YES && outcome != NO) revert InvalidOutcome();
        if (shares <= 0) revert ZeroShares();
        int256 newQYes = mkt.qYes;
        int256 newQNo  = mkt.qNo;
        if (outcome == YES) newQYes -= shares;
        else                newQNo  -= shares;

        int256 rawPayout = _cost(mkt.b, mkt.qYes, mkt.qNo) - _cost(mkt.b, newQYes, newQNo);
        if (rawPayout <= 0) revert("invalid payout");
        uint256 absPayout = _wadToTokenDown(uint256(rawPayout));
        netPayout = absPayout - absPayout * (creatorFeeBps + protocolFeeBps + lpFeeBps) / BPS_DENOMINATOR;
    }

    // ─── Settlement: Creator Settlement ───────────────────────────────────────

    /// @notice Creator proposes outcome after expiry → enters DisputePeriod (24h)
    /// @param marketId Market ID
    /// @param outcome  Proposed outcome (YES / NO / INVALID)
    function settleMarket(uint256 marketId, uint8 outcome) external {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Trading) revert MarketNotTrading();
        if (block.timestamp < mkt.expiresAt) revert MarketNotExpired();
        if (msg.sender != mkt.creator) {
            if (block.timestamp < mkt.expiresAt + creatorSettlementGracePeriod) revert NotCreator();
            if (outcome != INVALID) revert InvalidOutcome();
        }
        if (outcome != YES && outcome != NO && outcome != INVALID) revert InvalidOutcome();

        mkt.proposedOutcome = outcome;
        mkt.settledAt = uint48(block.timestamp);
        mkt.status = MarketStatus.DisputePeriod;
        emit CreatorSettlementProposed(marketId, msg.sender, outcome);
    }

    // ─── Settlement: Dispute ─────────────────────────────────────────────────

    /// @notice Dispute the auto-proposed outcome (pays arbitration fee)
    /// @param marketId Market ID
    /// @param disputedOutcome The outcome the disputer believes is correct
    /// @param arbitrationFee Fee to pay for arbitration (distributed to voters)
    function dispute(
        uint256 marketId,
        uint8 disputedOutcome,
        uint256 arbitrationFee
    ) external nonReentrant {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.DisputePeriod) revert NotInPhase(MarketStatus.DisputePeriod);
        if (block.timestamp > mkt.settledAt + disputePeriod) revert DisputePeriodOver();
        if (disputedOutcome != YES && disputedOutcome != NO && disputedOutcome != INVALID) revert InvalidOutcome();
        if (address(arbitration) == address(0)) revert ArbitrationNotConfigured();

        // Transfer arbitration fee from disputer to arbitration contract
        stablecoin.safeTransferFrom(msg.sender, address(arbitration), arbitrationFee);

        // Move to arbitration
        mkt.status = MarketStatus.Arbitration;
        uint256 arbId = arbitration.requestArbitration(marketId, mkt.proposedOutcome, disputedOutcome, arbitrationFee);
        mkt.arbitrationId = arbId;

        emit OutcomeDisputed(marketId, msg.sender, disputedOutcome, arbitrationFee);
        emit ArbitrationRequested(marketId, arbId);
    }

    /// @notice Finalize if dispute period passes with no dispute
    function finalizeAfterDisputePeriod(uint256 marketId) external {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.DisputePeriod) revert NotInPhase(MarketStatus.DisputePeriod);
        if (block.timestamp <= mkt.settledAt + disputePeriod) revert DisputePeriodNotOver();

        _resolve(marketId, mkt.proposedOutcome);
    }

    // ─── Settlement: Arbitration Resolution ──────────────────────────────────

    /// @notice Resolve market based on arbitration result
    function resolveFromArbitration(uint256 marketId) external {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Arbitration) revert NotInPhase(MarketStatus.Arbitration);
        if (address(arbitration) == address(0)) revert ArbitrationNotConfigured();

        (bool resolved, uint8 outcome) = arbitration.getResult(mkt.arbitrationId);
        require(resolved, "arbitration not resolved");
        if (outcome != YES && outcome != NO && outcome != INVALID) revert InvalidOutcome();

        _resolve(marketId, outcome);
    }

    /// @dev Internal resolve
    function _resolve(uint256 marketId, uint8 outcome) internal {
        if (outcome != YES && outcome != NO && outcome != INVALID) revert InvalidOutcome();
        Market storage mkt = markets[marketId];

        // Calculate total liability (amount reserved for winner payouts).
        // ── INVALID refund design note ──
        // When outcome = INVALID, every share (YES or NO) is refunded at a flat
        // 0.5 stablecoin.  This is a deliberate *approximation*, NOT exact cost
        // recovery.  In LMSR, the actual purchase price of a share varies with
        // the state of the pool at the time of purchase (price range 0–1), so
        // the true average cost per share differs per user.  Tracking per-user
        // cost basis on-chain would be prohibitively expensive, so we use the
        // midpoint (0.5) as a fair, gas-efficient compromise.  Consequence:
        //   • Users who bought at price > 0.5 receive less than they paid.
        //   • Users who bought at price < 0.5 receive more than they paid.
        // This is considered acceptable because INVALID outcomes are rare, and
        // the total refund amount is guaranteed to be ≤ subsidyPool (checked
        // below via InsufficientPoolLiquidity).
        uint256 liability;
        if (outcome == INVALID) {
            liability = _wadToTokenDown(uint256(mkt.qYes + mkt.qNo) / 2);
        } else if (outcome == YES) {
            liability = _wadToTokenDown(uint256(mkt.qYes));
        } else {
            liability = _wadToTokenDown(uint256(mkt.qNo));
        }
        if (mkt.subsidyPool < liability) revert InsufficientPoolLiquidity();

        mkt.resolvedOutcome = outcome;
        mkt.pendingWinnings = liability;
        mkt.status = MarketStatus.Resolved;
        emit MarketResolved(marketId, outcome);
    }

    // ─── Claims ──────────────────────────────────────────────────────────────

    /// @notice Claim winnings after market resolution
    function claimWinnings(uint256 marketId) external nonReentrant {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Resolved) revert NotInPhase(MarketStatus.Resolved);

        uint8 winner = mkt.resolvedOutcome;
        int256 shares;

        if (winner == INVALID) {
            // ── INVALID refund: 0.5 per share (see design note in _resolve) ──
            // Both YES and NO holders are refunded.  Each share is valued at
            // 0.5 stablecoin regardless of its original purchase price.
            int256 yesShares = positions[marketId][msg.sender][YES];
            int256 noShares  = positions[marketId][msg.sender][NO];
            if (yesShares <= 0 && noShares <= 0) revert NothingToClaim();

            int256 totalShares = yesShares + noShares;
            shares = totalShares;
            uint256 payout = _wadToTokenDown(uint256(totalShares) / 2);

            positions[marketId][msg.sender][YES] = 0;
            positions[marketId][msg.sender][NO]  = 0;

            if (payout > 0) {
                if (mkt.pendingWinnings < payout) revert InsufficientPoolLiquidity();
                if (mkt.subsidyPool < payout) revert InsufficientPoolLiquidity();
                mkt.pendingWinnings -= payout;
                mkt.subsidyPool -= payout;
                stablecoin.safeTransfer(msg.sender, payout);
                emit WinningsClaimed(marketId, msg.sender, payout);
            }
        } else {
            // Winning shares pay out 1:1 (each share = 1 stablecoin unit)
            shares = positions[marketId][msg.sender][winner];
            if (shares <= 0) revert NothingToClaim();

            positions[marketId][msg.sender][winner] = 0;
            uint256 payout = _wadToTokenDown(uint256(shares));

            if (mkt.pendingWinnings < payout) revert InsufficientPoolLiquidity();
            if (mkt.subsidyPool < payout) revert InsufficientPoolLiquidity();
            mkt.pendingWinnings -= payout;
            mkt.subsidyPool -= payout;
            stablecoin.safeTransfer(msg.sender, payout);
            emit WinningsClaimed(marketId, msg.sender, payout);
        }
    }

    /// @notice Creator claims accumulated fees
    function claimCreatorFee(uint256 marketId) external nonReentrant {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (msg.sender != mkt.creator) revert NotCreator();
        uint256 amount = mkt.creatorFeeAccrued;
        if (amount == 0) revert NothingToClaim();

        mkt.creatorFeeAccrued = 0;
        stablecoin.safeTransfer(msg.sender, amount);
        emit CreatorFeeClaimed(marketId, msg.sender, amount);
    }

    /// @notice Protocol claims accumulated fees
    function claimProtocolFees(uint256 marketId) external nonReentrant {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        uint256 amount = mkt.protocolFeeAccrued;
        if (amount == 0) revert NothingToClaim();

        mkt.protocolFeeAccrued = 0;
        stablecoin.safeTransfer(protocolFeeRecipient, amount);
    }

    /// @notice LP claims share of remaining subsidy pool after resolution
    function claimSubsidy(uint256 marketId) external nonReentrant {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Resolved) revert NotInPhase(MarketStatus.Resolved);

        uint256 shares_ = subsidyShares[marketId][msg.sender];
        if (shares_ == 0) revert NothingToClaim();

        // LP gets proportional share of whatever is left in subsidy pool
        // The pool may have grown (from trading fees) or shrunk (from market making losses)
        uint256 totalShares_ = totalSubsidyShares[marketId];
        uint256 poolRemaining = mkt.subsidyPool; // simplified: actual remaining computed from contract balance
        uint256 distributable = poolRemaining > mkt.pendingWinnings ? poolRemaining - mkt.pendingWinnings : 0;
        uint256 payout = distributable * shares_ / totalShares_;
        subsidyShares[marketId][msg.sender] = 0;
        totalSubsidyShares[marketId] = totalShares_ - shares_;

        if (payout > 0) {
            mkt.subsidyPool -= payout;
            stablecoin.safeTransfer(msg.sender, payout);
            emit SubsidyClaimed(marketId, msg.sender, payout);
        }
    }

    /// @notice Sweep residual subsidy pool dust once all winner/LP claims are fully cleared.
    function sweepMarketDust(uint256 marketId) external nonReentrant {
        Market storage mkt = markets[marketId];
        if (mkt.creator == address(0)) revert MarketNotFound();
        if (mkt.status != MarketStatus.Resolved) revert NotInPhase(MarketStatus.Resolved);
        if (mkt.pendingWinnings != 0) revert PendingWinningsRemaining();
        if (totalSubsidyShares[marketId] != 0) revert SubsidySharesRemaining();

        uint256 dust = mkt.subsidyPool;
        if (dust == 0) revert NothingToClaim();

        mkt.subsidyPool = 0;
        address recipient = protocolFeeRecipient;
        stablecoin.safeTransfer(recipient, dust);

        emit MarketDustSwept(marketId, recipient, dust);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setArbitration(IQLWYPredictionArbitration arb_) external onlyOwner {
        arbitration = arb_;
    }

    function setMinSubsidy(uint256 val) external onlyOwner {
        minSubsidy = val;
    }

    function setFees(uint16 creatorBps, uint16 protocolBps, uint16 lpBps) external onlyOwner {
        require(creatorBps + protocolBps + lpBps <= 1000, "fees too high"); // max 10%
        creatorFeeBps = creatorBps;
        protocolFeeBps = protocolBps;
        lpFeeBps = lpBps;
    }

    function setProtocolFeeRecipient(address val) external onlyOwner {
        protocolFeeRecipient = val;
    }

    function setTimingParams(uint48 dispute_, uint48 minDur_) external onlyOwner {
        disputePeriod = dispute_;
        minDuration = minDur_;
    }

    function setCreatorSettlementGracePeriod(uint48 val) external onlyOwner {
        creatorSettlementGracePeriod = val;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
