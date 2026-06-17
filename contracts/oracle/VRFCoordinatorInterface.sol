// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface VRFCoordinatorInterface {
    function getRequestConfig() external view returns (uint16 minimumRequestConfirmations, uint32 maxGasLimit, bytes32[] memory provingKeyHashes);

    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);

    function createSubscription() external returns (uint64 subId);

    function deposit(uint64 subId) external payable;

    function getSubscription(uint64 subId)
        external
        view
        returns (uint96 balance, uint64 reqCount, address owner, address[] memory consumers);

    function addConsumer(uint64 subId, address consumer) external;

    function removeConsumer(uint64 subId, address consumer) external;

    function pendingRequestExists(uint64 subId) external view returns (bool);
}
