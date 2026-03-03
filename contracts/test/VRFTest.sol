// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFCoordinatorV2_5 {
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata request)
        external
        returns (uint256 requestId);
}

/// @title VRFTest - Simple contract to test VRF calls
contract VRFTest {
    IVRFCoordinatorV2_5 public vrfCoordinator;
    bytes32 public vrfKeyHash;
    uint256 public vrfSubId;
    uint16 public vrfMinConfirmations;
    uint32 public vrfCallbackGasLimit;
    
    uint256 public lastRequestId;

    constructor(
        IVRFCoordinatorV2_5 coordinator_,
        bytes32 keyHash_,
        uint256 subId_,
        uint16 minConfirmations_,
        uint32 callbackGasLimit_
    ) {
        vrfCoordinator = coordinator_;
        vrfKeyHash = keyHash_;
        vrfSubId = subId_;
        vrfMinConfirmations = minConfirmations_;
        vrfCallbackGasLimit = callbackGasLimit_;
    }

    function testVRFCall() external returns (uint256 requestId) {
        requestId = vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: vrfKeyHash,
                subId: vrfSubId,
                requestConfirmations: vrfMinConfirmations,
                callbackGasLimit: vrfCallbackGasLimit,
                numWords: 2,
                extraArgs: VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({nativePayment: true})
                )
            })
        );
        lastRequestId = requestId;
    }

    function rawFulfillRandomWords(uint256, uint256[] memory) external {
        // Do nothing, just accept the callback
    }
}

