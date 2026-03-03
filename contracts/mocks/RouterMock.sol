// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IQLWYTokenMinter {
    function mint(address to, uint256 amount) external;
}

/// @notice PancakeSwap router mock that mints QLWY at a pre-defined rate for incoming ETH.
contract RouterMock {
    IQLWYTokenMinter public token;
    uint256 public rate; // tokens per wei

    event RateUpdated(uint256 rate);

    constructor(IQLWYTokenMinter token_, uint256 rate_) {
        token = token_;
        rate = rate_;
    }

    function setRate(uint256 rate_) external {
        rate = rate_;
        emit RateUpdated(rate_);
    }

    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256,
        address[] calldata path,
        address to,
        uint256
    ) external payable {
        require(path.length >= 2, "RouterMock: invalid path");
        require(path[path.length - 1] == address(token), "RouterMock: wrong token");
        uint256 mintAmount = msg.value * rate;
        token.mint(to, mintAmount);
    }
}
