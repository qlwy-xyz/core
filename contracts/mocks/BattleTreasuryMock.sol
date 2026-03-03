// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Mock BattleTreasury for testing QLWYBattle
contract BattleTreasuryMock {
    using SafeERC20 for IERC20;

    IERC20 public qlwyToken;
    uint256 public totalDeposited;

    event Deposited(address indexed from, uint256 amount);

    constructor() {}

    function setQLWYToken(address token_) external {
        qlwyToken = IERC20(token_);
    }

    /// @notice Deposit QLWY tokens - just tracks the amount for testing
    function deposit(uint256 amount) external {
        require(address(qlwyToken) != address(0), "Mock: token not set");
        qlwyToken.safeTransferFrom(msg.sender, address(this), amount);
        totalDeposited += amount;
        emit Deposited(msg.sender, amount);
    }
}

