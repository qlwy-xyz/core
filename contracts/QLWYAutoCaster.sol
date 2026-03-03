// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title IQLWYFortuneCoreCast
 * @notice Minimal interface for FortuneCore cast/mint functions
 */
interface IQLWYFortuneCoreCast {
    function requestCast(bytes calldata opts) external payable returns (uint256 castId, uint256 requestId);
    function mintFortuneNFT(uint256 castId) external payable returns (uint256 tokenId);
    function castFee() external view returns (uint256);
    function mintFeeForRarity(uint8 rarity) external view returns (uint256);
    function jackpotBalanceOf() external view returns (uint256);
    function qlwyToken() external view returns (IERC20);
    function casts(uint256 castId) external view returns (
        address user, uint40 ts, bool minted,
        IQLWYFortuneCoreCast.Hexagram memory hx,
        uint8 rarity, bool ready, uint8 luck
    );

    struct Hexagram {
        uint8[6] lines;
        uint16 id;
    }
}

/**
 * @title QLWYAutoCaster
 * @notice Intermediary contract enabling Spirit Agents to auto-cast and auto-mint
 *         without modifying the deployed QLWYFortuneCore contract.
 *
 * Flow:
 *   1. SpiritLogic calls castFor{value: fee}(beneficiary)
 *      → this contract calls FortuneCore.requestCast{value: fee}()
 *      → cast is registered under this contract's address
 *      → castId is mapped to the beneficiary
 *
 *   2. After VRF callback (cast becomes ready), SpiritLogic calls mintFor(castId)
 *      → this contract calls FortuneCore.mintFortuneNFT(castId)
 *      → NFT is minted to this contract (ERC721Holder)
 *      → NFT is immediately transferred to the beneficiary
 *
 * QLWY mint fee: pulled from beneficiary (requires prior approve to this contract)
 * BNB cast fee: forwarded from SpiritLogic via msg.value
 */
contract QLWYAutoCaster is ERC721Holder, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ State ============

    /// @notice The FortuneCore contract
    IQLWYFortuneCoreCast public immutable fortuneCore;

    /// @notice The FortuneCore NFT (ERC721) — same address, different interface
    IERC721 public immutable fortuneNFT;

    /// @notice Authorized callers (SpiritLogic contracts)
    mapping(address => bool) public authorizedCallers;

    /// @notice castId → beneficiary (who receives the minted NFT)
    mapping(uint256 => address) public castBeneficiary;

    // ============ Events ============

    event CastForRequested(uint256 indexed castId, address indexed beneficiary, uint256 requestId);
    event MintedFor(uint256 indexed castId, uint256 indexed tokenId, address indexed beneficiary);
    event CallerAuthorized(address indexed caller, bool authorized);

    // ============ Errors ============

    error NotAuthorizedCaller();
    error NoBeneficiary();
    error ZeroAddress();

    // ============ Modifiers ============

    modifier onlyAuthorized() {
        if (!authorizedCallers[msg.sender]) revert NotAuthorizedCaller();
        _;
    }

    // ============ Constructor ============

    constructor(address _fortuneCore) Ownable(msg.sender) {
        if (_fortuneCore == address(0)) revert ZeroAddress();
        fortuneCore = IQLWYFortuneCoreCast(_fortuneCore);
        fortuneNFT = IERC721(_fortuneCore);
    }

    // ============ Admin ============

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = authorized;
        emit CallerAuthorized(caller, authorized);
    }

    // ============ Core Functions ============

    /**
     * @notice Request a cast on behalf of a beneficiary
     * @param beneficiary The address that will receive the minted NFT
     * @return castId The cast ID from FortuneCore
     * @return requestId The VRF request ID
     */
    function castFor(address beneficiary)
        external
        payable
        onlyAuthorized
        nonReentrant
        returns (uint256 castId, uint256 requestId)
    {
        if (beneficiary == address(0)) revert ZeroAddress();

        // Forward BNB to FortuneCore as cast fee
        (castId, requestId) = fortuneCore.requestCast{value: msg.value}("");

        // Record who should receive the NFT
        castBeneficiary[castId] = beneficiary;

        emit CastForRequested(castId, beneficiary, requestId);
    }

    /**
     * @notice Mint an NFT for a previously completed cast, transfer to beneficiary
     * @dev QLWY mint fee is pulled from the beneficiary (requires prior approve)
     * @param castId The cast ID to mint
     * @return tokenId The minted token ID
     */
    function mintFor(uint256 castId)
        external
        onlyAuthorized
        nonReentrant
        returns (uint256 tokenId)
    {
        address beneficiary = castBeneficiary[castId];
        if (beneficiary == address(0)) revert NoBeneficiary();

        // Get cast data to determine QLWY fee
        (, , , , uint8 rarity, , ) = fortuneCore.casts(castId);
        uint256 qlwyFee = fortuneCore.mintFeeForRarity(rarity);

        // Pull QLWY from beneficiary and approve FortuneCore
        if (qlwyFee > 0) {
            IERC20 token = fortuneCore.qlwyToken();
            token.safeTransferFrom(beneficiary, address(this), qlwyFee);
            token.approve(address(fortuneCore), qlwyFee);
        }

        // Mint NFT (minted to this contract since we are msg.sender)
        tokenId = fortuneCore.mintFortuneNFT(castId);

        // Transfer NFT to beneficiary
        fortuneNFT.safeTransferFrom(address(this), beneficiary, tokenId);

        // Clean up
        delete castBeneficiary[castId];

        emit MintedFor(castId, tokenId, beneficiary);
    }

    // ============ View Helpers ============

    /// @notice Get the current cast fee from FortuneCore
    function getCastFee() external view returns (uint256) {
        return fortuneCore.castFee();
    }

    /// @notice Get the current jackpot balance from FortuneCore
    function getJackpotBalance() external view returns (uint256) {
        return fortuneCore.jackpotBalanceOf();
    }

    /// @notice Check if a cast is ready to mint
    function isCastReady(uint256 castId) external view returns (bool ready, uint8 rarity) {
        (, , bool minted, , uint8 r, bool isReady, ) = fortuneCore.casts(castId);
        ready = isReady && !minted;
        rarity = r;
    }

    // ============ Receive BNB ============

    /// @notice Allow receiving BNB (for refunds etc.)
    receive() external payable {}
}

