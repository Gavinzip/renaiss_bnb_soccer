// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

abstract contract VRFConsumerBase {
    address private immutable i_vrfCoordinator;

    constructor(address vrfCoordinator) {
        i_vrfCoordinator = vrfCoordinator;
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal virtual;

    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != i_vrfCoordinator) revert("OnlyCoordinatorCanFulfill");
        fulfillRandomWords(requestId, randomWords);
    }
}
