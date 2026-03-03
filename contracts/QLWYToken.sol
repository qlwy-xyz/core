// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QLWYToken
/// @notice ERC20 token for the 潜龙勿用 ecosystem with configurable minters.
contract QLWYToken is ERC20, ERC20Burnable, Ownable {
    mapping(address => bool) public minters;

    event MinterUpdated(address indexed account, bool allowed);

    modifier onlyMinter() {
        require(minters[msg.sender] || msg.sender == owner(), "QLWYToken: not minter");
        _;
    }

    constructor(string memory name_, string memory symbol_, uint256 initialSupply, address owner_)
        ERC20(name_, symbol_)
        Ownable(owner_)
    {
        _mint(owner_, initialSupply);
    }

    /// @notice Grant or revoke minter permissions.
    function setMinter(address account, bool allowed) external onlyOwner {
        minters[account] = allowed;
        emit MinterUpdated(account, allowed);
    }

    /// @notice Mint tokens to the given address.
    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }
}
