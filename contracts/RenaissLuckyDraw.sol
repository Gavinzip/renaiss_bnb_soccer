// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VRFConsumerBase} from "./oracle/VRFConsumerBase.sol";
import {VRFCoordinatorInterface} from "./oracle/VRFCoordinatorInterface.sol";

contract RenaissLuckyDraw is VRFConsumerBase {
    enum DrawState {
        Draft,
        LedgerFinalized,
        RandomnessRequested,
        RandomnessReady,
        Fulfilled
    }

    struct VrfConfig {
        bytes32 keyHash;
        uint64 subscriptionId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
    }

    struct Draw {
        bytes32 ledgerHash;
        string ledgerUri;
        uint256 totalTickets;
        uint256 prizeSlotCount;
        uint256 requestId;
        uint256 randomWord;
        DrawState state;
        uint256[] winnerTicketsBySlot;
        uint256[] revealedPrizeSlots;
        uint256[] revealedTickets;
        uint256[] allComputedTickets;
        bool[] prizeSlotRevealed;
        uint256 computedPrizeSlotCount;
    }

    struct RoundMatchInput {
        bytes32 matchId;
        bytes32 ledgerHash;
        uint256 totalTickets;
        uint256 prizeSlotCount;
        uint256 alternateCount;
        string ledgerUri;
    }

    struct RoundMatchDraw {
        bytes32 ledgerHash;
        string ledgerUri;
        uint256 totalTickets;
        uint256 prizeSlotCount;
        uint256 alternateCount;
        bool revealed;
        uint256[] winnerTicketsBySlot;
        uint256[][] alternateTicketsBySlot;
        uint256[] allComputedTickets;
    }

    struct RoundDraw {
        bytes32 ledgerHash;
        string ledgerUri;
        uint256 requestId;
        uint256 randomWord;
        DrawState state;
        bytes32[] matchIds;
        uint256 revealedMatchCount;
        mapping(bytes32 => bool) knownMatches;
        mapping(bytes32 => RoundMatchDraw) matches;
    }

    uint256 public constant MIN_ALTERNATE_COUNT = 2;
    uint256 public constant MAX_ALTERNATE_COUNT = 16;
    address public drawOperator;
    address public immutable vrfCoordinatorAddress;
    address private s_owner;
    address private s_pendingOwner;
    mapping(address => bool) private s_admins;
    VrfConfig public vrfConfig;
    uint256 public defaultPrizeSlotCount;

    mapping(bytes32 => Draw) private s_draws;
    mapping(bytes32 => bool) private s_knownDrawIds;
    bytes32[] private s_drawIds;
    mapping(uint256 => bytes32) private s_drawIdByRequestId;
    mapping(bytes32 => RoundDraw) private s_rounds;
    mapping(bytes32 => bool) private s_knownRoundIds;
    bytes32[] private s_roundIds;
    mapping(uint256 => bytes32) private s_roundIdByRequestId;

    event DrawOperatorChanged(address indexed operator);
    event DrawAdminChanged(address indexed admin, bool allowed);
    event DefaultPrizeSlotCountChanged(uint256 prizeSlotCount);
    event VrfConfigUpdated(
        bytes32 indexed keyHash,
        uint256 indexed subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    );
    event LedgerFinalized(
        bytes32 indexed drawId,
        bytes32 indexed ledgerHash,
        uint256 totalTickets,
        uint256 prizeSlotCount,
        string ledgerUri
    );
    event DrawRequested(bytes32 indexed drawId, uint256 indexed requestId, address indexed caller);
    event RandomnessFulfilled(bytes32 indexed drawId, uint256 indexed requestId, uint256 randomWord);
    event WinnerDrawn(bytes32 indexed drawId, uint256 indexed slotIndex, uint256 ticketNumber);
    event PrizeWinnerDrawn(
        bytes32 indexed drawId,
        uint256 indexed revealIndex,
        uint256 indexed prizeSlotIndex,
        uint256 ticketNumber
    );
    event DrawFulfilled(bytes32 indexed drawId, uint256 indexed requestId, uint256 randomWord, uint256[] winnerTickets);
    event RoundReset(bytes32 indexed drawId);
    event RoundLedgerFinalized(
        bytes32 indexed roundId,
        bytes32 indexed ledgerHash,
        uint256 matchCount,
        string ledgerUri
    );
    event RoundDrawRequested(bytes32 indexed roundId, uint256 indexed requestId, address indexed caller);
    event RoundRandomnessFulfilled(bytes32 indexed roundId, uint256 indexed requestId, uint256 randomWord);
    event RoundMatchPrizeWinnerDrawn(
        bytes32 indexed roundId,
        bytes32 indexed matchId,
        uint256 indexed revealIndex,
        uint256 prizeSlotIndex,
        uint256 ticketNumber
    );
    event RoundMatchPrizeAlternateDrawn(
        bytes32 indexed roundId,
        bytes32 indexed matchId,
        uint256 indexed revealIndex,
        uint256 prizeSlotIndex,
        uint256 alternateIndex,
        uint256 ticketNumber
    );
    event RoundMatchRevealed(bytes32 indexed roundId, bytes32 indexed matchId, uint256 revealIndex);
    event RoundDrawFulfilled(bytes32 indexed roundId, uint256 indexed requestId, uint256 randomWord);
    event RoundDrawReset(bytes32 indexed roundId);
    event OwnershipTransferRequested(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotDrawAdmin();
    error InvalidAddress();
    error InvalidState();
    error InvalidLedger();
    error InvalidPrizeSlots();
    error InvalidRequest();
    error InvalidVrfConfig();
    error InvalidDrawId();
    error NotOwner();

    modifier onlyDrawAdmin() {
        if (!_isDrawAdmin(msg.sender)) revert NotDrawAdmin();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != s_owner) revert NotOwner();
        _;
    }

    constructor(
        address vrfCoordinator,
        bytes32 keyHash,
        uint64 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint256 initialPrizeSlotCount
    ) VRFConsumerBase(vrfCoordinator) {
        if (vrfCoordinator == address(0)) revert InvalidAddress();
        vrfCoordinatorAddress = vrfCoordinator;
        s_owner = msg.sender;
        drawOperator = msg.sender;
        _setVrfConfig(keyHash, subscriptionId, requestConfirmations, callbackGasLimit);
        _setDefaultPrizeSlotCount(initialPrizeSlotCount);
        emit OwnershipTransferred(address(0), msg.sender);
        emit DrawOperatorChanged(msg.sender);
    }

    function owner() public view returns (address) {
        return s_owner;
    }

    function pendingOwner() external view returns (address) {
        return s_pendingOwner;
    }

    function isAdmin(address account) public view returns (bool) {
        return _isDrawAdmin(account);
    }

    function drawIds() external view returns (bytes32[] memory) {
        return s_drawIds;
    }

    function roundIds() external view returns (bytes32[] memory) {
        return s_roundIds;
    }

    function roundMatchIds(bytes32 roundId) external view returns (bytes32[] memory) {
        return s_rounds[roundId].matchIds;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        s_pendingOwner = newOwner;
        emit OwnershipTransferRequested(s_owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != s_pendingOwner) revert InvalidAddress();
        address previousOwner = s_owner;
        s_owner = msg.sender;
        s_pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function setDrawOperator(address operator) external onlyOwner {
        if (operator == address(0)) revert InvalidAddress();
        drawOperator = operator;
        emit DrawOperatorChanged(operator);
    }

    function setAdmin(address admin, bool allowed) external onlyOwner {
        if (admin == address(0)) revert InvalidAddress();
        s_admins[admin] = allowed;
        emit DrawAdminChanged(admin, allowed);
    }

    function setDefaultPrizeSlotCount(uint256 newPrizeSlotCount) external onlyOwner {
        _setDefaultPrizeSlotCount(newPrizeSlotCount);
    }

    function setVrfConfig(
        bytes32 keyHash,
        uint64 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    ) external onlyOwner {
        _setVrfConfig(keyHash, subscriptionId, requestConfirmations, callbackGasLimit);
    }

    function finalizeLedger(
        bytes32 drawId,
        bytes32 newLedgerHash,
        uint256 newTotalTickets,
        uint256 newPrizeSlotCount,
        string calldata newLedgerUri
    ) external onlyDrawAdmin {
        _validateDrawId(drawId);
        Draw storage draw = s_draws[drawId];
        if (draw.state != DrawState.Draft && draw.state != DrawState.LedgerFinalized) revert InvalidState();
        if (newLedgerHash == bytes32(0) || newTotalTickets == 0) revert InvalidLedger();
        _validatePrizeSlotCount(newPrizeSlotCount);
        if (newTotalTickets < newPrizeSlotCount) revert InvalidPrizeSlots();

        _rememberDrawId(drawId);
        _resetWinnerStorage(draw);
        draw.ledgerHash = newLedgerHash;
        draw.totalTickets = newTotalTickets;
        draw.prizeSlotCount = newPrizeSlotCount;
        draw.ledgerUri = newLedgerUri;
        draw.randomWord = 0;
        draw.requestId = 0;
        draw.state = DrawState.LedgerFinalized;
        emit LedgerFinalized(drawId, newLedgerHash, newTotalTickets, newPrizeSlotCount, newLedgerUri);
    }

    function resetDraft(bytes32 drawId) external onlyDrawAdmin {
        _validateDrawId(drawId);
        Draw storage draw = s_draws[drawId];
        if (draw.state == DrawState.RandomnessRequested) revert InvalidState();
        _resetWinnerStorage(draw);
        draw.ledgerHash = bytes32(0);
        draw.ledgerUri = "";
        draw.totalTickets = 0;
        draw.prizeSlotCount = 0;
        draw.requestId = 0;
        draw.randomWord = 0;
        draw.state = DrawState.Draft;
        emit RoundReset(drawId);
    }

    function finalizeRoundLedger(
        bytes32 roundId,
        bytes32 newRoundLedgerHash,
        RoundMatchInput[] calldata matchInputs,
        string calldata newRoundLedgerUri
    ) external onlyDrawAdmin {
        _validateDrawId(roundId);
        if (newRoundLedgerHash == bytes32(0) || matchInputs.length == 0) revert InvalidLedger();

        RoundDraw storage round = s_rounds[roundId];
        if (round.state != DrawState.Draft && round.state != DrawState.LedgerFinalized) revert InvalidState();

        _rememberRoundId(roundId);
        _resetRoundStorage(round);
        round.ledgerHash = newRoundLedgerHash;
        round.ledgerUri = newRoundLedgerUri;
        round.randomWord = 0;
        round.requestId = 0;
        round.revealedMatchCount = 0;

        for (uint256 index = 0; index < matchInputs.length; index++) {
            RoundMatchInput calldata input = matchInputs[index];
            _validateRoundMatchInput(round, input);

            round.knownMatches[input.matchId] = true;
            round.matchIds.push(input.matchId);

            RoundMatchDraw storage matchDraw = round.matches[input.matchId];
            matchDraw.ledgerHash = input.ledgerHash;
            matchDraw.ledgerUri = input.ledgerUri;
            matchDraw.totalTickets = input.totalTickets;
            matchDraw.prizeSlotCount = input.prizeSlotCount;
            matchDraw.alternateCount = input.alternateCount;
            matchDraw.revealed = false;
        }

        round.state = DrawState.LedgerFinalized;
        emit RoundLedgerFinalized(roundId, newRoundLedgerHash, matchInputs.length, newRoundLedgerUri);
    }

    function resetRoundDraft(bytes32 roundId) external onlyDrawAdmin {
        _validateDrawId(roundId);
        RoundDraw storage round = s_rounds[roundId];
        if (round.state == DrawState.RandomnessRequested) revert InvalidState();
        _resetRoundStorage(round);
        round.ledgerHash = bytes32(0);
        round.ledgerUri = "";
        round.requestId = 0;
        round.randomWord = 0;
        round.revealedMatchCount = 0;
        round.state = DrawState.Draft;
        emit RoundDrawReset(roundId);
    }

    function requestDraw(bytes32 drawId) external onlyDrawAdmin returns (uint256 newRequestId) {
        _validateDrawId(drawId);
        Draw storage draw = s_draws[drawId];
        if (draw.state != DrawState.LedgerFinalized) revert InvalidState();
        VrfConfig memory config = vrfConfig;
        if (config.keyHash == bytes32(0) || config.subscriptionId == 0 || config.callbackGasLimit == 0) {
            revert InvalidVrfConfig();
        }

        newRequestId = VRFCoordinatorInterface(vrfCoordinatorAddress).requestRandomWords(
            config.keyHash,
            config.subscriptionId,
            config.requestConfirmations,
            config.callbackGasLimit,
            1
        );
        draw.requestId = newRequestId;
        draw.state = DrawState.RandomnessRequested;
        s_drawIdByRequestId[newRequestId] = drawId;
        emit DrawRequested(drawId, newRequestId, msg.sender);
    }

    function requestRoundDraw(bytes32 roundId) external onlyDrawAdmin returns (uint256 newRequestId) {
        _validateDrawId(roundId);
        RoundDraw storage round = s_rounds[roundId];
        if (round.state != DrawState.LedgerFinalized) revert InvalidState();
        if (round.matchIds.length == 0 || round.ledgerHash == bytes32(0)) revert InvalidLedger();
        VrfConfig memory config = vrfConfig;
        if (config.keyHash == bytes32(0) || config.subscriptionId == 0 || config.callbackGasLimit == 0) {
            revert InvalidVrfConfig();
        }

        newRequestId = VRFCoordinatorInterface(vrfCoordinatorAddress).requestRandomWords(
            config.keyHash,
            config.subscriptionId,
            config.requestConfirmations,
            config.callbackGasLimit,
            1
        );
        round.requestId = newRequestId;
        round.state = DrawState.RandomnessRequested;
        s_roundIdByRequestId[newRequestId] = roundId;
        emit RoundDrawRequested(roundId, newRequestId, msg.sender);
    }

    function fulfillRandomWords(uint256 fulfilledRequestId, uint256[] memory randomWords) internal override {
        bytes32 roundId = s_roundIdByRequestId[fulfilledRequestId];
        if (roundId != bytes32(0)) {
            RoundDraw storage round = s_rounds[roundId];
            if (round.state != DrawState.RandomnessRequested || fulfilledRequestId != round.requestId) {
                revert InvalidRequest();
            }
            if (randomWords.length == 0) revert InvalidRequest();

            round.randomWord = randomWords[0];
            round.revealedMatchCount = 0;
            round.state = DrawState.RandomnessReady;
            emit RoundRandomnessFulfilled(roundId, fulfilledRequestId, randomWords[0]);
            return;
        }

        bytes32 drawId = s_drawIdByRequestId[fulfilledRequestId];
        if (drawId == bytes32(0)) revert InvalidRequest();
        Draw storage draw = s_draws[drawId];
        if (draw.state != DrawState.RandomnessRequested || fulfilledRequestId != draw.requestId) revert InvalidRequest();
        if (randomWords.length == 0) revert InvalidRequest();

        draw.randomWord = randomWords[0];
        _resetWinnerStorage(draw);
        draw.state = DrawState.RandomnessReady;
        emit RandomnessFulfilled(drawId, fulfilledRequestId, randomWords[0]);
    }

    function drawNext(bytes32 drawId) external onlyDrawAdmin returns (uint256 ticketNumber) {
        Draw storage draw = _readyDraw(drawId);
        uint256 prizeSlotIndex = _nextUnrevealedPrizeSlot(draw);
        ticketNumber = _drawPrizeSlot(drawId, draw, prizeSlotIndex);
        _completeIfFulfilled(drawId, draw);
    }

    function drawBatch(bytes32 drawId, uint256 count) external onlyDrawAdmin returns (uint256[] memory ticketNumbers) {
        Draw storage draw = _readyDraw(drawId);
        if (count == 0) revert InvalidPrizeSlots();

        uint256 remainingSlots = draw.prizeSlotCount - draw.revealedPrizeSlots.length;
        if (count > remainingSlots) revert InvalidPrizeSlots();

        ticketNumbers = new uint256[](count);
        for (uint256 index = 0; index < count; index++) {
            uint256 prizeSlotIndex = _nextUnrevealedPrizeSlot(draw);
            ticketNumbers[index] = _drawPrizeSlot(drawId, draw, prizeSlotIndex);
        }

        _completeIfFulfilled(drawId, draw);
    }

    function drawPrizeSlot(bytes32 drawId, uint256 prizeSlotIndex) external onlyDrawAdmin returns (uint256 ticketNumber) {
        Draw storage draw = _readyDraw(drawId);
        ticketNumber = _drawPrizeSlot(drawId, draw, prizeSlotIndex);
        _completeIfFulfilled(drawId, draw);
    }

    function drawPrizeSlots(bytes32 drawId, uint256[] calldata prizeSlotIndexes)
        external
        onlyDrawAdmin
        returns (uint256[] memory ticketNumbers)
    {
        Draw storage draw = _readyDraw(drawId);
        if (prizeSlotIndexes.length == 0) revert InvalidPrizeSlots();
        if (prizeSlotIndexes.length > draw.prizeSlotCount - draw.revealedPrizeSlots.length) revert InvalidPrizeSlots();

        ticketNumbers = new uint256[](prizeSlotIndexes.length);
        for (uint256 index = 0; index < prizeSlotIndexes.length; index++) {
            ticketNumbers[index] = _drawPrizeSlot(drawId, draw, prizeSlotIndexes[index]);
        }

        _completeIfFulfilled(drawId, draw);
    }

    function drawRandomPrizeSlot(bytes32 drawId)
        external
        onlyDrawAdmin
        returns (uint256 prizeSlotIndex, uint256 ticketNumber)
    {
        Draw storage draw = _readyDraw(drawId);
        prizeSlotIndex = _randomUnrevealedPrizeSlot(drawId, draw);
        ticketNumber = _drawPrizeSlot(drawId, draw, prizeSlotIndex);
        _completeIfFulfilled(drawId, draw);
    }

    function revealRoundMatch(bytes32 roundId, bytes32 matchId) external onlyDrawAdmin {
        RoundDraw storage round = _readyRound(roundId);
        _revealRoundMatch(roundId, round, matchId);
    }

    function revealRoundMatches(bytes32 roundId, bytes32[] calldata matchIds) external onlyDrawAdmin {
        RoundDraw storage round = _readyRound(roundId);
        if (matchIds.length == 0) revert InvalidLedger();
        for (uint256 index = 0; index < matchIds.length; index++) {
            _revealRoundMatch(roundId, round, matchIds[index]);
        }
    }

    function state(bytes32 drawId) external view returns (DrawState) {
        return s_draws[drawId].state;
    }

    function ledgerHash(bytes32 drawId) external view returns (bytes32) {
        return s_draws[drawId].ledgerHash;
    }

    function ledgerUri(bytes32 drawId) external view returns (string memory) {
        return s_draws[drawId].ledgerUri;
    }

    function totalTickets(bytes32 drawId) external view returns (uint256) {
        return s_draws[drawId].totalTickets;
    }

    function prizeSlotCount(bytes32 drawId) external view returns (uint256) {
        return s_draws[drawId].prizeSlotCount;
    }

    function requestId(bytes32 drawId) external view returns (uint256) {
        return s_draws[drawId].requestId;
    }

    function randomWord(bytes32 drawId) external view returns (uint256) {
        return s_draws[drawId].randomWord;
    }

    function winnerTickets(bytes32 drawId) external view returns (uint256[] memory) {
        return s_draws[drawId].revealedTickets;
    }

    function winnerTicket(bytes32 drawId, uint256 index) external view returns (uint256) {
        return s_draws[drawId].revealedTickets[index];
    }

    function revealedPrizeSlots(bytes32 drawId) external view returns (uint256[] memory) {
        return s_draws[drawId].revealedPrizeSlots;
    }

    function revealedTickets(bytes32 drawId) external view returns (uint256[] memory) {
        return s_draws[drawId].revealedTickets;
    }

    function winnerTicketsBySlot(bytes32 drawId) external view returns (uint256[] memory ticketsBySlot) {
        Draw storage draw = s_draws[drawId];
        ticketsBySlot = new uint256[](draw.prizeSlotCount);
        for (uint256 index = 0; index < draw.prizeSlotCount; index++) {
            if (index < draw.prizeSlotRevealed.length && draw.prizeSlotRevealed[index]) {
                ticketsBySlot[index] = draw.winnerTicketsBySlot[index];
            }
        }
    }

    function winnerTicketBySlot(bytes32 drawId, uint256 prizeSlotIndex) external view returns (uint256) {
        Draw storage draw = s_draws[drawId];
        if (prizeSlotIndex >= draw.prizeSlotCount) revert InvalidPrizeSlots();
        if (prizeSlotIndex >= draw.prizeSlotRevealed.length || !draw.prizeSlotRevealed[prizeSlotIndex]) return 0;
        return draw.winnerTicketsBySlot[prizeSlotIndex];
    }

    function roundStatus(bytes32 drawId)
        external
        view
        returns (
            bool finalized,
            bool requested,
            bool fulfilled,
            uint256 currentTotalTickets,
            uint256 firstWinningTicket,
            bytes32 currentLedgerHash,
            uint256 currentPrizeSlotCount,
            uint256 winnerCount
        )
    {
        Draw storage draw = s_draws[drawId];
        return (
            draw.state >= DrawState.LedgerFinalized,
            draw.state >= DrawState.RandomnessRequested,
            draw.state == DrawState.Fulfilled,
            draw.totalTickets,
            draw.revealedTickets.length > 0 ? draw.revealedTickets[0] : 0,
            draw.ledgerHash,
            draw.prizeSlotCount,
            draw.revealedPrizeSlots.length
        );
    }

    function roundDrawStatus(bytes32 roundId)
        external
        view
        returns (
            bool finalized,
            bool requested,
            bool randomnessReady,
            bool fulfilled,
            bytes32 currentLedgerHash,
            uint256 requestIdValue,
            uint256 matchCount,
            uint256 revealedMatchCount
        )
    {
        RoundDraw storage round = s_rounds[roundId];
        return (
            round.state >= DrawState.LedgerFinalized,
            round.state >= DrawState.RandomnessRequested,
            round.state >= DrawState.RandomnessReady,
            round.state == DrawState.Fulfilled,
            round.ledgerHash,
            round.requestId,
            round.matchIds.length,
            round.revealedMatchCount
        );
    }

    function roundMatchStatus(bytes32 roundId, bytes32 matchId)
        external
        view
        returns (
            bytes32 currentLedgerHash,
            string memory currentLedgerUri,
            uint256 currentTotalTickets,
            uint256 currentPrizeSlotCount,
            uint256 currentAlternateCount,
            bool revealed
        )
    {
        RoundMatchDraw storage matchDraw = s_rounds[roundId].matches[matchId];
        return (
            matchDraw.ledgerHash,
            matchDraw.ledgerUri,
            matchDraw.totalTickets,
            matchDraw.prizeSlotCount,
            matchDraw.alternateCount,
            matchDraw.revealed
        );
    }

    function roundMatchWinnerTicketsBySlot(bytes32 roundId, bytes32 matchId)
        external
        view
        returns (uint256[] memory)
    {
        return s_rounds[roundId].matches[matchId].winnerTicketsBySlot;
    }

    function roundMatchAlternateTicketsBySlot(bytes32 roundId, bytes32 matchId, uint256 prizeSlotIndex)
        external
        view
        returns (uint256[] memory)
    {
        RoundMatchDraw storage matchDraw = s_rounds[roundId].matches[matchId];
        if (prizeSlotIndex >= matchDraw.alternateTicketsBySlot.length) revert InvalidPrizeSlots();
        return matchDraw.alternateTicketsBySlot[prizeSlotIndex];
    }

    function roundMatchAlternateTicketsFlat(bytes32 roundId, bytes32 matchId)
        external
        view
        returns (uint256[] memory tickets)
    {
        RoundMatchDraw storage matchDraw = s_rounds[roundId].matches[matchId];
        uint256 totalAlternates = matchDraw.prizeSlotCount * matchDraw.alternateCount;
        tickets = new uint256[](totalAlternates);
        uint256 cursor = 0;
        for (uint256 slotIndex = 0; slotIndex < matchDraw.alternateTicketsBySlot.length; slotIndex++) {
            for (
                uint256 alternateIndex = 0;
                alternateIndex < matchDraw.alternateTicketsBySlot[slotIndex].length;
                alternateIndex++
            ) {
                tickets[cursor] = matchDraw.alternateTicketsBySlot[slotIndex][alternateIndex];
                cursor++;
            }
        }
    }

    function _readyDraw(bytes32 drawId) internal view returns (Draw storage draw) {
        _validateDrawId(drawId);
        draw = s_draws[drawId];
        if (draw.state != DrawState.RandomnessReady) revert InvalidState();
    }

    function _readyRound(bytes32 roundId) internal view returns (RoundDraw storage round) {
        _validateDrawId(roundId);
        round = s_rounds[roundId];
        if (round.state != DrawState.RandomnessReady) revert InvalidState();
    }

    function _revealRoundMatch(bytes32 roundId, RoundDraw storage round, bytes32 matchId) internal {
        if (!round.knownMatches[matchId]) revert InvalidLedger();
        RoundMatchDraw storage matchDraw = round.matches[matchId];
        if (matchDraw.revealed) revert InvalidState();

        uint256 revealIndex = round.revealedMatchCount;
        _computeRoundMatchTickets(roundId, round, matchId, matchDraw);

        matchDraw.revealed = true;
        round.revealedMatchCount++;

        for (uint256 slotIndex = 0; slotIndex < matchDraw.prizeSlotCount; slotIndex++) {
            emit RoundMatchPrizeWinnerDrawn(
                roundId,
                matchId,
                revealIndex,
                slotIndex,
                matchDraw.winnerTicketsBySlot[slotIndex]
            );
            for (uint256 alternateIndex = 0; alternateIndex < matchDraw.alternateCount; alternateIndex++) {
                emit RoundMatchPrizeAlternateDrawn(
                    roundId,
                    matchId,
                    revealIndex,
                    slotIndex,
                    alternateIndex,
                    matchDraw.alternateTicketsBySlot[slotIndex][alternateIndex]
                );
            }
        }

        emit RoundMatchRevealed(roundId, matchId, revealIndex);
        if (round.revealedMatchCount == round.matchIds.length) {
            round.state = DrawState.Fulfilled;
            emit RoundDrawFulfilled(roundId, round.requestId, round.randomWord);
        }
    }

    function _drawPrizeSlot(bytes32 drawId, Draw storage draw, uint256 prizeSlotIndex)
        internal
        returns (uint256 ticketNumber)
    {
        if (prizeSlotIndex >= draw.prizeSlotCount) revert InvalidPrizeSlots();
        _preparePrizeSlotStorage(draw);
        if (draw.prizeSlotRevealed[prizeSlotIndex]) revert InvalidState();

        _ensurePrizeSlotComputed(drawId, draw, prizeSlotIndex);
        ticketNumber = draw.winnerTicketsBySlot[prizeSlotIndex];
        uint256 revealIndex = draw.revealedPrizeSlots.length;

        draw.prizeSlotRevealed[prizeSlotIndex] = true;
        draw.revealedPrizeSlots.push(prizeSlotIndex);
        draw.revealedTickets.push(ticketNumber);

        emit WinnerDrawn(drawId, prizeSlotIndex, ticketNumber);
        emit PrizeWinnerDrawn(drawId, revealIndex, prizeSlotIndex, ticketNumber);
    }

    function _completeIfFulfilled(bytes32 drawId, Draw storage draw) internal {
        if (draw.revealedPrizeSlots.length == draw.prizeSlotCount) {
            _ensurePrizeSlotComputed(drawId, draw, draw.prizeSlotCount - 1);
            draw.state = DrawState.Fulfilled;
            emit DrawFulfilled(drawId, draw.requestId, draw.randomWord, draw.winnerTicketsBySlot);
        }
    }

    function _setVrfConfig(
        bytes32 keyHash,
        uint64 subscriptionId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit
    ) internal {
        if (keyHash == bytes32(0) || subscriptionId == 0 || callbackGasLimit == 0) revert InvalidVrfConfig();
        vrfConfig = VrfConfig({
            keyHash: keyHash,
            subscriptionId: subscriptionId,
            requestConfirmations: requestConfirmations,
            callbackGasLimit: callbackGasLimit
        });
        emit VrfConfigUpdated(keyHash, subscriptionId, requestConfirmations, callbackGasLimit);
    }

    function _setDefaultPrizeSlotCount(uint256 newPrizeSlotCount) internal {
        _validatePrizeSlotCount(newPrizeSlotCount);
        defaultPrizeSlotCount = newPrizeSlotCount;
        emit DefaultPrizeSlotCountChanged(newPrizeSlotCount);
    }

    function _isDrawAdmin(address account) internal view returns (bool) {
        return account == s_owner || account == drawOperator || s_admins[account];
    }

    function _rememberDrawId(bytes32 drawId) internal {
        if (s_knownDrawIds[drawId]) return;
        s_knownDrawIds[drawId] = true;
        s_drawIds.push(drawId);
    }

    function _rememberRoundId(bytes32 roundId) internal {
        if (s_knownRoundIds[roundId]) return;
        s_knownRoundIds[roundId] = true;
        s_roundIds.push(roundId);
    }

    function _validateDrawId(bytes32 drawId) internal pure {
        if (drawId == bytes32(0)) revert InvalidDrawId();
    }

    function _validatePrizeSlotCount(uint256 newPrizeSlotCount) internal pure {
        if (newPrizeSlotCount == 0 || newPrizeSlotCount > 256) revert InvalidPrizeSlots();
    }

    function _validateAlternateCount(uint256 alternateCount) internal pure {
        if (alternateCount < MIN_ALTERNATE_COUNT || alternateCount > MAX_ALTERNATE_COUNT) revert InvalidPrizeSlots();
    }

    function _validateRoundMatchInput(RoundDraw storage round, RoundMatchInput calldata input) internal view {
        if (input.matchId == bytes32(0) || input.ledgerHash == bytes32(0) || input.totalTickets == 0) {
            revert InvalidLedger();
        }
        if (round.knownMatches[input.matchId]) revert InvalidLedger();
        _validatePrizeSlotCount(input.prizeSlotCount);
        _validateAlternateCount(input.alternateCount);
        uint256 requiredTickets = input.prizeSlotCount * (input.alternateCount + 1);
        if (input.totalTickets < requiredTickets) revert InvalidPrizeSlots();
    }

    function _resetWinnerStorage(Draw storage draw) internal {
        delete draw.winnerTicketsBySlot;
        delete draw.revealedPrizeSlots;
        delete draw.revealedTickets;
        delete draw.allComputedTickets;
        delete draw.prizeSlotRevealed;
        draw.computedPrizeSlotCount = 0;
    }

    function _resetRoundStorage(RoundDraw storage round) internal {
        for (uint256 index = 0; index < round.matchIds.length; index++) {
            bytes32 matchId = round.matchIds[index];
            delete round.matches[matchId];
            delete round.knownMatches[matchId];
        }
        delete round.matchIds;
    }

    function _preparePrizeSlotStorage(Draw storage draw) internal {
        while (draw.winnerTicketsBySlot.length < draw.prizeSlotCount) {
            draw.winnerTicketsBySlot.push(0);
        }
        while (draw.prizeSlotRevealed.length < draw.prizeSlotCount) {
            draw.prizeSlotRevealed.push(false);
        }
    }

    function _ensurePrizeSlotComputed(bytes32 drawId, Draw storage draw, uint256 prizeSlotIndex) internal {
        if (prizeSlotIndex >= draw.prizeSlotCount) revert InvalidPrizeSlots();
        _preparePrizeSlotStorage(draw);

        while (draw.computedPrizeSlotCount <= prizeSlotIndex) {
            uint256 computedSlotIndex = draw.computedPrizeSlotCount;
            uint256 primaryTicket = _drawUniqueTicket(drawId, draw, draw.randomWord, draw.allComputedTickets.length);
            draw.winnerTicketsBySlot[computedSlotIndex] = primaryTicket;
            draw.allComputedTickets.push(primaryTicket);
            draw.computedPrizeSlotCount++;
        }
    }

    function _computeRoundMatchTickets(
        bytes32 roundId,
        RoundDraw storage round,
        bytes32 matchId,
        RoundMatchDraw storage matchDraw
    ) internal {
        if (matchDraw.winnerTicketsBySlot.length > 0) return;

        uint256 seed = uint256(keccak256(abi.encode(round.randomWord, roundId, matchId, matchDraw.ledgerHash)));
        uint256 pickIndex = 0;
        for (uint256 slotIndex = 0; slotIndex < matchDraw.prizeSlotCount; slotIndex++) {
            uint256 primaryTicket = _drawUniqueRoundTicket(matchDraw, seed, pickIndex);
            matchDraw.winnerTicketsBySlot.push(primaryTicket);
            matchDraw.allComputedTickets.push(primaryTicket);
            pickIndex++;

            matchDraw.alternateTicketsBySlot.push();
            uint256[] storage alternates = matchDraw.alternateTicketsBySlot[slotIndex];
            for (uint256 alternateIndex = 0; alternateIndex < matchDraw.alternateCount; alternateIndex++) {
                uint256 alternateTicket = _drawUniqueRoundTicket(matchDraw, seed, pickIndex);
                alternates.push(alternateTicket);
                matchDraw.allComputedTickets.push(alternateTicket);
                pickIndex++;
            }
        }
    }

    function _nextUnrevealedPrizeSlot(Draw storage draw) internal view returns (uint256 prizeSlotIndex) {
        for (uint256 index = 0; index < draw.prizeSlotCount; index++) {
            if (index >= draw.prizeSlotRevealed.length || !draw.prizeSlotRevealed[index]) return index;
        }
        revert InvalidState();
    }

    function _randomUnrevealedPrizeSlot(bytes32 drawId, Draw storage draw)
        internal
        view
        returns (uint256 prizeSlotIndex)
    {
        uint256 revealIndex = draw.revealedPrizeSlots.length;
        uint256 remainingSlots = draw.prizeSlotCount - revealIndex;
        if (remainingSlots == 0) revert InvalidState();

        uint256 targetOffset = uint256(keccak256(abi.encode(draw.randomWord, drawId, "prize-slot", revealIndex)))
            % remainingSlots;
        uint256 seenUnrevealed = 0;
        for (uint256 index = 0; index < draw.prizeSlotCount; index++) {
            if (index < draw.prizeSlotRevealed.length && draw.prizeSlotRevealed[index]) continue;
            if (seenUnrevealed == targetOffset) return index;
            seenUnrevealed++;
        }
        revert InvalidState();
    }

    function _drawUniqueRoundTicket(RoundMatchDraw storage matchDraw, uint256 seed, uint256 pickIndex)
        internal
        view
        returns (uint256)
    {
        uint256 remainingTickets = matchDraw.totalTickets - matchDraw.allComputedTickets.length;
        if (remainingTickets == 0) revert InvalidPrizeSlots();

        uint256 targetIndex = uint256(keccak256(abi.encode(seed, pickIndex))) % remainingTickets;
        for (uint256 candidate = 1; candidate <= matchDraw.totalTickets; candidate++) {
            if (_ticketAlreadyComputed(matchDraw.allComputedTickets, candidate)) continue;
            if (targetIndex == 0) return candidate;
            targetIndex--;
        }
        revert InvalidPrizeSlots();
    }

    function _drawUniqueTicket(bytes32 drawId, Draw storage draw, uint256 seed, uint256 pickIndex)
        internal
        view
        returns (uint256)
    {
        uint256 remainingTickets = draw.totalTickets - draw.allComputedTickets.length;
        if (remainingTickets == 0) revert InvalidPrizeSlots();

        uint256 targetIndex = uint256(keccak256(abi.encode(seed, drawId, pickIndex))) % remainingTickets;
        for (uint256 candidate = 1; candidate <= draw.totalTickets; candidate++) {
            if (_ticketAlreadyComputed(draw.allComputedTickets, candidate)) continue;
            if (targetIndex == 0) return candidate;
            targetIndex--;
        }
        revert InvalidPrizeSlots();
    }

    function _ticketAlreadyComputed(uint256[] storage computedTickets, uint256 ticket) internal view returns (bool) {
        for (uint256 index = 0; index < computedTickets.length; index++) {
            if (computedTickets[index] == ticket) return true;
        }
        return false;
    }
}
