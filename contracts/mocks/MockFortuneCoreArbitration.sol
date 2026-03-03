// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Minimal mock of QLWYFortuneCore for testing QLWYPredictionArbitration.
///         Supports mintWithRarity, tokenRarityOf, mythicMintedCount, mythicTokenIds.
contract MockFortuneCoreArbitration is ERC721 {
    uint256 public nextTokenId = 1;
    mapping(uint256 => uint8) private _rarities;

    uint256[] private _mythicTokenIds;
    uint256 public mythicMintedCount;

    constructor() ERC721("MockFortune", "MFORT") {}

    /// @notice Mint a token with specified rarity
    function mintWithRarity(address to, uint8 rarity) external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _rarities[tokenId] = rarity;
        _mint(to, tokenId);

        // Track mythic tokens (rarity == 4)
        if (rarity == 4) {
            _mythicTokenIds.push(tokenId);
            mythicMintedCount++;
        }
    }

    function tokenRarityOf(uint256 tokenId) external view returns (uint8) {
        require(ownerOf(tokenId) != address(0), "Mock: nonexistent");
        return _rarities[tokenId];
    }

    function mythicTokenIds(uint256 index) external view returns (uint256) {
        return _mythicTokenIds[index];
    }
}

