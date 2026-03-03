// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IAgentLogic
 * @notice Interface for agent logic contracts (planner pattern)
 * @dev Logic contracts act as "brains" — they plan what to do but don't execute.
 *      The SpiritAgent (the "body") executes all external calls, ensuring
 *      msg.sender == SpiritAgent at the target contract.
 *
 * This is critical for protocols (e.g. Four.meme) that check msg.sender
 * for BAP-578 NFT ownership to gate access.
 */
interface IAgentLogic {
    /// @notice A single instruction for the Agent to execute
    struct Instruction {
        address target;   // Contract to call
        bytes callData;   // Encoded function call
        uint256 value;    // BNB to forward (0 for most calls)
    }

    /**
     * @notice Plan an action — returns instructions for the Agent to execute
     * @param tokenId The spirit token ID
     * @param owner The spirit owner address
     * @param data Encoded action data (first 4 bytes = action type selector)
     * @return instructions Array of calls for the Agent to relay
     * @return result Encoded result data (for events / off-chain consumption)
     */
    function plan(
        uint256 tokenId,
        address owner,
        bytes calldata data
    ) external returns (Instruction[] memory instructions, bytes memory result);
}

