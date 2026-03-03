// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRefinery {
    function fortuneCore() external view returns (address);
    function qlwyToken() external view returns (address);
    function vrfCoordinator() external view returns (address);
    function vrfSubId() external view returns (uint256);
    function refineFees(uint256 index) external view returns (uint256);
    function paused() external view returns (bool);
}

interface ICore {
    function ownerOf(uint256 tokenId) external view returns (address);
    function tokenRarityOf(uint256 tokenId) external view returns (uint8);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function safeTransferFrom(address from, address to, uint256 tokenId) external;
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IVRFCoordinator {
    function getSubscription(uint256 subId) external view returns (
        uint96 balance,
        uint96 nativeBalance,
        uint64 reqCount,
        address subOwner,
        address[] memory consumers
    );
}

/// @title RefineDebug - Debug contract to test refine step by step
contract RefineDebug {
    
    struct DebugResult {
        bool step1_paused;
        bool step2_nftOwnership;
        bool step3_nftRarity;
        bool step4_nftApproval;
        bool step5_qlwyBalance;
        bool step6_qlwyAllowance;
        bool step7_vrfConsumer;
        uint8 baseRarity;
        uint256 requiredFee;
        uint256 userQlwyBalance;
        uint256 userQlwyAllowance;
        string failReason;
    }
    
    function debug(
        address refinery,
        address user,
        uint256[] calldata tokenIds
    ) external view returns (DebugResult memory result) {
        IRefinery ref = IRefinery(refinery);
        
        // Step 1: Check paused
        result.step1_paused = !ref.paused();
        if (ref.paused()) {
            result.failReason = "Contract is paused";
            return result;
        }
        
        ICore core = ICore(ref.fortuneCore());
        
        // Step 2: Check NFT ownership
        result.step2_nftOwnership = true;
        for (uint256 i = 0; i < tokenIds.length; i++) {
            if (core.ownerOf(tokenIds[i]) != user) {
                result.step2_nftOwnership = false;
                result.failReason = string(abi.encodePacked("User does not own token ", tokenIds[i]));
                return result;
            }
        }
        
        // Step 3: Check NFT rarity
        result.baseRarity = core.tokenRarityOf(tokenIds[0]);
        result.step3_nftRarity = true;
        
        if (result.baseRarity == 0 || result.baseRarity >= 4) {
            result.step3_nftRarity = false;
            result.failReason = "Base rarity not supported (must be 1-3)";
            return result;
        }
        
        for (uint256 i = 1; i < tokenIds.length; i++) {
            if (core.tokenRarityOf(tokenIds[i]) != result.baseRarity) {
                result.step3_nftRarity = false;
                result.failReason = "NFTs have different rarities";
                return result;
            }
        }
        
        // Step 4: Check NFT approval
        result.step4_nftApproval = core.isApprovedForAll(user, refinery);
        if (!result.step4_nftApproval) {
            result.failReason = "NFTs not approved for Refinery";
            return result;
        }
        
        // Step 5: Check QLWY balance
        IERC20 qlwy = IERC20(ref.qlwyToken());
        result.requiredFee = ref.refineFees(result.baseRarity - 1);
        result.userQlwyBalance = qlwy.balanceOf(user);
        result.step5_qlwyBalance = result.userQlwyBalance >= result.requiredFee;
        if (!result.step5_qlwyBalance) {
            result.failReason = "Insufficient QLWY balance";
            return result;
        }
        
        // Step 6: Check QLWY allowance
        result.userQlwyAllowance = qlwy.allowance(user, refinery);
        result.step6_qlwyAllowance = result.userQlwyAllowance >= result.requiredFee;
        if (!result.step6_qlwyAllowance) {
            result.failReason = "Insufficient QLWY allowance";
            return result;
        }
        
        // Step 7: Check VRF consumer
        IVRFCoordinator vrf = IVRFCoordinator(ref.vrfCoordinator());
        uint256 subId = ref.vrfSubId();
        try vrf.getSubscription(subId) returns (
            uint96, uint96, uint64, address, address[] memory consumers
        ) {
            result.step7_vrfConsumer = false;
            for (uint256 i = 0; i < consumers.length; i++) {
                if (consumers[i] == refinery) {
                    result.step7_vrfConsumer = true;
                    break;
                }
            }
            if (!result.step7_vrfConsumer) {
                result.failReason = "Refinery is not a VRF consumer";
                return result;
            }
        } catch {
            result.failReason = "Failed to query VRF subscription";
            return result;
        }
        
        // All checks passed
        result.failReason = "All checks passed - issue may be in VRF requestRandomWords call";
    }
}

