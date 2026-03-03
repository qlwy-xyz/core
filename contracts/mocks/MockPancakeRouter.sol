// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MockPancakeRouter
/// @notice Mock router for testing buyback functionality
contract MockPancakeRouter {
    // Simulated exchange rate: 1 BNB = 1000 QLWY
    uint256 public constant EXCHANGE_RATE = 1000;
    
    bool public shouldFail;
    
    function setShouldFail(bool _shouldFail) external {
        shouldFail = _shouldFail;
    }
    
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable {
        require(!shouldFail, "MockRouter: swap failed");
        require(path.length == 2, "MockRouter: invalid path");
        require(deadline >= block.timestamp, "MockRouter: expired");
        
        // Calculate output amount (1 BNB = 1000 tokens)
        uint256 amountOut = msg.value * EXCHANGE_RATE;
        require(amountOut >= amountOutMin, "MockRouter: insufficient output");
        
        // Transfer tokens to recipient
        IERC20 token = IERC20(path[1]);
        require(token.transfer(to, amountOut), "MockRouter: transfer failed");
    }
    
    // Allow receiving ETH
    receive() external payable {}
}

