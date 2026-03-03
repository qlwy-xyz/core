// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IBAP578.sol";
import "./interfaces/IAgentLogic.sol";
import "./interfaces/ILearningModule.sol";

/**
 * @title IQLWYFortuneCore
 * @notice Minimal interface for reading QLWYFortuneCore token data
 */
interface IQLWYFortuneCore is IERC721 {
    struct TokenView {
        uint8 rarity;
        uint8 luck;
        uint8[6] lines;
        uint16 id;
    }
    function tokenView(uint256 tokenId) external view returns (TokenView memory);
    function tokenRarityOf(uint256 tokenId) external view returns (uint8);
}

/**
 * @title QLWYSpiritAgent
 * @notice BAP-578 compliant Spirit Agent wrapper for QLWYFortuneCore NFTs
 * @dev Users can upgrade their NFTs to Spirit Agents without modifying the original contract
 * 
 * Key features:
 * - Wrap/Unwrap: Users deposit NFT to become Spirit Agent, can unwrap anytime
 * - Agent State: Each spirit has status, balance, and metadata
 * - Logic Delegation: Customizable behavior through logic contracts
 * - Learning Ready: Optional learning module support
 */
contract QLWYSpiritAgent is IBAP578, ERC721Holder, ReentrancyGuard, Ownable, Pausable {
    using SafeERC20 for IERC20;

    // ============ Constants ============

    uint256 public constant MAX_GAS_FOR_DELEGATECALL = 3_000_000;
    address public constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint8 public constant MAX_LEVEL = 99;

    // ============ State ============

    /// @notice The original NFT contract
    IQLWYFortuneCore public immutable fortuneCore;

    /// @notice QLWY token for level-up fee burning
    IERC20 public immutable qlwyToken;

    /// @notice Default logic contract for all spirits
    address public defaultLogicAddress;

    /// @notice Learning module contract (optional)
    address public learningModule;

    /// @notice Authorized address to grant experience (BattleV2)
    address public battleV2Address;

    /// @notice Base fee for leveling up (in QLWY wei)
    uint256 public baseLevelUpFee = 50 ether;

    /// @notice Agent states by tokenId
    mapping(uint256 => State) private _states;

    /// @notice Agent metadata by tokenId
    mapping(uint256 => AgentMetadata) private _metadata;

    /// @notice Original owners before wrapping
    mapping(uint256 => address) public originalOwners;

    /// @notice Check if a token is wrapped as Spirit
    mapping(uint256 => bool) public isWrapped;

    /// @notice Learning enabled per token
    mapping(uint256 => bool) public learningEnabled;

    /// @notice Learning roots per token (for Merkle verification)
    mapping(uint256 => bytes32) public learningRoots;

    /// @notice Authorized operators for spirits: owner => operator => authorized
    mapping(address => mapping(address => bool)) public authorizedOperators;

    /// @notice Spirit level by tokenId (0 = default for new spirits)
    mapping(uint256 => uint8) public spiritLevel;

    /// @notice Spirit experience by tokenId
    mapping(uint256 => uint256) public spiritExperience;

    /// @notice Whitelisted targets that SpiritAgent can relay-call
    mapping(address => bool) public whitelistedTargets;

    /// @notice Spirit balance per owner (for ERC721 balanceOf compliance)
    mapping(address => uint256) private _spiritBalances;

    // ============ Events ============

    event SpiritCreated(uint256 indexed tokenId, address indexed owner);
    event SpiritUnwrapped(uint256 indexed tokenId, address indexed owner);
    event LearningModuleSet(address indexed module);
    event LearningEnabledForSpirit(uint256 indexed tokenId, bytes32 initialRoot);
    event OperatorAuthorized(address indexed owner, address indexed operator, bool authorized);
    event LevelUp(uint256 indexed tokenId, uint8 newLevel, uint256 currentExp);
    event ExperienceGained(uint256 indexed tokenId, uint256 amount, uint256 totalExp);
    event WhitelistedTargetSet(address indexed target, bool allowed);
    event TokenWithdrawn(uint256 indexed tokenId, address indexed token, address indexed to, uint256 amount);

    // ============ Errors ============

    error NotOwner();
    error NotAuthorized();
    error NotWrapped();
    error AlreadyWrapped();
    error AgentPaused();
    error AgentTerminated();
    error InvalidLogicAddress();
    error TransferFailed();
    error InsufficientBalance();
    error NoLogicContract();
    error TargetNotWhitelisted();
    error RelayCallFailed(uint256 index);
    error SelfCallNotAllowed();
    error MaxLevelReached();
    error InsufficientExperience();
    error OnlyBattleV2();

    // ============ Constructor ============

    constructor(
        address _fortuneCore,
        address _defaultLogic,
        address _qlwyToken
    ) Ownable(msg.sender) {
        fortuneCore = IQLWYFortuneCore(_fortuneCore);
        defaultLogicAddress = _defaultLogic;
        qlwyToken = IERC20(_qlwyToken);
    }

    // ============ Modifiers ============

    modifier onlyWrapped(uint256 tokenId) {
        if (!isWrapped[tokenId]) revert NotWrapped();
        _;
    }

    modifier onlySpiritOwner(uint256 tokenId) {
        if (originalOwners[tokenId] != msg.sender) revert NotOwner();
        _;
    }

    /// @notice Check if caller is owner or authorized operator
    modifier onlySpiritOwnerOrOperator(uint256 tokenId) {
        address spiritOwner = originalOwners[tokenId];
        if (msg.sender != spiritOwner && !authorizedOperators[spiritOwner][msg.sender]) {
            revert NotAuthorized();
        }
        _;
    }

    modifier whenAgentActive(uint256 tokenId) {
        Status status = _states[tokenId].status;
        if (status == Status.Paused) revert AgentPaused();
        if (status == Status.Terminated) revert AgentTerminated();
        _;
    }

    // ============ Operator Authorization ============

    /**
     * @notice Authorize an operator to execute actions on behalf of all your spirits
     * @param operator The operator address to authorize
     * @param authorized Whether to authorize or revoke
     */
    function authorizeOperator(address operator, bool authorized) external {
        authorizedOperators[msg.sender][operator] = authorized;
        emit OperatorAuthorized(msg.sender, operator, authorized);
    }

    /**
     * @notice Check if an operator is authorized for an owner
     * @param spiritOwner The spirit owner
     * @param operator The operator to check
     */
    function isOperatorAuthorized(address spiritOwner, address operator) external view returns (bool) {
        return authorizedOperators[spiritOwner][operator];
    }

    // ============ NFT Approval Management ============

    /**
     * @notice Approve an operator to transfer NFTs held by this contract (on FortuneCore)
     * @dev Used to allow BattleV2 to pull wrapped spirit NFTs for battles.
     *      Only callable by contract owner (admin).
     * @param operator The address to approve (e.g., BattleV2 contract)
     * @param approved Whether to approve or revoke
     */
    function approveFortuneCoreForAll(address operator, bool approved) external onlyOwner {
        fortuneCore.setApprovalForAll(operator, approved);
    }

    // ============ Core: Wrap/Unwrap ============

    /**
     * @notice Upgrade an NFT to a Spirit Agent
     * @param tokenId The NFT token ID to wrap
     */
    function upgradeToSpirit(uint256 tokenId) external nonReentrant whenNotPaused {
        if (isWrapped[tokenId]) revert AlreadyWrapped();
        
        // Transfer NFT to this contract
        fortuneCore.transferFrom(msg.sender, address(this), tokenId);
        
        // Initialize agent state
        _states[tokenId] = State({
            balance: 0,
            status: Status.Active,
            owner: msg.sender,
            logicAddress: defaultLogicAddress,
            lastActionTimestamp: block.timestamp
        });
        
        // Initialize default metadata from NFT attributes
        IQLWYFortuneCore.TokenView memory nftView = fortuneCore.tokenView(tokenId);
        _metadata[tokenId] = AgentMetadata({
            persona: _generateDefaultPersona(nftView),
            experience: "",
            voiceHash: "",
            animationURI: "",
            vaultURI: "",
            vaultHash: bytes32(0)
        });
        
        originalOwners[tokenId] = msg.sender;
        isWrapped[tokenId] = true;
        _spiritBalances[msg.sender]++;

        emit SpiritCreated(tokenId, msg.sender);
    }

    /**
     * @notice Unwrap a Spirit Agent back to regular NFT
     * @param tokenId The Spirit token ID to unwrap
     */
    function unwrapSpirit(uint256 tokenId)
        external
        nonReentrant
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        State storage state = _states[tokenId];
        if (state.status == Status.Terminated) revert AgentTerminated();

        // Return any remaining balance to owner
        if (state.balance > 0) {
            uint256 balance = state.balance;
            state.balance = 0;
            (bool success, ) = msg.sender.call{value: balance}("");
            if (!success) revert TransferFailed();
        }

        // Transfer NFT back to owner
        fortuneCore.transferFrom(address(this), msg.sender, tokenId);

        // Clear state
        _spiritBalances[msg.sender]--;
        delete _states[tokenId];
        delete _metadata[tokenId];
        delete originalOwners[tokenId];
        delete learningEnabled[tokenId];
        delete learningRoots[tokenId];
        delete spiritLevel[tokenId];
        delete spiritExperience[tokenId];
        isWrapped[tokenId] = false;

        emit SpiritUnwrapped(tokenId, msg.sender);
    }

    // ============ IBAP578 Implementation ============

    /// @inheritdoc IBAP578
    /// @dev Logic.plan() returns instructions; SpiritAgent executes them as msg.sender.
    ///      This ensures SpiritAgent is the msg.sender at every target contract,
    ///      which is required by protocols that check BAP-578 NFT ownership on msg.sender.
    function executeAction(uint256 tokenId, bytes calldata data)
        external
        override
        nonReentrant
        onlyWrapped(tokenId)
        onlySpiritOwnerOrOperator(tokenId)
        whenAgentActive(tokenId)
        whenNotPaused
    {
        State storage state = _states[tokenId];
        address logic = state.logicAddress;
        if (logic == address(0)) logic = defaultLogicAddress;
        if (logic == address(0)) revert NoLogicContract();

        state.lastActionTimestamp = block.timestamp;

        address spiritOwner = originalOwners[tokenId];

        // Phase 1: Logic plans the action — returns instructions + result metadata
        (IAgentLogic.Instruction[] memory instructions, bytes memory result) =
            IAgentLogic(logic).plan(tokenId, spiritOwner, data);

        // Phase 2: SpiritAgent relays each instruction (msg.sender = this contract)
        for (uint256 i = 0; i < instructions.length; i++) {
            address target = instructions[i].target;
            if (target == address(this)) revert SelfCallNotAllowed();
            if (!whitelistedTargets[target]) revert TargetNotWhitelisted();

            (bool ok, ) = target.call{value: instructions[i].value}(
                instructions[i].callData
            );
            if (!ok) revert RelayCallFailed(i);
        }

        // Record interaction for learning
        if (learningEnabled[tokenId] && learningModule != address(0)) {
            try ILearningModule(learningModule).recordInteraction(tokenId, "action", true) {} catch {}
        }

        emit ActionExecuted(tokenId, result);
    }

    /// @inheritdoc IBAP578
    function setLogicAddress(uint256 tokenId, address newLogic)
        external
        override
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        if (newLogic == address(0)) revert InvalidLogicAddress();

        address oldLogic = _states[tokenId].logicAddress;
        _states[tokenId].logicAddress = newLogic;

        emit LogicUpgraded(tokenId, oldLogic, newLogic);
    }

    /// @inheritdoc IBAP578
    function fundAgent(uint256 tokenId)
        external
        payable
        override
        onlyWrapped(tokenId)
    {
        _states[tokenId].balance += msg.value;
        emit AgentFunded(tokenId, msg.sender, msg.value);
    }

    /// @inheritdoc IBAP578
    function withdrawFunds(uint256 tokenId, uint256 amount)
        external
        override
        nonReentrant
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        State storage state = _states[tokenId];
        if (state.balance < amount) revert InsufficientBalance();

        state.balance -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Withdraw ERC20 tokens held by this contract on behalf of a spirit
     * @dev Used to extract tokens received from relay calls (e.g. meme tokens from swaps)
     * @param tokenId The Spirit token ID (for authorization)
     * @param token The ERC20 token address to withdraw
     * @param amount Amount to withdraw
     */
    function withdrawToken(uint256 tokenId, address token, uint256 amount)
        external
        nonReentrant
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        address owner = originalOwners[tokenId];
        IERC20(token).safeTransfer(owner, amount);
        emit TokenWithdrawn(tokenId, token, owner, amount);
    }

    /// @inheritdoc IBAP578
    function getState(uint256 tokenId)
        external
        view
        override
        onlyWrapped(tokenId)
        returns (State memory)
    {
        return _states[tokenId];
    }

    /// @inheritdoc IBAP578
    function getAgentMetadata(uint256 tokenId)
        external
        view
        override
        onlyWrapped(tokenId)
        returns (AgentMetadata memory)
    {
        return _metadata[tokenId];
    }

    /// @inheritdoc IBAP578
    function updateAgentMetadata(uint256 tokenId, AgentMetadata calldata metadata)
        external
        override
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        _metadata[tokenId] = metadata;
        emit MetadataUpdated(tokenId, metadata.vaultURI);
    }

    /// @inheritdoc IBAP578
    function pause(uint256 tokenId)
        external
        override
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        Status current = _states[tokenId].status;
        if (current == Status.Terminated) revert AgentTerminated();

        _states[tokenId].status = Status.Paused;
        emit StatusChanged(tokenId, Status.Paused);
    }

    /// @inheritdoc IBAP578
    function unpause(uint256 tokenId)
        external
        override
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        Status current = _states[tokenId].status;
        if (current == Status.Terminated) revert AgentTerminated();

        _states[tokenId].status = Status.Active;
        emit StatusChanged(tokenId, Status.Active);
    }

    /// @inheritdoc IBAP578
    function terminate(uint256 tokenId)
        external
        override
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        State storage state = _states[tokenId];

        // Return balance before terminating
        if (state.balance > 0) {
            uint256 balance = state.balance;
            state.balance = 0;
            (bool success, ) = msg.sender.call{value: balance}("");
            if (!success) revert TransferFailed();
        }

        state.status = Status.Terminated;
        emit StatusChanged(tokenId, Status.Terminated);
    }

    // ============ Learning Functions ============

    /**
     * @notice Enable learning for a Spirit Agent
     * @param tokenId The Spirit token ID
     * @param initialRoot Initial Merkle root for learning data
     */
    function enableLearning(uint256 tokenId, bytes32 initialRoot)
        external
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        require(learningModule != address(0), "Learning module not set");
        learningEnabled[tokenId] = true;
        learningRoots[tokenId] = initialRoot;

        emit LearningEnabledForSpirit(tokenId, initialRoot);
    }

    /**
     * @notice Update learning root for a Spirit
     * @param tokenId The Spirit token ID
     * @param newRoot New Merkle root
     */
    function updateLearningRoot(uint256 tokenId, bytes32 newRoot)
        external
        onlyWrapped(tokenId)
    {
        require(msg.sender == learningModule, "Only learning module");
        learningRoots[tokenId] = newRoot;
    }

    // ============ Level System ============

    /**
     * @notice Get required experience for a given level
     * @dev Formula: level^2 * 10 + level * 90
     * @param level The target level
     * @return Required cumulative experience
     */
    function requiredExpForLevel(uint8 level) public pure returns (uint256) {
        uint256 l = uint256(level);
        return l * l * 10 + l * 90;
    }

    /**
     * @notice Get QLWY fee to level up to the next level
     * @dev Formula: baseLevelUpFee * nextLevel
     * @param tokenId The Spirit token ID
     * @return Fee in QLWY wei
     */
    function levelUpFee(uint256 tokenId) public view returns (uint256) {
        uint8 nextLevel = spiritLevel[tokenId] + 1;
        return baseLevelUpFee * uint256(nextLevel);
    }

    /**
     * @notice Level up a spirit by consuming experience and burning QLWY
     * @param tokenId The Spirit token ID
     */
    function levelUp(uint256 tokenId)
        external
        nonReentrant
        onlyWrapped(tokenId)
        onlySpiritOwner(tokenId)
    {
        uint8 currentLevel = spiritLevel[tokenId];
        if (currentLevel >= MAX_LEVEL) revert MaxLevelReached();

        uint8 nextLevel = currentLevel + 1;

        // Check experience requirement
        uint256 reqExp = requiredExpForLevel(nextLevel);
        if (spiritExperience[tokenId] < reqExp) revert InsufficientExperience();

        // Burn QLWY tokens (transfer to dead address)
        uint256 fee = baseLevelUpFee * uint256(nextLevel);
        qlwyToken.safeTransferFrom(msg.sender, DEAD_ADDRESS, fee);

        spiritLevel[tokenId] = nextLevel;
        emit LevelUp(tokenId, nextLevel, spiritExperience[tokenId]);
    }

    /**
     * @notice Grant experience to a spirit (only callable by BattleV2)
     * @param tokenId The Spirit token ID
     * @param amount Experience amount to add
     */
    function addExperience(uint256 tokenId, uint256 amount) external {
        if (msg.sender != battleV2Address) revert OnlyBattleV2();
        if (!isWrapped[tokenId]) return; // silently skip non-spirits
        spiritExperience[tokenId] += amount;
        emit ExperienceGained(tokenId, amount, spiritExperience[tokenId]);
    }

    /**
     * @notice Get the luck bonus from spirit level
     * @dev Formula: level / 2
     * @param tokenId The Spirit token ID
     * @return Luck bonus (0 if not a spirit)
     */
    function getLevelLuckBonus(uint256 tokenId) external view returns (uint8) {
        if (!isWrapped[tokenId]) return 0;
        return spiritLevel[tokenId] / 2;
    }

    // ============ Admin Functions ============

    /**
     * @notice Set the BattleV2 contract address (authorized to grant experience)
     * @param _battleV2 BattleV2 contract address
     */
    function setBattleV2Address(address _battleV2) external onlyOwner {
        battleV2Address = _battleV2;
    }

    /**
     * @notice Set the base fee for leveling up
     * @param _baseFee New base fee in QLWY wei
     */
    function setBaseLevelUpFee(uint256 _baseFee) external onlyOwner {
        baseLevelUpFee = _baseFee;
    }

    /**
     * @notice Set the default logic contract
     * @param _logic New default logic address
     */
    function setDefaultLogic(address _logic) external onlyOwner {
        defaultLogicAddress = _logic;
    }

    /**
     * @notice Set the learning module contract
     * @param _module Learning module address
     */
    function setLearningModule(address _module) external onlyOwner {
        learningModule = _module;
        emit LearningModuleSet(_module);
    }

    /**
     * @notice Whitelist or revoke a target contract for relay calls
     * @param target The contract address
     * @param allowed Whether to allow or revoke
     */
    function setWhitelistedTarget(address target, bool allowed) external onlyOwner {
        whitelistedTargets[target] = allowed;
        emit WhitelistedTargetSet(target, allowed);
    }

    /**
     * @notice Pause all operations
     */
    function pauseContract() external onlyOwner {
        _pause();
    }

    /**
     * @notice Unpause all operations
     */
    function unpauseContract() external onlyOwner {
        _unpause();
    }

    // ============ View Functions ============

    /**
     * @notice Get the original NFT data for a wrapped Spirit
     * @param tokenId The Spirit token ID
     */
    function getOriginalNFTData(uint256 tokenId)
        external
        view
        onlyWrapped(tokenId)
        returns (IQLWYFortuneCore.TokenView memory)
    {
        return fortuneCore.tokenView(tokenId);
    }

    /**
     * @notice Get all wrapped spirits for an owner
     * @param owner The owner address
     * @param tokenIds Array of token IDs to check
     * @return wrappedTokens Array of wrapped token IDs owned by this address
     */
    function getWrappedSpirits(address owner, uint256[] calldata tokenIds)
        external
        view
        returns (uint256[] memory wrappedTokens)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (isWrapped[tokenIds[i]] && originalOwners[tokenIds[i]] == owner) {
                count++;
            }
        }

        wrappedTokens = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (isWrapped[tokenIds[i]] && originalOwners[tokenIds[i]] == owner) {
                wrappedTokens[index++] = tokenIds[i];
            }
        }
    }

    // ============ ERC721 Interface (Non-transferable) ============

    // Spirit Agents are non-transferable - they're wrappers tied to ownership
    // To transfer, user must unwrap first, then transfer the original NFT

    function supportsInterface(bytes4 interfaceId)
        public
        pure
        override
        returns (bool)
    {
        return
            interfaceId == type(IERC721).interfaceId ||
            interfaceId == type(IBAP578).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    function balanceOf(address owner) external view override returns (uint256) {
        return _spiritBalances[owner];
    }

    function ownerOf(uint256 tokenId) external view override returns (address) {
        if (!isWrapped[tokenId]) revert NotWrapped();
        return originalOwners[tokenId];
    }

    function safeTransferFrom(address, address, uint256, bytes memory) external pure override {
        revert("Spirits are non-transferable. Unwrap first.");
    }

    function safeTransferFrom(address, address, uint256) external pure override {
        revert("Spirits are non-transferable. Unwrap first.");
    }

    function transferFrom(address, address, uint256) external pure override {
        revert("Spirits are non-transferable. Unwrap first.");
    }

    function approve(address, uint256) external pure override {
        revert("Spirits are non-transferable");
    }

    function setApprovalForAll(address, bool) external pure override {
        revert("Spirits are non-transferable");
    }

    function getApproved(uint256) external pure override returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure override returns (bool) {
        return false;
    }

    // ============ Internal Functions ============

    /**
     * @notice Generate default persona from NFT attributes
     */
    function _generateDefaultPersona(IQLWYFortuneCore.TokenView memory nftView)
        internal
        pure
        returns (string memory)
    {
        // Return basic JSON persona based on rarity
        if (nftView.rarity >= 4) {
            return '{"personality":"legendary","trait":"wise"}';
        } else if (nftView.rarity >= 3) {
            return '{"personality":"epic","trait":"strategic"}';
        } else if (nftView.rarity >= 2) {
            return '{"personality":"rare","trait":"confident"}';
        } else if (nftView.rarity >= 1) {
            return '{"personality":"uncommon","trait":"curious"}';
        } else {
            return '{"personality":"common","trait":"eager"}';
        }
    }

    /**
     * @notice Receive BNB for agent funding
     */
    receive() external payable {}
}