// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract QLWYStaking is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // -------------------------
    // Constants
    // -------------------------
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    // -------------------------
    // State
    // -------------------------
    IERC20 public immutable qlwyToken;
    address public treasury;

    uint256 public totalStaked;
    uint256 public rewardPerTokenStored;  // scaled by 1e18

    /// @notice Unstake burn ratio (basis points, 10000 = 100%), default 1%
    uint16 public unstakeBurnBps = 100;

    mapping(address => uint256) public stakedBalance;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    // -------------------------
    // Events
    // -------------------------
    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount, uint256 burned);
    event RewardPaid(address indexed user, uint256 reward);
    event RewardAdded(uint256 reward);
    event TreasuryUpdated(address indexed treasury);
    event UnstakeBurnBpsUpdated(uint16 bps);

    // -------------------------
    // Errors
    // -------------------------
    error NotTreasury();
    error NoStakers();
    error ZeroAmount();
    error InsufficientBalance();
    error TransferFailed();
    error InvalidBps();
    
    // -------------------------
    // Constructor
    // -------------------------
    constructor(address owner_, IERC20 qlwyToken_, address treasury_) Ownable(owner_) {
        qlwyToken = qlwyToken_;
        treasury = treasury_;
    }
    
    // -------------------------
    // Modifiers
    // -------------------------
    modifier updateReward(address account) {
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
        _;
    }
    
    modifier onlyTreasury() {
        if (msg.sender != treasury && msg.sender != owner()) revert NotTreasury();
        _;
    }
    
    // -------------------------
    // Views
    // -------------------------
    
    function earned(address account) public view returns (uint256) {
        uint256 staked = stakedBalance[account];
        if (staked == 0) {
            return rewards[account];
        }
        uint256 rewardDelta = rewardPerTokenStored - userRewardPerTokenPaid[account];
        return rewards[account] + (staked * rewardDelta / 1e18);
    }
    
    // -------------------------
    // User Actions
    // -------------------------
    
    function stake(uint256 amount) external nonReentrant whenNotPaused updateReward(msg.sender) {
        if (amount == 0) revert ZeroAmount();

        totalStaked += amount;
        stakedBalance[msg.sender] += amount;

        qlwyToken.safeTransferFrom(msg.sender, address(this), amount);

        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant updateReward(msg.sender) {
        _unstake(msg.sender, amount);
    }

    function _unstake(address account, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        if (stakedBalance[account] < amount) revert InsufficientBalance();

        totalStaked -= amount;
        stakedBalance[account] -= amount;

        // Calculate burn amount
        uint256 burnAmount = (amount * unstakeBurnBps) / BPS_DENOMINATOR;
        uint256 returnAmount = amount - burnAmount;

        // Burn tokens by sending to dead address
        if (burnAmount > 0) {
            qlwyToken.safeTransfer(DEAD_ADDRESS, burnAmount);
        }
        qlwyToken.safeTransfer(account, returnAmount);

        emit Unstaked(account, returnAmount, burnAmount);
    }

    function claimReward() public nonReentrant updateReward(msg.sender) {
        _claimReward(msg.sender);
    }

    function _claimReward(address account) private {
        uint256 reward = rewards[account];
        if (reward > 0) {
            rewards[account] = 0;

            (bool success, ) = account.call{value: reward}("");
            if (!success) revert TransferFailed();

            emit RewardPaid(account, reward);
        }
    }

    function exit() external nonReentrant updateReward(msg.sender) {
        uint256 staked = stakedBalance[msg.sender];
        if (staked > 0) {
            _unstake(msg.sender, staked);
        }
        _claimReward(msg.sender);
    }
    
    function notifyReward() external payable onlyTreasury {
        if (msg.value == 0) revert ZeroAmount();
        if (totalStaked == 0) revert NoStakers();
        
        rewardPerTokenStored += (msg.value * 1e18) / totalStaked;
        
        emit RewardAdded(msg.value);
    }
    
    // -------------------------
    // Admin
    // -------------------------
    
    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setUnstakeBurnBps(uint16 bps) external onlyOwner {
        if (bps > BPS_DENOMINATOR) revert InvalidBps();
        unstakeBurnBps = bps;
        emit UnstakeBurnBpsUpdated(bps);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    
    function emergencyWithdrawBNB(address to, uint256 amount) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
    
    receive() external payable {}
}

