// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface MockVrfConsumer {
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external;
}

contract MockVrfCoordinator {
    uint256 public nextRequestId = 1;
    address public lastConsumer;

    function requestRandomWords(
        bytes32,
        uint64,
        uint16,
        uint32,
        uint32
    ) external returns (uint256 requestId) {
        requestId = nextRequestId;
        nextRequestId++;
        lastConsumer = msg.sender;
    }

    function fulfill(address consumer, uint256 requestId, uint256 randomWord) external {
        uint256[] memory words = new uint256[](1);
        words[0] = randomWord;
        MockVrfConsumer(consumer).rawFulfillRandomWords(requestId, words);
    }
}
