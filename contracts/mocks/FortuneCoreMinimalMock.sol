// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal mock of QLWYFortuneCore for testing QLWYRefinery, QLWYBattle, and QLWYAutoCaster
contract FortuneCoreMinimalMock is ERC721 {
    using SafeERC20 for IERC20;

    uint256 public nextTokenId = 1;
    mapping(uint256 => uint8) private _rarities;
    mapping(uint256 => uint8) private _lucks;
    address public refinery;

    // For Battle testing
    uint256 public jackpotBalance;
    IERC20 public qlwyToken;

    // ============ Cast/Mint mock state ============

    struct Hexagram {
        uint8[6] lines;
        uint16 id;
    }

    struct CastData {
        address user;
        uint40 timestamp;
        bool minted;
        bool ready;
        uint8 rarity;
        uint8 luck;
    }

    uint256 public nextCastId = 1;
    uint256 public castFee = 0.001 ether;
    uint256[4] public mintFeeByRarity = [
        uint256(50 ether),
        uint256(100 ether),
        uint256(500 ether),
        uint256(2000 ether)
    ];
    mapping(uint256 => CastData) private _casts;

    constructor() ERC721("MockFortune", "MFORT") {}

    function setRefinery(address refinery_) external {
        refinery = refinery_;
    }

    function setQLWYToken(address token_) external {
        qlwyToken = IERC20(token_);
    }

    modifier onlyRefinery() {
        require(msg.sender == refinery, "Mock: not refinery");
        _;
    }

    /// @notice Mint a token with specified rarity for testing
    function mintWithRarity(address to, uint8 rarity) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _rarities[tokenId] = rarity;
        _lucks[tokenId] = 50; // Default luck
        _mint(to, tokenId);
    }

    /// @notice Mint a token with specified rarity and luck for Battle testing
    function mintWithRarityAndLuck(address to, uint8 rarity, uint8 luck) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _rarities[tokenId] = rarity;
        _lucks[tokenId] = luck;
        _mint(to, tokenId);
    }

    function tokenRarityOf(uint256 tokenId) external view returns (uint8) {
        require(ownerOf(tokenId) != address(0), "Mock: nonexistent");
        return _rarities[tokenId];
    }

    /// @notice TokenView struct for Battle contract compatibility
    struct TokenView {
        uint8 rarity;
        uint8 luck;
        uint8[6] lines;
        uint16 id;
    }

    /// @notice Get token view for Battle contract
    function tokenView(uint256 tokenId) external view returns (TokenView memory) {
        require(ownerOf(tokenId) != address(0), "Mock: nonexistent");
        return TokenView({
            rarity: _rarities[tokenId],
            luck: _lucks[tokenId],
            lines: [uint8(0), 0, 0, 0, 0, 0],
            id: uint16(tokenId)
        });
    }

    /// @notice Seed jackpot for Battle contract
    function seedJackpot(uint256 amount) external {
        require(address(qlwyToken) != address(0), "Mock: token not set");
        qlwyToken.transferFrom(msg.sender, address(this), amount);
        jackpotBalance += amount;
    }

    function refineryBurnFromEscrow(uint256 tokenId) external onlyRefinery {
        require(ownerOf(tokenId) == refinery, "Mock: escrow mismatch");
        _burn(tokenId);
    }

    function mintRefinedFortune(address to, uint8 rarity, uint256, uint256)
        external
        onlyRefinery
        returns (uint256 tokenId)
    {
        tokenId = nextTokenId++;
        _rarities[tokenId] = rarity;
        _lucks[tokenId] = 50;
        _mint(to, tokenId);
    }

    // ============ Cast/Mint mock functions (for AutoCaster testing) ============

    /// @notice Mock requestCast — records cast under msg.sender, returns castId
    function requestCast(bytes calldata /*opts*/)
        external
        payable
        returns (uint256 castId, uint256 requestId)
    {
        require(msg.value == castFee, "Mock: invalid cast fee");
        castId = nextCastId++;
        _casts[castId] = CastData({
            user: msg.sender,
            timestamp: uint40(block.timestamp),
            minted: false,
            ready: false,
            rarity: 0,
            luck: 0
        });
        requestId = castId; // simplified: requestId == castId
    }

    /// @notice Mock: make a cast ready with given rarity (simulates VRF callback)
    function mockFulfillCast(uint256 castId, uint8 rarity, uint8 luck) external {
        CastData storage data = _casts[castId];
        require(data.user != address(0), "Mock: cast not found");
        data.ready = true;
        data.rarity = rarity;
        data.luck = luck;
    }

    /// @notice Mock mintFortuneNFT — mints NFT to msg.sender
    function mintFortuneNFT(uint256 castId)
        external
        payable
        returns (uint256 tokenId)
    {
        CastData storage data = _casts[castId];
        require(data.ready, "Mock: cast not ready");
        require(!data.minted, "Mock: already minted");
        require(data.user == msg.sender, "Mock: not caster");
        require(data.rarity > 0, "Mock: common cannot mint");
        require(msg.value == 0, "Mock: mint requires no BNB");

        uint256 fee = mintFeeForRarity(data.rarity);
        if (fee > 0) {
            qlwyToken.safeTransferFrom(msg.sender, address(this), fee);
        }

        data.minted = true;
        tokenId = nextTokenId++;
        _rarities[tokenId] = data.rarity;
        _lucks[tokenId] = data.luck;
        _safeMint(msg.sender, tokenId);
    }

    /// @notice Get mint fee for a rarity level
    function mintFeeForRarity(uint8 rarity) public view returns (uint256) {
        if (rarity == 0 || rarity > 4) return 0;
        return mintFeeByRarity[rarity - 1];
    }

    /// @notice Get jackpot balance (QLWY balance of this contract)
    function jackpotBalanceOf() external view returns (uint256) {
        if (address(qlwyToken) == address(0)) return 0;
        return qlwyToken.balanceOf(address(this));
    }

    /// @notice Get cast data
    function casts(uint256 castId)
        external
        view
        returns (
            address user, uint40 ts, bool minted,
            Hexagram memory hx, uint8 rarity, bool ready, uint8 luck
        )
    {
        CastData storage data = _casts[castId];
        user = data.user;
        ts = data.timestamp;
        minted = data.minted;
        rarity = data.rarity;
        ready = data.ready;
        luck = data.luck;
        hx = Hexagram({lines: [uint8(0), 0, 0, 0, 0, 0], id: 0});
    }

    /// @notice Set cast fee for testing
    function setCastFee(uint256 fee) external {
        castFee = fee;
    }

    /// @notice Allow receiving BNB
    receive() external payable {}
}

