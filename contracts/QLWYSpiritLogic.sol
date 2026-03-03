// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IAgentLogic.sol";

/**
 * @title IQLWYBattleV2
 * @notice Interface for BattleV2 contract with agent support
 */
interface IQLWYBattleV2 {
    function authorizedAgents(address owner, address agent) external view returns (bool);
    function createBattleFor(address owner, uint256[] calldata nftIds, uint256 betPerSlot) external returns (uint256);
    function joinChallengerFor(uint256 battleId, address owner, uint256[] calldata nftIds) external;
    function joinDefenderFor(uint256 battleId, address owner, uint256[] calldata nftIds) external;
    function placeBetFor(uint256 battleId, address owner, bool betOnChallenger, uint256 amount) external;
    function claimBetWinningsFor(uint256 battleId, address owner) external;
}

/**
 * @title IQLWYSpiritAgent
 * @notice Interface for Spirit Agent contract
 */
interface IQLWYSpiritAgent {
    function originalOwners(uint256 tokenId) external view returns (address);
    function isWrapped(uint256 tokenId) external view returns (bool);
}

/**
 * @title IQLWYAutoCaster
 * @notice Interface for the AutoCaster intermediary contract
 */
interface IQLWYAutoCaster {
    function castFor(address beneficiary) external payable returns (uint256 castId, uint256 requestId);
    function mintFor(uint256 castId) external returns (uint256 tokenId);
    function getCastFee() external view returns (uint256);
    function getJackpotBalance() external view returns (uint256);
    function isCastReady(uint256 castId) external view returns (bool ready, uint8 rarity);
}

/**
 * @title QLWYSpiritLogic
 * @notice Default logic contract for Spirit Agent autonomous actions (planner pattern)
 * @dev Implements IAgentLogic — returns Instruction[] for SpiritAgent to execute.
 *      Logic acts as "brain" (plans), SpiritAgent acts as "body" (executes).
 *      This ensures msg.sender == SpiritAgent at all target contracts.
 *
 * Supported actions:
 * - AUTO_BATTLE: Create or accept a battle
 * - AUTO_BET: Place a bet on an existing battle
 * - CLAIM_WINNINGS: Claim betting winnings
 * - AUTO_CAST: Request a fortune cast via AutoCaster
 * - AUTO_MINT: Mint NFT from a completed cast
 * - SWAP: Approve + swap tokens via an external router (e.g. Four.meme)
 */
contract QLWYSpiritLogic is IAgentLogic, Ownable {
    // ============ Action Types ============

    bytes4 public constant ACTION_AUTO_BATTLE = bytes4(keccak256("AUTO_BATTLE"));
    bytes4 public constant ACTION_AUTO_BET = bytes4(keccak256("AUTO_BET"));
    bytes4 public constant ACTION_CLAIM_WINNINGS = bytes4(keccak256("CLAIM_WINNINGS"));
    bytes4 public constant ACTION_AUTO_CAST = bytes4(keccak256("AUTO_CAST"));
    bytes4 public constant ACTION_AUTO_MINT = bytes4(keccak256("AUTO_MINT"));
    bytes4 public constant ACTION_SWAP = bytes4(keccak256("SWAP"));

    // ============ State ============

    /// @notice The Spirit Agent contract
    IQLWYSpiritAgent public spiritAgent;

    /// @notice The Battle contract (V2)
    IQLWYBattleV2 public battleContract;

    /// @notice The QLWY token
    IERC20 public qlwyToken;

    /// @notice The AutoCaster contract for auto-cast/mint
    IQLWYAutoCaster public autoCaster;

    /// @notice Strategy settings per spirit
    struct Strategy {
        uint256 maxBetAmount;      // Maximum bet amount for auto-betting
        uint256 maxBattleBet;      // Maximum battle bet amount
        uint8 riskLevel;           // 0=conservative, 1=balanced, 2=aggressive
        bool autoBattleEnabled;    // Allow auto-battle
        bool autoBetEnabled;       // Allow auto-betting
        bool autoCastEnabled;      // Allow auto-cast
        bool autoSwapEnabled;      // Allow auto-swap (Four.meme internal market, etc.)
        uint256 jackpotThreshold;  // Jackpot must reach this amount to trigger auto-cast
        uint256 maxSwapAmount;     // Maximum swap amount per transaction
    }

    mapping(uint256 => Strategy) public strategies;

    // ============ Events ============

    event ActionPlanned(uint256 indexed tokenId, bytes4 actionType, uint256 instructionCount);
    event StrategyUpdated(uint256 indexed tokenId, Strategy strategy);

    // ============ Errors ============

    error NotSpiritAgent();
    error ActionNotSupported();
    error AutoBattleDisabled();
    error AutoBetDisabled();
    error ExceedsMaxBet();
    error AutoCastDisabled();
    error JackpotBelowThreshold();
    error AutoCasterNotSet();
    error AutoSwapDisabled();
    error ExceedsMaxSwapAmount();

    // ============ Constructor ============

    constructor(
        address _spiritAgent,
        address _battleContract,
        address _qlwyToken
    ) Ownable(msg.sender) {
        spiritAgent = IQLWYSpiritAgent(_spiritAgent);
        battleContract = IQLWYBattleV2(_battleContract);
        qlwyToken = IERC20(_qlwyToken);
    }

    // ============ Modifier ============

    modifier onlyFromSpiritAgent() {
        if (msg.sender != address(spiritAgent)) revert NotSpiritAgent();
        _;
    }

    // ============ Plan (called by SpiritAgent) ============

    /// @inheritdoc IAgentLogic
    function plan(
        uint256 tokenId,
        address owner,
        bytes calldata data
    ) external override onlyFromSpiritAgent returns (Instruction[] memory instructions, bytes memory result) {
        bytes4 actionType = bytes4(data[:4]);
        bytes calldata params = data[4:];

        if (actionType == ACTION_AUTO_BATTLE) {
            (instructions, result) = _planAutoBattle(tokenId, owner, params);
        } else if (actionType == ACTION_AUTO_BET) {
            (instructions, result) = _planAutoBet(tokenId, owner, params);
        } else if (actionType == ACTION_CLAIM_WINNINGS) {
            (instructions, result) = _planClaimWinnings(owner, params);
        } else if (actionType == ACTION_AUTO_CAST) {
            (instructions, result) = _planAutoCast(tokenId, owner);
        } else if (actionType == ACTION_AUTO_MINT) {
            (instructions, result) = _planAutoMint(tokenId, params);
        } else if (actionType == ACTION_SWAP) {
            (instructions, result) = _planSwap(tokenId, params);
        } else {
            revert ActionNotSupported();
        }

        emit ActionPlanned(tokenId, actionType, instructions.length);
    }
    
    // ============ Internal Planners ============

    /**
     * @notice Plan auto-battle: create or join a battle
     */
    function _planAutoBattle(
        uint256 tokenId,
        address owner,
        bytes calldata params
    ) internal view returns (Instruction[] memory instructions, bytes memory result) {
        Strategy memory strategy = strategies[tokenId];
        if (!strategy.autoBattleEnabled) revert AutoBattleDisabled();

        (uint256[] memory nftIds, uint256 betPerSlot, bool isCreate, uint256 battleId, bool joinChallenger) =
            abi.decode(params, (uint256[], uint256, bool, uint256, bool));

        if (betPerSlot > strategy.maxBattleBet) revert ExceedsMaxBet();

        instructions = new Instruction[](1);

        if (isCreate) {
            instructions[0] = Instruction({
                target: address(battleContract),
                callData: abi.encodeCall(battleContract.createBattleFor, (owner, nftIds, betPerSlot)),
                value: 0
            });
            result = abi.encode("CREATE_BATTLE");
        } else {
            if (joinChallenger) {
                instructions[0] = Instruction({
                    target: address(battleContract),
                    callData: abi.encodeCall(battleContract.joinChallengerFor, (battleId, owner, nftIds)),
                    value: 0
                });
            } else {
                instructions[0] = Instruction({
                    target: address(battleContract),
                    callData: abi.encodeCall(battleContract.joinDefenderFor, (battleId, owner, nftIds)),
                    value: 0
                });
            }
            result = abi.encode("JOIN_BATTLE", battleId);
        }
    }

    /**
     * @notice Plan auto-bet: place a bet on a battle
     */
    function _planAutoBet(
        uint256 tokenId,
        address owner,
        bytes calldata params
    ) internal view returns (Instruction[] memory instructions, bytes memory result) {
        Strategy memory strategy = strategies[tokenId];
        if (!strategy.autoBetEnabled) revert AutoBetDisabled();

        (uint256 battleId, bool betOnChallenger, uint256 amount) =
            abi.decode(params, (uint256, bool, uint256));

        if (amount > strategy.maxBetAmount) revert ExceedsMaxBet();

        instructions = new Instruction[](1);
        instructions[0] = Instruction({
            target: address(battleContract),
            callData: abi.encodeCall(battleContract.placeBetFor, (battleId, owner, betOnChallenger, amount)),
            value: 0
        });
        result = abi.encode("BET", battleId, betOnChallenger, amount);
    }

    /**
     * @notice Plan claim winnings
     */
    function _planClaimWinnings(
        address owner,
        bytes calldata params
    ) internal view returns (Instruction[] memory instructions, bytes memory result) {
        uint256 battleId = abi.decode(params, (uint256));

        instructions = new Instruction[](1);
        instructions[0] = Instruction({
            target: address(battleContract),
            callData: abi.encodeCall(battleContract.claimBetWinningsFor, (battleId, owner)),
            value: 0
        });
        result = abi.encode("CLAIM", battleId);
    }

    /**
     * @notice Plan auto-cast: request a fortune cast
     */
    function _planAutoCast(
        uint256 tokenId,
        address owner
    ) internal view returns (Instruction[] memory instructions, bytes memory result) {
        if (address(autoCaster) == address(0)) revert AutoCasterNotSet();

        Strategy memory strategy = strategies[tokenId];
        if (!strategy.autoCastEnabled) revert AutoCastDisabled();

        uint256 jackpot = autoCaster.getJackpotBalance();
        if (jackpot < strategy.jackpotThreshold) revert JackpotBelowThreshold();

        uint256 fee = autoCaster.getCastFee();

        instructions = new Instruction[](1);
        instructions[0] = Instruction({
            target: address(autoCaster),
            callData: abi.encodeCall(autoCaster.castFor, (owner)),
            value: fee
        });
        result = abi.encode("CAST", fee);
    }

    /**
     * @notice Plan auto-mint: mint NFT from completed cast
     */
    function _planAutoMint(
        uint256 tokenId,
        bytes calldata params
    ) internal view returns (Instruction[] memory instructions, bytes memory result) {
        if (address(autoCaster) == address(0)) revert AutoCasterNotSet();

        uint256 castId = abi.decode(params, (uint256));

        instructions = new Instruction[](1);
        instructions[0] = Instruction({
            target: address(autoCaster),
            callData: abi.encodeCall(autoCaster.mintFor, (castId)),
            value: 0
        });
        result = abi.encode("MINT", tokenId, castId);
    }

    /**
     * @notice Plan swap: approve token + call router (e.g. Four.meme internal market)
     * @dev Params: (address router, address tokenIn, uint256 amountIn, bytes swapCallData)
     *      - router: the DEX router address (must be whitelisted in SpiritAgent)
     *      - tokenIn: ERC20 token to spend (address(0) for BNB)
     *      - amountIn: amount to approve/spend
     *      - swapCallData: pre-encoded call to the router's swap function
     */
    function _planSwap(
        uint256 tokenId,
        bytes calldata params
    ) internal view returns (Instruction[] memory instructions, bytes memory result) {
        Strategy memory strategy = strategies[tokenId];
        if (!strategy.autoSwapEnabled) revert AutoSwapDisabled();

        (address router, address tokenIn, uint256 amountIn, bytes memory swapCallData) =
            abi.decode(params, (address, address, uint256, bytes));

        if (amountIn > strategy.maxSwapAmount) revert ExceedsMaxSwapAmount();

        if (tokenIn == address(0)) {
            // BNB swap: single instruction with value
            instructions = new Instruction[](1);
            instructions[0] = Instruction({
                target: router,
                callData: swapCallData,
                value: amountIn
            });
        } else {
            // ERC20 swap: approve + swap
            instructions = new Instruction[](2);
            instructions[0] = Instruction({
                target: tokenIn,
                callData: abi.encodeCall(IERC20.approve, (router, amountIn)),
                value: 0
            });
            instructions[1] = Instruction({
                target: router,
                callData: swapCallData,
                value: 0
            });
        }

        result = abi.encode("SWAP", router, tokenIn, amountIn);
    }

    // ============ Strategy Management ============

    /**
     * @notice Set strategy for a spirit (called by spirit owner)
     * @param tokenId The spirit token ID
     * @param strategy The strategy settings
     */
    function setStrategy(uint256 tokenId, Strategy calldata strategy) external {
        require(
            spiritAgent.originalOwners(tokenId) == msg.sender,
            "Not spirit owner"
        );
        require(spiritAgent.isWrapped(tokenId), "Not a spirit");

        strategies[tokenId] = strategy;
        emit StrategyUpdated(tokenId, strategy);
    }

    /**
     * @notice Get strategy for a spirit
     * @param tokenId The spirit token ID
     */
    function getStrategy(uint256 tokenId) external view returns (Strategy memory) {
        return strategies[tokenId];
    }

    // ============ Admin Functions ============

    /**
     * @notice Update spirit agent address
     */
    function setSpiritAgent(address _spiritAgent) external onlyOwner {
        spiritAgent = IQLWYSpiritAgent(_spiritAgent);
    }

    /**
     * @notice Update battle contract address
     */
    function setBattleContract(address _battleContract) external onlyOwner {
        battleContract = IQLWYBattleV2(_battleContract);
    }

    /**
     * @notice Set the AutoCaster contract address
     */
    function setAutoCaster(address _autoCaster) external onlyOwner {
        autoCaster = IQLWYAutoCaster(_autoCaster);
    }
}

