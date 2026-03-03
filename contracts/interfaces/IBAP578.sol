// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/**
 * @title IBAP578
 * @notice Core interface for Non-Fungible Agent (NFA) Token Standard
 * @dev Extends ERC-721 to enable autonomous, intelligent digital entities
 * 
 * BAP-578 provides:
 * - Dual-Path Architecture: JSON Light Memory (simple) or Merkle Tree Learning (evolving)
 * - Hybrid Storage Model: On-chain identity/permissions, off-chain memory/behaviors
 * - Agent Lifecycle Management: Active → Paused → Terminated
 * - Upgradeable Logic: logicAddress for behavior customization
 */
interface IBAP578 is IERC721 {
    /// @notice Agent operational status
    enum Status { 
        Active,     // Agent can execute actions and interact normally
        Paused,     // Agent is temporarily suspended but can be resumed
        Terminated  // Agent is permanently disabled
    }

    /// @notice Core agent state stored on-chain
    struct State {
        uint256 balance;              // BNB balance for gas fees
        Status status;                // Current operational status
        address owner;                // Agent owner address
        address logicAddress;         // Logic contract address
        uint256 lastActionTimestamp;  // Last action execution time
    }

    /// @notice Extended metadata for agent personality and assets
    struct AgentMetadata {
        string persona;       // JSON-encoded character traits, style, tone
        string experience;    // Agent's role/purpose summary
        string voiceHash;     // Audio profile reference
        string animationURI;  // Animation/avatar URI
        string vaultURI;      // Extended data storage URI
        bytes32 vaultHash;    // Vault content verification hash
    }

    // ============ Events ============

    /// @notice Emitted when an agent executes an action
    event ActionExecuted(uint256 indexed tokenId, bytes result);

    /// @notice Emitted when agent logic is upgraded
    event LogicUpgraded(uint256 indexed tokenId, address oldLogic, address newLogic);

    /// @notice Emitted when agent is funded
    event AgentFunded(uint256 indexed tokenId, address indexed funder, uint256 amount);

    /// @notice Emitted when agent status changes
    event StatusChanged(uint256 indexed tokenId, Status newStatus);

    /// @notice Emitted when agent metadata is updated
    event MetadataUpdated(uint256 indexed tokenId, string metadataURI);

    // ============ Core Functions ============

    /**
     * @notice Execute an action through the agent's logic contract
     * @param tokenId The agent token ID
     * @param data Encoded action data to pass to logic contract
     */
    function executeAction(uint256 tokenId, bytes calldata data) external;

    /**
     * @notice Set the logic contract address for an agent
     * @param tokenId The agent token ID
     * @param newLogic The new logic contract address
     */
    function setLogicAddress(uint256 tokenId, address newLogic) external;

    /**
     * @notice Fund an agent with BNB for gas fees
     * @param tokenId The agent token ID
     */
    function fundAgent(uint256 tokenId) external payable;

    /**
     * @notice Withdraw funds from an agent
     * @param tokenId The agent token ID
     * @param amount Amount to withdraw
     */
    function withdrawFunds(uint256 tokenId, uint256 amount) external;

    /**
     * @notice Get the current state of an agent
     * @param tokenId The agent token ID
     * @return state The agent's current state
     */
    function getState(uint256 tokenId) external view returns (State memory state);

    /**
     * @notice Get agent metadata
     * @param tokenId The agent token ID
     * @return metadata The agent's metadata
     */
    function getAgentMetadata(uint256 tokenId) external view returns (AgentMetadata memory metadata);

    /**
     * @notice Update agent metadata
     * @param tokenId The agent token ID
     * @param metadata New metadata to set
     */
    function updateAgentMetadata(uint256 tokenId, AgentMetadata calldata metadata) external;

    // ============ Lifecycle Management ============

    /**
     * @notice Pause an agent temporarily
     * @param tokenId The agent token ID
     */
    function pause(uint256 tokenId) external;

    /**
     * @notice Resume a paused agent
     * @param tokenId The agent token ID
     */
    function unpause(uint256 tokenId) external;

    /**
     * @notice Permanently terminate an agent
     * @param tokenId The agent token ID
     */
    function terminate(uint256 tokenId) external;
}

