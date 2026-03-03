// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Controllable mock of IQLWYPredictionArbitration for testing QLWYPredictionMarket
contract MockArbitration {
    uint256 public nextId = 1;

    struct ArbData {
        uint256 marketId;
        uint8 outcomeA;
        uint8 outcomeB;
        bool resolved;
        uint8 finalOutcome;
    }

    mapping(uint256 => ArbData) public arbs;

    function requestArbitration(
        uint256 marketId,
        uint8 currentOutcome,
        uint8 disputedOutcome,
        uint256 /* arbitrationFee */
    ) external returns (uint256 arbId) {
        arbId = nextId++;
        arbs[arbId] = ArbData(marketId, currentOutcome, disputedOutcome, false, 0);
    }

    /// @notice Test helper: manually set result
    function setResult(uint256 arbId, uint8 outcome) external {
        arbs[arbId].resolved = true;
        arbs[arbId].finalOutcome = outcome;
    }

    function getResult(uint256 arbId) external view returns (bool resolved, uint8 outcome) {
        ArbData storage a = arbs[arbId];
        return (a.resolved, a.finalOutcome);
    }
}

