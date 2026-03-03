// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external;
}

/// @notice Simplified VRF coordinator mock for local testing.
/// Supports both V2.5 (Chainlink) and Binance Oracle VRF interfaces.
contract VRFCoordinatorMock {
    uint256 public nextRequestId = 1;

    struct Request {
        address requester;
        uint32 numWords;
    }

    mapping(uint256 => Request) public requests;

    event RandomWordsFulfilled(uint256 indexed requestId, address indexed consumer);

    /// @notice V2.5 style request (used by QLWYFortuneCore)
    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata request)
        external
        returns (uint256 requestId)
    {
        requestId = nextRequestId++;
        requests[requestId] = Request({requester: msg.sender, numWords: request.numWords});
    }

    /// @notice Binance Oracle VRF style request (used by QLWYRefinery and QLWYBattle)
    function requestRandomWords(
        bytes32, // keyHash
        uint64,  // subId
        uint16,  // minimumRequestConfirmations
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = Request({requester: msg.sender, numWords: numWords});
    }

    function fulfillRandomWords(uint256 requestId, address consumer, uint256[] calldata randomWords) external {
        Request memory req = requests[requestId];
        require(req.requester != address(0), "VRFMock: invalid");
        uint32 numWords = req.numWords;
        delete requests[requestId];

        uint256[] memory words;
        if (randomWords.length == 0) {
            words = new uint256[](numWords);
            for (uint256 i = 0; i < numWords; i++) {
                words[i] = uint256(keccak256(abi.encodePacked(block.timestamp, requestId, i)));
            }
        } else {
            require(randomWords.length == numWords, "VRFMock: words length");
            words = new uint256[](numWords);
            for (uint256 i = 0; i < numWords; i++) {
                words[i] = randomWords[i];
            }
        }
        IVRFConsumer(consumer).rawFulfillRandomWords(requestId, words);
        emit RandomWordsFulfilled(requestId, consumer);
    }
}
