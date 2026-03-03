// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Royalty} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFCoordinatorV2_5 {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata request)
        external
        returns (uint256 requestId);
}

interface IPancakeRouterV2 {
    function swapExactETHForTokensSupportingFeeOnTransferTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable;
}

interface IPancakeV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

    function refundETH() external payable;
}

interface IWBNB is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IQLWYRenderer {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @notice Partial interface used by the refinery contract.
/// @title QLWYFortuneCore
/// @notice Core contract handling VRF casting, NFT minting, jackpots, and refinements for 潜龙勿用。
contract QLWYFortuneCore is ERC721Royalty, Pausable, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Rarity {
        Common,
        Rare,
        Epic,
        Legendary,
        Mythic
    }

    struct CastData {
        address user;
        uint40 timestamp;
        bool minted;
        bool ready;
        uint8 rarity;
        uint8 luck;
        bool usedFreeCast;
        uint8[6] lines;
        uint16 id;
    }

    struct TokenAttributes {
        uint8 rarity;
        uint8 luck;
        uint8[6] lines;
        uint16 id;
    }

    struct Hexagram {
        uint8[6] lines;
        uint16 id;
    }

    struct TokenView {
        uint8 rarity;
        uint8 luck;
        uint8[6] lines;
        uint16 id;
    }

    struct JackpotPayoutBreakdown {
        uint256 toWinner;
        uint256 toHolders;
        uint256 retained;
        uint256 distributedToAll; // used for final mythic logic
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    uint256 public constant MYTHIC_CAP = 88;
    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant DEFAULT_ROYALTY_BPS = 600; // 6%
    uint32 private constant CAST_NUM_WORDS = 2;

    uint16[5] public rarityBps = [uint16(8590), 1000, 300, 100, 10];

    // ---------------------------------------------------------------------
    // Immutable state
    // ---------------------------------------------------------------------

    IERC20 public qlwyToken;

    // ---------------------------------------------------------------------
    // Configurable state
    // ---------------------------------------------------------------------

    enum RouterType {
        V2,
        V3
    }

    IPancakeRouterV2 public routerV2;
    IPancakeV3Router public routerV3;
    RouterType public routerType;
    address public wbnb;
    uint24 public routerPoolFee; // 0.25% default for v3
    IVRFCoordinatorV2_5 public vrfCoordinator;
    bytes32 public vrfKeyHash;
    uint256 public vrfSubId;
    uint16 public vrfMinConfirmations;
    uint32 public vrfCallbackGasLimit;
    uint32 public cooldownSeconds = 10;
    uint16 public buybackBps = 7000;

    uint256 public castFee = 0.001 ether;

    uint8 private constant JACKPOT_FUND_MINT = 0;
    uint8 private constant JACKPOT_FUND_BUYBACK = 1;
    uint8 private constant JACKPOT_FUND_EXTERNAL = 2;
    uint8 private constant JACKPOT_FUND_REFINERY = 3;

    uint256[4] public mintFeeByRarity = [
        uint256(50 ether),
        uint256(100 ether),
        uint256(500 ether),
        uint256(2000 ether)
    ];

    uint256 public castBuybackThreshold;
    uint256 private _castBuybackBuffer;

    address public renderer;
    address public opsTreasury;
    address public refinery;

    // ---------------------------------------------------------------------
    // Mutable state
    // ---------------------------------------------------------------------

    uint256 public nextCastId = 1;
    uint256 public nextTokenId = 1;
    uint256 public mythicMinted;

    mapping(uint256 => CastData) private _casts;
    mapping(uint256 => TokenAttributes) private _attributes;
    mapping(uint256 => uint256) private _requestToCast;
    mapping(address => uint256) public freeCastCredits;
    mapping(address => uint256) public lastCastAt;

    uint256[] public mythicTokenIds;
    mapping(address => uint256) public mythicBalances;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event CastRequested(uint256 indexed castId, address indexed user, uint256 indexed requestId);
    event CastReady(uint256 indexed castId, uint8 rarity, uint16 id, uint8 luck);
    event Minted(uint256 indexed tokenId, uint256 indexed castId, uint8 rarity, address indexed to);
    event MythicMinted(address indexed to, uint256 indexed mythicId, uint256 indexed castId);
    event JackpotPayout(uint256 indexed mythicId, JackpotPayoutBreakdown breakdown);
    event RouterUpdated(RouterType routerType, address indexed router, address indexed wbnb, uint24 poolFee);
    event RendererUpdated(address indexed renderer);
    event RefineryUpdated(address indexed refinery);
    event MintFeesUpdated(uint256[4] fees);
    event CastBuybackThresholdUpdated(uint256 threshold);
    event CastBuybackExecuted(uint256 amountIn, uint256 qlwyOut);
    event QLWYTokenUpdated(address indexed token);
    event JackpotFunded(address indexed source, uint256 amount, uint8 category);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidRouterPath();
    error OnlyVRFCoordinator();
    error FreeCastUnavailable();
    error CooldownActive();
    error CastNotReady();
    error CastAlreadyMinted();
    error CastNotRareEnough();
    error MythicCapReached();
    error JackpotEmpty();
    error QLWYTokenNotSet();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_,
        IERC20 qlwyToken_,
        RouterType routerType_,
        address routerAddress_,
        address wbnb_,
        uint24 poolFee_,
        IVRFCoordinatorV2_5 coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint16 minConfirmations_,
        uint32 callbackGasLimit_
    ) ERC721(name_, symbol_) Ownable(owner_) {
        qlwyToken = qlwyToken_;
        routerType = routerType_;
        wbnb = wbnb_;
        if (routerType_ == RouterType.V2) {
            routerV2 = IPancakeRouterV2(routerAddress_);
            routerPoolFee = 0;
            routerV3 = IPancakeV3Router(address(0));
        } else {
            routerV3 = IPancakeV3Router(routerAddress_);
            routerPoolFee = poolFee_ == 0 ? 2_500 : poolFee_;
            routerV2 = IPancakeRouterV2(address(0));
        }
        vrfCoordinator = coordinator_;
        vrfKeyHash = keyHash_;
        vrfSubId = subId_;
        vrfMinConfirmations = minConfirmations_;
        vrfCallbackGasLimit = callbackGasLimit_;
        opsTreasury = owner_;
        _setDefaultRoyalty(owner_, DEFAULT_ROYALTY_BPS);
    }

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyRefinery() {
        require(msg.sender == refinery, "QLWY: not refinery");
        _;
    }

    // ---------------------------------------------------------------------
    // External admin configuration
    // ---------------------------------------------------------------------

    function setRenderer(address renderer_) external onlyOwner {
        require(renderer_ != address(0), "QLWY: renderer zero");
        renderer = renderer_;
        emit RendererUpdated(renderer_);
    }

    function setRefinery(address refinery_) external onlyOwner {
        refinery = refinery_;
        emit RefineryUpdated(refinery_);
    }

    function setQLWYToken(IERC20 token_) external onlyOwner {
        qlwyToken = token_;
        emit QLWYTokenUpdated(address(token_));
    }

    function setRouterConfig(RouterType routerType_, address routerAddress_, address wbnb_, uint24 poolFee_)
        external
        onlyOwner
    {
        routerType = routerType_;
        wbnb = wbnb_;
        if (routerType_ == RouterType.V2) {
            routerV2 = IPancakeRouterV2(routerAddress_);
            routerV3 = IPancakeV3Router(address(0));
            routerPoolFee = 0;
        } else {
            routerV3 = IPancakeV3Router(routerAddress_);
            routerV2 = IPancakeRouterV2(address(0));
            routerPoolFee = poolFee_ == 0 ? 2_500 : poolFee_;
        }
        emit RouterUpdated(routerType, routerAddress_, wbnb_, routerPoolFee);
        _executeCastBuyback(false);
    }

    function setVRFConfig(
        IVRFCoordinatorV2_5 coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint16 minConfirmations_,
        uint32 callbackGasLimit_
    ) external onlyOwner {
        vrfCoordinator = coordinator_;
        vrfKeyHash = keyHash_;
        vrfSubId = subId_;
        vrfMinConfirmations = minConfirmations_;
        vrfCallbackGasLimit = callbackGasLimit_;
    }

    /// @notice Deprecated: use setCastFee / setMintFees.
    function setFees(uint256 castFeeWei, uint256 /*mintFeeWei*/ ) external onlyOwner {
        castFee = castFeeWei;
    }

    function setCastFee(uint256 castFeeWei) external onlyOwner {
        castFee = castFeeWei;
    }

    function setMintFees(uint256[4] calldata fees) external onlyOwner {
        mintFeeByRarity = fees;
        emit MintFeesUpdated(fees);
    }

    function setCooldown(uint32 seconds_) external onlyOwner {
        cooldownSeconds = seconds_;
    }

    function setBuybackSplit(uint16 buybackBps_) external onlyOwner {
        require(buybackBps_ <= BPS_DENOMINATOR, "QLWY: invalid split");
        buybackBps = buybackBps_;
    }

    function setCastBuybackThreshold(uint256 threshold) external onlyOwner {
        castBuybackThreshold = threshold;
        emit CastBuybackThresholdUpdated(threshold);
        _executeCastBuyback(false);
    }

    function processCastBuyback() external {
        require(_executeCastBuyback(false), "QLWY: nothing to buy back");
    }

    function forceCastBuyback() external onlyOwner {
        require(_executeCastBuyback(true), "QLWY: nothing to buy back");
    }

    function castBuybackBuffer() external view returns (uint256) {
        return _castBuybackBuffer;
    }

    function setOpsTreasury(address ops) external onlyOwner {
        opsTreasury = ops;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function grantFreeCast(address user, uint256 amount) external {
        require(msg.sender == owner() || msg.sender == refinery, "QLWY: not authorized");
        freeCastCredits[user] += amount;
    }

    // ---------------------------------------------------------------------
    // Casting logic
    // ---------------------------------------------------------------------

    function requestCast(bytes calldata /*opts*/)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 castId, uint256 requestId)
    {
        (bool usingFreeCast, uint256 requiredFee) = _consumeOrValidateCastFee(msg.sender);
        require(msg.value == requiredFee, "QLWY: invalid cast fee");

        uint256 lastCast = lastCastAt[msg.sender];
        if (lastCast != 0 && block.timestamp - lastCast < cooldownSeconds) {
            revert CooldownActive();
        }
        lastCastAt[msg.sender] = block.timestamp;

        castId = nextCastId++;
        CastData storage data = _casts[castId];
        data.user = msg.sender;
        data.timestamp = uint40(block.timestamp);
        data.usedFreeCast = usingFreeCast;

        requestId = _requestRandomWords();
        _requestToCast[requestId] = castId;

        emit CastRequested(castId, msg.sender, requestId);

        if (requiredFee > 0) {
            _handleCastProceeds(requiredFee);
        }
    }

    function fulfillCast(uint256 requestId, uint256[] memory randomWords) internal {
        uint256 castId = _requestToCast[requestId];
        require(castId != 0, "QLWY: unknown request");
        delete _requestToCast[requestId];

        CastData storage data = _casts[castId];
        require(!data.ready, "QLWY: already ready");

        TokenAttributes memory attrs = _buildAttributes(randomWords);
        data.ready = true;
        data.rarity = attrs.rarity;
        data.luck = attrs.luck;
        data.id = attrs.id;
        for (uint256 i = 0; i < 6; i++) {
            data.lines[i] = attrs.lines[i];
        }

        uint16 externalHexId = uint16(data.id + 1);
        emit CastReady(castId, data.rarity, externalHexId, data.luck);
    }

    function mintFortuneNFT(uint256 castId)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (uint256 tokenId)
    {
        CastData storage data = _casts[castId];
        if (!data.ready) revert CastNotReady();
        if (data.minted) revert CastAlreadyMinted();
        if (data.user != msg.sender) revert("QLWY: not caster");
        if (data.rarity == uint8(Rarity.Common)) revert CastNotRareEnough();
        require(msg.value == 0, "QLWY: mint requires no BNB");

        uint256 qlwyFee = mintFeeForRarity(data.rarity);
        if (qlwyFee > 0) {
            IERC20 token = _requireTokenSet();
            token.safeTransferFrom(msg.sender, address(this), qlwyFee);
            _recordJackpotFunding(msg.sender, qlwyFee, JACKPOT_FUND_MINT);
        }

        data.minted = true;
        tokenId = nextTokenId++;

        TokenAttributes storage attrs = _attributes[tokenId];
        attrs.rarity = data.rarity;
        attrs.luck = data.luck;
        attrs.id = data.id;
        for (uint256 i = 0; i < 6; i++) {
            attrs.lines[i] = data.lines[i];
        }

        _safeMint(msg.sender, tokenId);
        emit Minted(tokenId, castId, data.rarity, msg.sender);

        _postMintHook(tokenId, data.rarity, castId, msg.sender);
    }

    function seedJackpot(uint256 amount) external {
        IERC20 token = _requireTokenSet();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _recordJackpotFunding(msg.sender, amount, JACKPOT_FUND_EXTERNAL);
    }

    function jackpotBalanceOf() external view returns (uint256) {
        IERC20 token = qlwyToken;
        if (address(token) == address(0)) {
            return 0;
        }
        return token.balanceOf(address(this));
    }

    function mythicMintedCount() external view returns (uint256) {
        return mythicMinted;
    }

    function mintFeeForRarity(uint8 rarity) public view returns (uint256) {
        if (rarity == 0 || rarity > uint8(Rarity.Mythic)) {
            return 0;
        }
        return mintFeeByRarity[rarity - 1];
    }

    function casts(uint256 castId)
        external
        view
        returns (address user, uint40 ts, bool minted, Hexagram memory hx, uint8 rarity, bool ready, uint8 luck)
    {
        CastData storage data = _casts[castId];
        user = data.user;
        ts = data.timestamp;
        minted = data.minted;
        rarity = data.rarity;
        ready = data.ready;
        luck = data.luck;
        uint8[6] memory lines;
        for (uint256 i = 0; i < 6; i++) {
            lines[i] = data.lines[i];
        }
        uint16 externalHexId = uint16(data.id + 1);
        hx = Hexagram({lines: lines, id: externalHexId});
    }

    function tokenView(uint256 tokenId) external view returns (TokenView memory view_) {
        _ensureMinted(tokenId);
        TokenAttributes storage attrs = _attributes[tokenId];
        uint8[6] memory lines;
        for (uint256 i = 0; i < 6; i++) {
            lines[i] = attrs.lines[i];
        }
        uint16 externalHexId = uint16(attrs.id + 1);
        view_ = TokenView({rarity: attrs.rarity, luck: attrs.luck, lines: lines, id: externalHexId});
    }

    function tokenRarityOf(uint256 tokenId) external view returns (uint8) {
        _ensureMinted(tokenId);
        return _attributes[tokenId].rarity;
    }

    function pullQLWY(address from, uint256 amount) external onlyRefinery {
        IERC20 token = _requireTokenSet();
        token.safeTransferFrom(from, address(this), amount);
        _recordJackpotFunding(from, amount, JACKPOT_FUND_REFINERY);
    }

    function refineryBurnFromEscrow(uint256 tokenId) external onlyRefinery {
        require(ownerOf(tokenId) == refinery, "QLWY: escrow mismatch");
        _burn(tokenId);
    }

    function mintRefinedFortune(address to, uint8 targetRarity, uint256 seedOne, uint256 seedTwo)
        external
        onlyRefinery
        returns (uint256 tokenId)
    {
        uint8 rarity = targetRarity;
        if (rarity == uint8(Rarity.Mythic) && mythicMinted >= MYTHIC_CAP) {
            rarity = uint8(Rarity.Legendary);
        }

        TokenAttributes memory generated = _buildAttributesFromSeeds(seedOne, seedTwo, rarity);
        tokenId = nextTokenId++;
        TokenAttributes storage attrs = _attributes[tokenId];
        attrs.rarity = generated.rarity;
        attrs.luck = generated.luck;
        attrs.id = generated.id;
        for (uint256 i = 0; i < 6; i++) {
            attrs.lines[i] = generated.lines[i];
        }

        _safeMint(to, tokenId);
        emit Minted(tokenId, 0, attrs.rarity, to);
        _postMintHook(tokenId, attrs.rarity, 0, to);
    }

    function consumeFreeCast(address user) external onlyRefinery {
        if (freeCastCredits[user] == 0) revert FreeCastUnavailable();
        freeCastCredits[user] -= 1;
    }

    // ---------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------

    function _consumeOrValidateCastFee(address user) private returns (bool usingFreeCast, uint256 requiredFee) {
        if (freeCastCredits[user] > 0) {
            freeCastCredits[user] -= 1;
            usingFreeCast = true;
            requiredFee = 0;
        } else {
            usingFreeCast = false;
            requiredFee = castFee;
        }
    }

    function _requireTokenSet() private view returns (IERC20 token) {
        token = qlwyToken;
        if (address(token) == address(0)) {
            revert QLWYTokenNotSet();
        }
    }

    function _handleCastProceeds(uint256 amount) private {
        if (amount == 0) {
            return;
        }

        uint256 buybackAmount = (amount * buybackBps) / BPS_DENOMINATOR;
        uint256 opsAmount = amount - buybackAmount;

        if (buybackAmount > 0) {
            _castBuybackBuffer += buybackAmount;
            _executeCastBuyback(false);
        }

        if (opsAmount > 0 && opsTreasury != address(0)) {
            (bool success, ) = opsTreasury.call{value: opsAmount}("");
            require(success, "QLWY: ops transfer failed");
        }
    }

    function _recordJackpotFunding(address source, uint256 amount, uint8 category) private {
        if (amount == 0) {
            return;
        }
        emit JackpotFunded(source, amount, category);
    }

    function _postMintHook(uint256 tokenId, uint8 rarity, uint256 castId, address to) private {
        if (rarity == uint8(Rarity.Mythic)) {
            if (mythicMinted >= MYTHIC_CAP) revert MythicCapReached();
            mythicMinted += 1;
            mythicTokenIds.push(tokenId);
            mythicBalances[to] += 1;
            emit MythicMinted(to, mythicMinted, castId);
            _handleMythicJackpot(to);
        }
    }

    function _executeCastBuyback(bool force) private returns (bool) {
        uint256 amount = _castBuybackBuffer;
        if (amount == 0) {
            return false;
        }

        address routerAddress = routerType == RouterType.V2 ? address(routerV2) : address(routerV3);
        if (routerAddress == address(0) || wbnb == address(0)) {
            if (force) {
                revert("QLWY: router not configured");
            }
            return false;
        }

        if (!force && castBuybackThreshold > 0 && amount < castBuybackThreshold) {
            return false;
        }

        if (address(qlwyToken) == address(0)) {
            if (force) {
                revert QLWYTokenNotSet();
            }
            return false;
        }

        _castBuybackBuffer = 0;
        uint256 acquired = _swapETHForQLWY(amount);
        _recordJackpotFunding(routerAddress, acquired, JACKPOT_FUND_BUYBACK);
        emit CastBuybackExecuted(amount, acquired);
        return true;
    }

    function _swapETHForQLWY(uint256 amount) private returns (uint256 acquired) {
        address routerAddress = routerType == RouterType.V2 ? address(routerV2) : address(routerV3);
        if (routerAddress == address(0) || wbnb == address(0)) {
            revert("QLWY: router not configured");
        }
        IERC20 token = _requireTokenSet();
        uint256 beforeBalance = token.balanceOf(address(this));

        if (routerType == RouterType.V2) {
            address[] memory path = new address[](2);
            path[0] = wbnb;
            path[1] = address(token);
            routerV2.swapExactETHForTokensSupportingFeeOnTransferTokens{value: amount}(
                0,
                path,
                address(this),
                block.timestamp
            );
        } else {
            IWBNB wrapped = IWBNB(wbnb);
            wrapped.deposit{value: amount}();
            IERC20 wbnbToken = IERC20(wbnb);
            uint256 currentAllowance = wbnbToken.allowance(address(this), routerAddress);
            if (currentAllowance < amount) {
                SafeERC20.forceApprove(wbnbToken, routerAddress, 0);
                SafeERC20.forceApprove(wbnbToken, routerAddress, type(uint256).max);
            }
            IPancakeV3Router.ExactInputSingleParams memory params = IPancakeV3Router.ExactInputSingleParams({
                tokenIn: wbnb,
                tokenOut: address(token),
                fee: routerPoolFee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });
            routerV3.exactInputSingle(params);

            uint256 leftoverWbnb = wbnbToken.balanceOf(address(this));
            if (leftoverWbnb > 0) {
                wrapped.withdraw(leftoverWbnb);
            }
        }

        uint256 afterBalance = token.balanceOf(address(this));
        acquired = afterBalance - beforeBalance;
    }

    function _handleMythicJackpot(address winner) private {
        IERC20 token = _requireTokenSet();
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) {
            return;
        }

        JackpotPayoutBreakdown memory breakdown;

        if (mythicMinted == MYTHIC_CAP) {
            uint256 count = mythicTokenIds.length;
            uint256 perToken = balance / count;
            uint256 distributed;
            for (uint256 i = 0; i < count; i++) {
                address holder = ownerOf(mythicTokenIds[i]);
                token.safeTransfer(holder, perToken);
                distributed += perToken;
            }
            uint256 remainder = balance - distributed;
            if (remainder > 0) {
                token.safeTransfer(winner, remainder);
                distributed += remainder;
            }
            breakdown.distributedToAll = distributed;
        } else {
            uint256 toWinner = (balance * 5000) / BPS_DENOMINATOR;
            uint256 toHolders = (balance * 3000) / BPS_DENOMINATOR;
            uint256 retained = balance - toWinner - toHolders;

            breakdown.toWinner = toWinner;
            breakdown.toHolders = toHolders;
            breakdown.retained = retained;

            if (toWinner > 0) {
                token.safeTransfer(winner, toWinner);
            }

            uint256 holderCount = mythicTokenIds.length;
            if (toHolders > 0 && holderCount > 0) {
                uint256 perToken = toHolders / holderCount;
                uint256 distributed;
                for (uint256 i = 0; i < holderCount; i++) {
                    address holder = ownerOf(mythicTokenIds[i]);
                    token.safeTransfer(holder, perToken);
                    distributed += perToken;
                }
                uint256 leftover = toHolders - distributed;
                if (leftover > 0) {
                    breakdown.retained += leftover;
                }
            }
        }

        emit JackpotPayout(mythicMinted, breakdown);
    }

    function _buildAttributes(uint256[] memory randomWords) private view returns (TokenAttributes memory attrs) {
        require(randomWords.length >= CAST_NUM_WORDS, "QLWY: insufficient words");
        uint256 seedOne = randomWords[0];
        uint256 seedTwo = randomWords[1];

        uint8[6] memory lines;
        uint256 cursor = seedOne;
        uint16 hexId;
        for (uint16 i = 0; i < 6; i++) {
            uint8 lineState = uint8(cursor & 1);
            cursor >>= 1;
            lines[i] = lineState;
            hexId |= uint16(lineState) << i;
        }

        uint8 luck = uint8(seedTwo % 101);
        uint256 rarityRoll = (seedTwo / 101) % BPS_DENOMINATOR;
        uint8 rarity = _rarityFromRoll(rarityRoll);
        if (rarity == uint8(Rarity.Mythic) && mythicMinted >= MYTHIC_CAP) {
            rarity = uint8(Rarity.Legendary);
        }

        attrs = TokenAttributes({rarity: rarity, luck: luck, lines: lines, id: hexId});
    }

    function _buildAttributesFromSeeds(uint256 seedOne, uint256 seedTwo, uint8 forcedRarity)
        private
        view
        returns (TokenAttributes memory attrs)
    {
        uint256[] memory words = new uint256[](CAST_NUM_WORDS);
        words[0] = seedOne;
        words[1] = seedTwo;
        attrs = _buildAttributes(words);
        attrs.rarity = forcedRarity;
    }

    function _rarityFromRoll(uint256 roll) private view returns (uint8 rarity) {
        uint256 cumulative;
        for (uint8 i = 0; i < rarityBps.length; i++) {
            cumulative += rarityBps[i];
            if (roll < cumulative) {
                rarity = i;
                break;
            }
        }
    }

    function _requestRandomWords() private returns (uint256 requestId) {
        if (address(vrfCoordinator) == address(0)) revert("QLWY: VRF not set");

        VRFV2PlusClient.RandomWordsRequest memory request = VRFV2PlusClient.RandomWordsRequest({
            keyHash: vrfKeyHash,
            subId: vrfSubId,
            requestConfirmations: vrfMinConfirmations,
            callbackGasLimit: vrfCallbackGasLimit,
            numWords: CAST_NUM_WORDS,
            extraArgs: VRFV2PlusClient._argsToBytes(
                VRFV2PlusClient.ExtraArgsV1({nativePayment: true})
            )
        });

        requestId = vrfCoordinator.requestRandomWords(request);
    }

    function _ensureMinted(uint256 tokenId) private view {
        if (_ownerOf(tokenId) == address(0)) {
            revert("QLWY: nonexistent token");
        }
    }

    // ---------------------------------------------------------------------
    // VRF callback entry point
    // ---------------------------------------------------------------------

    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != address(vrfCoordinator)) revert OnlyVRFCoordinator();
        fulfillCast(requestId, randomWords);
    }

    // ---------------------------------------------------------------------
    // Overrides
    // ---------------------------------------------------------------------

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _ensureMinted(tokenId);
        if (renderer == address(0)) {
            return string.concat("{\"name\":\"QLWY #", Strings.toString(tokenId), "\"}");
        }
        return IQLWYRenderer(renderer).tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721Royalty) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = super._update(to, tokenId, auth);
        uint8 rarity = _attributes[tokenId].rarity;
        if (rarity == uint8(Rarity.Mythic)) {
            if (from != address(0)) {
                mythicBalances[from] -= 1;
            }
            if (to != address(0)) {
                mythicBalances[to] += 1;
            }
        }
        return from;
    }

    receive() external payable {}
}
