// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IQLWYStaking {
    function notifyReward() external payable;
    function totalStaked() external view returns (uint256);
}

interface IPancakeRouterV2 {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

/// @title QLWYTreasury
/// @notice Receives fees from Core contract, splits between buyback/burn, staking rewards, and ops
contract QLWYTreasury is Ownable, ReentrancyGuard {

    // -------------------------
    // Constants
    // -------------------------
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    // -------------------------
    // Config
    // -------------------------
    IQLWYStaking public staking;
    IPancakeRouterV2 public router;
    IERC20 public qlwyToken;
    address public wbnb;

    /// @notice Buyback/burn ratio (basis points, 10000 = 100%)
    uint16 public buybackBps = 3000; // 30% default

    /// @notice Staking ratio of remaining after buyback (basis points)
    uint16 public stakingBps = 7000; // 70% of remaining

    /// @notice Ops balance available for withdrawal
    uint256 public opsBalance;

    /// @notice Pending balance to transfer to Staking
    uint256 public pendingStakingBalance;

    /// @notice Pending balance for buyback
    uint256 public pendingBuybackBalance;

    /// @notice Minimum threshold for staking transfer (avoid small transfers wasting gas)
    uint256 public minStakingThreshold = 0.01 ether;

    /// @notice Minimum threshold for buyback execution
    uint256 public minBuybackThreshold = 0.01 ether;

    // -------------------------
    // Events
    // -------------------------
    event StakingUpdated(address indexed staking);
    event RouterUpdated(address indexed router, address indexed wbnb);
    event QLWYTokenUpdated(address indexed token);
    event BuybackBpsUpdated(uint16 bps);
    event StakingBpsUpdated(uint16 bps);
    event StakingThresholdUpdated(uint256 threshold);
    event BuybackThresholdUpdated(uint256 threshold);
    event FundsReceived(uint256 amount, uint256 toBuyback, uint256 toStaking, uint256 toOps);
    event StakingFunded(uint256 amount);
    event BuybackExecuted(uint256 bnbAmount, uint256 qlwyBurned);
    event OpsWithdrawn(address indexed to, uint256 amount);

    // -------------------------
    // Errors
    // -------------------------
    error InvalidBps();
    error TotalBpsExceeded();
    error InsufficientOpsBalance();
    error NoPendingStaking();
    error NoPendingBuyback();
    error TransferFailed();
    error NoOpsBalance();
    error RouterNotConfigured();
    
    // -------------------------
    // Constructor
    // -------------------------
    constructor(address owner_) Ownable(owner_) {}

    // -------------------------
    // Receive BNB
    // -------------------------

    /// @notice Receive BNB and allocate
    receive() external payable {
        _allocate(msg.value);
    }

    /// @notice Allocate received funds
    function _allocate(uint256 amount) private {
        if (amount == 0) return;

        // First split: buyback portion
        uint256 toBuyback = (amount * buybackBps) / BPS_DENOMINATOR;
        uint256 remaining = amount - toBuyback;

        // Second split: staking vs ops from remaining
        uint256 toStaking = (remaining * stakingBps) / BPS_DENOMINATOR;
        uint256 toOps = remaining - toStaking;

        pendingBuybackBalance += toBuyback;
        pendingStakingBalance += toStaking;
        opsBalance += toOps;

        emit FundsReceived(amount, toBuyback, toStaking, toOps);

        // Try auto-execute buyback and fund staking
        _tryExecuteBuyback();
        _tryFundStaking();
    }

    // -------------------------
    // Buyback & Burn
    // -------------------------

    /// @notice Try to execute buyback and burn
    function _tryExecuteBuyback() private {
        if (pendingBuybackBalance < minBuybackThreshold) return;
        if (address(router) == address(0) || wbnb == address(0)) return;
        if (address(qlwyToken) == address(0)) return;

        uint256 amount = pendingBuybackBalance;
        pendingBuybackBalance = 0;

        uint256 burned = _swapAndBurn(amount);
        if (burned == 0) {
            // Swap failed, restore pending
            pendingBuybackBalance = amount;
        }
    }

    /// @notice Swap BNB for QLWY and send to dead address
    function _swapAndBurn(uint256 amount) private returns (uint256 burned) {
        uint256 beforeBalance = qlwyToken.balanceOf(DEAD_ADDRESS);

        address[] memory path = new address[](2);
        path[0] = wbnb;
        path[1] = address(qlwyToken);

        try router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: amount}(
            0,
            path,
            DEAD_ADDRESS,
            block.timestamp
        ) {
            burned = qlwyToken.balanceOf(DEAD_ADDRESS) - beforeBalance;
            emit BuybackExecuted(amount, burned);
        } catch {
            burned = 0;
        }
    }

    /// @notice Manual trigger for buyback
    function executeBuyback() external nonReentrant {
        if (pendingBuybackBalance == 0) revert NoPendingBuyback();
        _tryExecuteBuyback();
    }

    /// @notice Force buyback even below threshold (owner only)
    function forceBuyback() external onlyOwner nonReentrant {
        if (pendingBuybackBalance == 0) revert NoPendingBuyback();
        if (address(router) == address(0) || wbnb == address(0)) revert RouterNotConfigured();

        uint256 amount = pendingBuybackBalance;
        pendingBuybackBalance = 0;

        uint256 burned = _swapAndBurn(amount);
        if (burned == 0) {
            pendingBuybackBalance = amount;
            revert TransferFailed();
        }
    }

    // -------------------------
    // Staking Funding
    // -------------------------

    /// @notice Try to fund staking contract
    function _tryFundStaking() private {
        if (pendingStakingBalance < minStakingThreshold) return;
        if (address(staking) == address(0)) return;

        // Check if there are stakers
        try staking.totalStaked() returns (uint256 staked) {
            if (staked == 0) return;
        } catch {
            return;
        }

        uint256 amount = pendingStakingBalance;
        pendingStakingBalance = 0;

        try staking.notifyReward{value: amount}() {
            emit StakingFunded(amount);
        } catch {
            // Failed, restore pending
            pendingStakingBalance = amount;
        }
    }

    /// @notice Manual trigger for staking funding
    function fundStaking() external nonReentrant {
        if (pendingStakingBalance == 0) revert NoPendingStaking();
        _tryFundStaking();
    }

    // -------------------------
    // Admin - Config
    // -------------------------

    function setRouter(address router_, address wbnb_) external onlyOwner {
        router = IPancakeRouterV2(router_);
        wbnb = wbnb_;
        emit RouterUpdated(router_, wbnb_);
    }

    function setQLWYToken(address token_) external onlyOwner {
        qlwyToken = IERC20(token_);
        emit QLWYTokenUpdated(token_);
    }

    function setStaking(IQLWYStaking staking_) external onlyOwner {
        staking = staking_;
        emit StakingUpdated(address(staking_));
    }

    function setBuybackBps(uint16 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert InvalidBps();
        buybackBps = bps;
        emit BuybackBpsUpdated(bps);
    }

    function setStakingBps(uint16 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert InvalidBps();
        stakingBps = bps;
        emit StakingBpsUpdated(bps);
    }

    function setMinStakingThreshold(uint256 threshold) external onlyOwner {
        minStakingThreshold = threshold;
        emit StakingThresholdUpdated(threshold);
    }

    function setMinBuybackThreshold(uint256 threshold) external onlyOwner {
        minBuybackThreshold = threshold;
        emit BuybackThresholdUpdated(threshold);
    }

    // -------------------------
    // Admin - Ops Withdrawal
    // -------------------------

    /// @notice Withdraw ops funds
    function withdrawOps(address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > opsBalance) revert InsufficientOpsBalance();
        opsBalance -= amount;

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit OpsWithdrawn(to, amount);
    }

    /// @notice Withdraw all ops funds
    function withdrawAllOps(address to) external onlyOwner nonReentrant {
        uint256 amount = opsBalance;
        if (amount == 0) revert NoOpsBalance();
        opsBalance = 0;

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit OpsWithdrawn(to, amount);
    }
}

