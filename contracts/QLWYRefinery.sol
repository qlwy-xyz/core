// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Binance Oracle VRF interface (same as deployed Core contract)
interface IVRFCoordinatorV2_5 {
    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);
}

interface IQLWYFortuneCoreMinimal {
    function tokenRarityOf(uint256 tokenId) external view returns (uint8);
    function ownerOf(uint256 tokenId) external view returns (address);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;

    function mintRefinedFortune(address to, uint8 rarity, uint256 seedOne, uint256 seedTwo)
        external
        returns (uint256);

    function refineryBurnFromEscrow(uint256 tokenId) external;
}

interface IERC20Burnable is IERC20 {
    function burn(uint256 amount) external;
}

/// @title QLWYRefinery
contract QLWYRefinery is ERC1155Burnable, ERC721Holder, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20Burnable;

    // -------------------------
    // Constants
    // -------------------------
    uint256 public constant ASH_ID = 1;

    uint256 private constant REFINE_TOKEN_COUNT = 3;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint32 private constant NUM_WORDS = 2;
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // -------------------------
    // Config (owner)
    // -------------------------

    /// @dev successBps[baseRarity] used; baseRarity is 1..3 only (Rare/Epic/Legendary)
    uint16[4] public successBps = [uint16(0), 4500, 2000, 800];

    /// @dev refineFees[baseRarity - 1]: Rare->Epic 2000, Epic->Legendary 8000, Legendary->Mythic 50000
    uint256[3] public refineFees = [
        uint256(200 ether),
        uint256(800 ether),
        uint256(5000 ether)
    ];

    uint16 public boostPerAshBps = 25;

    uint16 public maxBoostBps = 1500;

    uint16 public burnStep = 5;

    uint16 public hardCapBps = 9500;

    uint32 public refineTimeout = 1 days;

    // -------------------------
    // VRF config
    // -------------------------
    IQLWYFortuneCoreMinimal public fortuneCore;
    IERC20Burnable public qlwyToken;

    IVRFCoordinatorV2_5 public vrfCoordinator;
    bytes32 public vrfKeyHash;
    uint64 public vrfSubId;
    uint16 public vrfMinConfirmations;
    uint32 public vrfCallbackGasLimit;

    // -------------------------
    // State
    // -------------------------
    struct RefineRequest {
        address user;
        uint8 baseRarity;
        uint8 targetRarity;
        uint256[3] tokenIds;
        uint16 bonusBps;
        uint40 createdAt;    // for timeout cancel
        bool resolved;
    }

    mapping(uint256 => RefineRequest) public refineRequests;

    // -------------------------
    // Events
    // -------------------------
    event RefineRequested(
        address indexed user,
        uint8 indexed baseRarity,
        uint8 indexed targetRarity,
        uint256 requestId,
        uint256 burnAsh,
        uint16 bonusBps
    );

    event RefineResult(
        address indexed user,
        uint8 indexed baseRarity,
        uint8 indexed targetRarity,
        bool success,
        uint16 finalThresholdBps
    );

    event RefineCancelled(address indexed user, uint256 indexed requestId);

    // -------------------------
    // Errors
    // -------------------------
    error InvalidTokenCount();
    error RarityNotSupported();
    error NotOwnerOfToken();
    error AlreadyResolved();
    error InvalidBurnAmount();
    error NotRequester();
    error NotExpired();

    constructor(
        address owner_,
        IQLWYFortuneCoreMinimal fortuneCore_,
        IERC20Burnable qlwyToken_,
        IVRFCoordinatorV2_5 coordinator_,
        bytes32 keyHash_,
        uint64 subId_,
        uint16 minConfirmations_,
        uint32 callbackGasLimit_
    ) ERC1155("") Ownable(owner_) {
        fortuneCore = fortuneCore_;
        qlwyToken = qlwyToken_;
        vrfCoordinator = coordinator_;
        vrfKeyHash = keyHash_;
        vrfSubId = subId_;
        vrfMinConfirmations = minConfirmations_;
        vrfCallbackGasLimit = callbackGasLimit_;
    }

    // -------------------------
    // Admin
    // -------------------------
    function setVRFConfig(
        IVRFCoordinatorV2_5 coordinator_,
        bytes32 keyHash_,
        uint64 subId_,
        uint16 minConfirmations_,
        uint32 callbackGasLimit_
    ) external onlyOwner {
        vrfCoordinator = coordinator_;
        vrfKeyHash = keyHash_;
        vrfSubId = subId_;
        vrfMinConfirmations = minConfirmations_;
        vrfCallbackGasLimit = callbackGasLimit_;
    }

    function setSuccessBps(uint16[4] calldata values) external onlyOwner {
        successBps = values;
    }

    function setRefineFees(uint256[3] calldata fees) external onlyOwner {
        refineFees = fees;
    }

    function setAshBoost(uint16 boostPerAshBps_, uint16 maxBoostBps_, uint16 burnStep_, uint16 hardCapBps_)
        external
        onlyOwner
    {
        boostPerAshBps = boostPerAshBps_;
        maxBoostBps = maxBoostBps_;
        burnStep = burnStep_;
        hardCapBps = hardCapBps_;
    }

    function setRefineTimeout(uint32 t) external onlyOwner {
        refineTimeout = t;
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

  
    function refine(uint256[] calldata tokenIds, uint256 burnAsh) external whenNotPaused nonReentrant {
        if (tokenIds.length != REFINE_TOKEN_COUNT) revert InvalidTokenCount();

        uint256 firstTokenId = tokenIds[0];
        uint8 baseRarity = fortuneCore.tokenRarityOf(firstTokenId);

        // baseRarity: 1..3 only
        if (baseRarity == 0) revert RarityNotSupported();
        if (baseRarity >= 4) revert RarityNotSupported();

        uint8 targetRarity = baseRarity + 1;

        // Transfer 3 NFTs into refinery escrow
        for (uint256 i = 0; i < REFINE_TOKEN_COUNT; i++) {
            uint256 tokenId = tokenIds[i];
            if (fortuneCore.ownerOf(tokenId) != msg.sender) revert NotOwnerOfToken();
            if (fortuneCore.tokenRarityOf(tokenId) != baseRarity) revert RarityNotSupported();
            fortuneCore.safeTransferFrom(msg.sender, address(this), tokenId);
        }

        // Pull QLWY fee and send to dead address (burn)
        uint256 fee = refineFees[baseRarity - 1];
        if (fee > 0) {
            qlwyToken.safeTransferFrom(msg.sender, DEAD_ADDRESS, fee);
        }

        // Ash -> bonusBps
        uint16 bonusBps;
        if (burnAsh > 0) {
            if (burnStep > 0 && burnAsh % burnStep != 0) revert InvalidBurnAmount();
            _burn(msg.sender, ASH_ID, burnAsh);

            uint256 bonus = uint256(burnAsh) * uint256(boostPerAshBps);
            if (bonus > maxBoostBps) bonus = maxBoostBps;
            bonusBps = uint16(bonus);
        }

        // Request VRF (Binance Oracle VRF interface, consistent with deployed Core)
        uint256 requestId = vrfCoordinator.requestRandomWords(
            vrfKeyHash,
            vrfSubId,
            vrfMinConfirmations,
            vrfCallbackGasLimit,
            NUM_WORDS
        );

        RefineRequest storage request = refineRequests[requestId];
        request.user = msg.sender;
        request.baseRarity = baseRarity;
        request.targetRarity = targetRarity;
        request.bonusBps = bonusBps;
        request.createdAt = uint40(block.timestamp);
        for (uint256 i = 0; i < REFINE_TOKEN_COUNT; i++) {
            request.tokenIds[i] = tokenIds[i];
        }

        emit RefineRequested(msg.sender, baseRarity, targetRarity, requestId, burnAsh, bonusBps);
    }

    function cancelRefine(uint256 requestId) external whenNotPaused nonReentrant {
        RefineRequest storage request = refineRequests[requestId];
        if (request.user == address(0)) revert("QLWY: invalid request");
        if (request.resolved) revert AlreadyResolved();
        if (request.user != msg.sender) revert NotRequester();
        if (block.timestamp < uint256(request.createdAt) + refineTimeout) revert NotExpired();

        request.resolved = true;

        // return NFTs
        for (uint256 i = 0; i < REFINE_TOKEN_COUNT; i++) {
            fortuneCore.safeTransferFrom(address(this), msg.sender, request.tokenIds[i]);
        }

        emit RefineCancelled(msg.sender, requestId);
    }

    // -------------------------
    // VRF callback
    // -------------------------
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        require(msg.sender == address(vrfCoordinator), "QLWY: only coordinator");
        RefineRequest storage request = refineRequests[requestId];
        if (request.user == address(0)) revert("QLWY: invalid request");
        if (request.resolved) revert AlreadyResolved();
        request.resolved = true;

        // base success + bonus
        uint256 threshold = uint256(successBps[request.baseRarity]) + uint256(request.bonusBps);
        if (threshold > hardCapBps) threshold = hardCapBps;

        bool success = (randomWords[0] % BPS_DENOMINATOR) < threshold;

        // Burn all 3 escrow NFTs
        for (uint256 i = 0; i < REFINE_TOKEN_COUNT; i++) {
            fortuneCore.refineryBurnFromEscrow(request.tokenIds[i]);
        }

        if (success) {
            // Mix seeds with request context to avoid too “samey” results
            uint256 seedOne = uint256(keccak256(abi.encode(randomWords[0], request.tokenIds, request.user, requestId)));
            uint256 seedTwo = uint256(keccak256(abi.encode(randomWords[1], request.tokenIds, block.chainid)));
            fortuneCore.mintRefinedFortune(request.user, request.targetRarity, seedOne, seedTwo);
        } else {
            // Ash drop scales with base rarity
            // Rare(1)->1, Epic(2)->2, Legendary(3)->5
            uint256 ashOut = request.baseRarity == 3 ? 5 : uint256(request.baseRarity);
            _mint(request.user, ASH_ID, ashOut, "");
        }

        emit RefineResult(request.user, request.baseRarity, request.targetRarity, success, uint16(threshold));
    }
}
