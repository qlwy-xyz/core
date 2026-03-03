// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IFortuneCore {
    function seedJackpot(uint256 amount) external;
}

/// @title BattleTreasury
/// @notice Receives QLWY token fees from Battle contract and forwards to FortuneCore jackpot
/// @dev This contract acts as an abstraction layer, allowing future changes to fee distribution
contract BattleTreasury is Ownable {
    using SafeERC20 for IERC20;

    // -------------------------
    // State
    // -------------------------
    IERC20 public immutable qlwyToken;
    IFortuneCore public fortuneCore;

    // -------------------------
    // Events
    // -------------------------
    event Deposited(address indexed from, uint256 amount);
    event FortuneCoreUpdated(address indexed newFortuneCore);

    // -------------------------
    // Errors
    // -------------------------
    error ZeroAmount();
    error FortuneCoreNotSet();

    // -------------------------
    // Constructor
    // -------------------------
    constructor(
        address owner_,
        address qlwyToken_,
        address fortuneCore_
    ) Ownable(owner_) {
        qlwyToken = IERC20(qlwyToken_);
        fortuneCore = IFortuneCore(fortuneCore_);
    }

    // -------------------------
    // Main Function
    // -------------------------

    /// @notice Deposit QLWY tokens - currently forwards to FortuneCore jackpot
    /// @param amount Amount of QLWY tokens to deposit
    /// @dev Caller must have approved this contract to spend their QLWY tokens
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (address(fortuneCore) == address(0)) revert FortuneCoreNotSet();

        // Transfer tokens from caller to this contract
        qlwyToken.safeTransferFrom(msg.sender, address(this), amount);

        // Approve and forward to FortuneCore jackpot
        qlwyToken.approve(address(fortuneCore), amount);
        fortuneCore.seedJackpot(amount);

        emit Deposited(msg.sender, amount);
    }

    // -------------------------
    // Admin Functions
    // -------------------------

    /// @notice Update the FortuneCore address
    /// @param newFortuneCore New FortuneCore contract address
    function setFortuneCore(address newFortuneCore) external onlyOwner {
        fortuneCore = IFortuneCore(newFortuneCore);
        emit FortuneCoreUpdated(newFortuneCore);
    }

    /// @notice Emergency withdraw tokens (in case of stuck tokens)
    /// @param token Token address to withdraw
    /// @param to Recipient address
    /// @param amount Amount to withdraw
    function emergencyWithdraw(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}

