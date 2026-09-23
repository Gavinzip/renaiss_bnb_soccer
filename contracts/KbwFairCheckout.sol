// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title KbwFairCheckout
 * @notice An append-only on-chain commitment and checkout ledger for the KBW
 *         physical-prize machine. ECVRF proofs and prize replay are verified
 *         off-chain, as in the public Renaiss Fair verifier.
 *
 * The transaction containing requestCheckout is the source of the finalized
 * block hash used by renaiss-gacha-v3-1. The contract records its block number
 * but cannot read that transaction's eventual block hash during execution.
 */
contract KbwFairCheckout {
    struct SetRecord {
        bytes32 manifestSha256;
        uint256 totalSlots;
        uint256 checkoutCount;
    }

    struct Checkout {
        uint256 setId;
        bytes32 requestKey;
        uint256 blockNumber;
        address operator;
    }

    error Unauthorized();
    error InvalidInput();
    error SetAlreadyCommitted();
    error SetNotCommitted();
    error SetExhausted();
    error RequestAlreadyUsed();

    bytes32 public immutable packId;
    bytes32 public immutable vrfPublicKey;
    address public owner;
    address public pendingOwner;
    address public operator;
    uint256 public nextCheckoutId = 1;

    // The getter matches the Renaiss Fair root lookup signature.
    mapping(bytes32 => mapping(uint256 => bytes32)) public merkleRoots;
    mapping(uint256 => SetRecord) public sets;
    mapping(uint256 => Checkout) public checkouts;
    mapping(bytes32 => uint256) public checkoutIdForRequest;

    event SetCommitted(
        bytes32 indexed packId,
        uint256 indexed setId,
        bytes32 merkleRoot,
        bytes32 manifestSha256,
        uint256 totalSlots,
        bytes32 vrfPublicKey
    );
    event CheckoutRequested(
        bytes32 indexed packId,
        uint256 indexed setId,
        uint256 indexed checkoutId,
        bytes32 requestKey,
        uint256 blockNumber,
        address operator
    );
    event OperatorChanged(address indexed oldOperator, address indexed newOperator);
    event OwnershipTransferRequested(address indexed oldOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert Unauthorized();
        _;
    }

    constructor(bytes32 packId_, bytes32 vrfPublicKey_, address operator_) {
        if (packId_ == bytes32(0) || vrfPublicKey_ == bytes32(0) || operator_ == address(0)) {
            revert InvalidInput();
        }
        packId = packId_;
        vrfPublicKey = vrfPublicKey_;
        owner = msg.sender;
        operator = operator_;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidInput();
        pendingOwner = newOwner;
        emit OwnershipTransferRequested(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address oldOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, msg.sender);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert InvalidInput();
        address oldOperator = operator;
        operator = newOperator;
        emit OperatorChanged(oldOperator, newOperator);
    }

    /** Root and key must be public before the first checkout. A set cannot be rewritten. */
    function commitSet(
        uint256 setId,
        bytes32 root,
        bytes32 manifestSha256,
        uint256 totalSlots
    ) external onlyOwner {
        if (setId == 0 || root == bytes32(0) || manifestSha256 == bytes32(0) || totalSlots == 0) {
            revert InvalidInput();
        }
        if (merkleRoots[packId][setId] != bytes32(0)) revert SetAlreadyCommitted();
        merkleRoots[packId][setId] = root;
        sets[setId] = SetRecord(manifestSha256, totalSlots, 0);
        emit SetCommitted(packId, setId, root, manifestSha256, totalSlots, vrfPublicKey);
    }

    /**
     * @dev The caller supplies a stable request key so a backend retry can
     *      find its original checkout instead of creating a second draw.
     */
    function requestCheckout(uint256 setId, bytes32 requestKey) external onlyOperator returns (uint256 checkoutId) {
        if (requestKey == bytes32(0)) revert InvalidInput();
        if (checkoutIdForRequest[requestKey] != 0) revert RequestAlreadyUsed();
        if (merkleRoots[packId][setId] == bytes32(0)) revert SetNotCommitted();
        SetRecord storage set = sets[setId];
        if (set.checkoutCount >= set.totalSlots) revert SetExhausted();

        checkoutId = nextCheckoutId++;
        set.checkoutCount++;
        checkoutIdForRequest[requestKey] = checkoutId;
        checkouts[checkoutId] = Checkout(setId, requestKey, block.number, msg.sender);
        emit CheckoutRequested(packId, setId, checkoutId, requestKey, block.number, msg.sender);
    }
}
