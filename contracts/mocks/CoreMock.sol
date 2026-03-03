// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IQLWYFortuneCoreView {
    struct TokenView {
        uint8 rarity;
        uint8 luck;
        uint8[6] lines;
        uint16 id;
    }

    function tokenView(uint256 tokenId) external view returns (TokenView memory);
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

contract CoreMock is IQLWYFortuneCoreView {
    function tokenView(uint256 tokenId) external pure override returns (TokenView memory v) {
        // tokenId → 卦象 id 循环 0~63
        v.id = uint16(tokenId % 64);

        // 稀有度 0~4 循环
        v.rarity = uint8(tokenId % 5);

        // luck 0~100 循环
        v.luck = uint8((tokenId * 37) % 101);

        // lines 伪随机
        uint256 seed = uint256(keccak256(abi.encodePacked(tokenId)));
        for (uint8 i = 0; i < 6; i++) {
            v.lines[i] = uint8((seed >> (i * 4)) & 3); // 0-3 对应少阴、少阳、老阴、老阳
        }
    }

    function tokenURI(uint256) external pure override returns (string memory) {
        return "mock";
    }
}