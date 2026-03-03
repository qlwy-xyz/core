// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ILearningModule
 * @notice Interface for BAP-578 Learning Module System
 * @dev Provides standardized interfaces for implementing learning algorithms
 * 
 * Learning data is organized in a Merkle tree structure:
 * - On-Chain: Only the Merkle root (32 bytes) is stored
 * - Off-Chain: Full learning tree stored in user-controlled vaults
 * - Verification: All learning claims verified through Merkle proofs
 */
interface ILearningModule {
    /// @notice Metrics tracking agent learning progress
    struct LearningMetrics {
        uint256 totalInteractions;    // Total user interactions
        uint256 learningEvents;       // Significant learning updates
        uint256 lastUpdateTimestamp;  // Last learning update time
        uint256 learningVelocity;     // Learning rate (scaled by 1e18)
        uint256 confidenceScore;      // Overall confidence (scaled by 1e18)
    }

    /// @notice Data structure for learning updates
    struct LearningUpdate {
        bytes32 previousRoot;  // Previous Merkle root
        bytes32 newRoot;       // New Merkle root
        bytes32[] proof;       // Merkle proof for update
        bytes metadata;        // Encoded learning data
    }

    // ============ Events ============

    /// @notice Emitted when learning is updated
    event LearningUpdated(
        uint256 indexed tokenId,
        bytes32 previousRoot,
        bytes32 newRoot,
        uint256 timestamp
    );

    /// @notice Emitted when an interaction is recorded
    event InteractionRecorded(
        uint256 indexed tokenId,
        string interactionType,
        bool success,
        uint256 timestamp
    );

    // ============ Core Learning Functions ============

    /**
     * @notice Update the learning state for an agent
     * @param tokenId The agent token ID
     * @param update The learning update data including Merkle proof
     */
    function updateLearning(uint256 tokenId, LearningUpdate calldata update) external;

    /**
     * @notice Verify a learning claim using Merkle proof
     * @param tokenId The agent token ID
     * @param claim The claim to verify
     * @param proof The Merkle proof
     * @return valid True if the claim is valid
     */
    function verifyLearning(
        uint256 tokenId,
        bytes32 claim,
        bytes32[] calldata proof
    ) external view returns (bool valid);

    /**
     * @notice Get learning metrics for an agent
     * @param tokenId The agent token ID
     * @return metrics The learning metrics
     */
    function getLearningMetrics(uint256 tokenId) external view returns (LearningMetrics memory metrics);

    /**
     * @notice Get the current learning Merkle root for an agent
     * @param tokenId The agent token ID
     * @return root The Merkle root
     */
    function getLearningRoot(uint256 tokenId) external view returns (bytes32 root);

    /**
     * @notice Check if learning is enabled for an agent
     * @param tokenId The agent token ID
     * @return enabled True if learning is enabled
     */
    function isLearningEnabled(uint256 tokenId) external view returns (bool enabled);

    /**
     * @notice Get the module version
     * @return version The version string
     */
    function getVersion() external pure returns (string memory version);

    /**
     * @notice Record an interaction for learning purposes
     * @param tokenId The agent token ID
     * @param interactionType Type of interaction (e.g., "battle", "bet", "chat")
     * @param success Whether the interaction was successful
     */
    function recordInteraction(
        uint256 tokenId,
        string calldata interactionType,
        bool success
    ) external;
}

