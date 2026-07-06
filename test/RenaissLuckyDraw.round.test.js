import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

async function deployDraw() {
  const coordinator = await ethers.deployContract("MockVrfCoordinator");
  const draw = await ethers.deployContract("RenaissLuckyDraw", [
    await coordinator.getAddress(),
    ethers.id("bnb-vrf-key"),
    1,
    3,
    500_000,
    2,
  ]);
  return { coordinator, draw };
}

function roundMatchInput(matchId, totalTickets = 20n) {
  return {
    matchId: ethers.id(matchId),
    ledgerHash: ethers.id(`${matchId}-ledger`),
    totalTickets,
    prizeSlotCount: 1n,
    alternateCount: 2n,
    ledgerUri: `/match-draw-ledger.json#${matchId}`,
  };
}

function uniqueTicketNumbers(...groups) {
  return new Set(groups.flat().map((value) => value.toString()));
}

async function parsedEvents(contract, txPromise) {
  const receipt = await (await txPromise).wait();
  return receipt.logs
    .map((log) => {
      try {
        return contract.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function expectCustomError(txPromise, customErrorName) {
  try {
    await txPromise;
  } catch (error) {
    expect(error.message).to.include(customErrorName);
    return;
  }
  expect.fail(`Expected transaction to revert with ${customErrorName}`);
}

describe("RenaissLuckyDraw round-level draws", function () {
  it("uses one VRF request to reveal winners and alternates for multiple matches", async function () {
    const { coordinator, draw } = await deployDraw();
    const drawAddress = await draw.getAddress();
    const roundId = ethers.id("round16");
    const matchA = roundMatchInput("m73");
    const matchB = roundMatchInput("m74", 24n);

    const finalizeEvents = await parsedEvents(
      draw,
      draw.finalizeRoundLedger(roundId, ethers.id("round16-ledger"), [matchA, matchB], "/match-draw-ledger.json#round16"),
    );
    const finalized = finalizeEvents.find((event) => event.name === "RoundLedgerFinalized");
    expect(finalized.args.roundId).to.equal(roundId);
    expect(finalized.args.ledgerHash).to.equal(ethers.id("round16-ledger"));
    expect(finalized.args.matchCount).to.equal(2n);
    expect(finalized.args.ledgerUri).to.equal("/match-draw-ledger.json#round16");

    const requestEvents = await parsedEvents(draw, draw.requestRoundDraw(roundId));
    const requested = requestEvents.find((event) => event.name === "RoundDrawRequested");
    expect(requested.args.roundId).to.equal(roundId);
    expect(requested.args.requestId).to.equal(1n);
    expect(requested.args.caller).to.equal((await ethers.getSigners())[0].address);

    await coordinator.fulfill(drawAddress, 1n, 123456789n);
    let status = await draw.roundDrawStatus(roundId);
    expect(status.randomnessReady).to.equal(true);
    expect(status.fulfilled).to.equal(false);

    const revealEvents = await parsedEvents(draw, draw.revealRoundMatch(roundId, matchA.matchId));
    const revealed = revealEvents.find((event) => event.name === "RoundMatchRevealed");
    expect(revealed.args.roundId).to.equal(roundId);
    expect(revealed.args.matchId).to.equal(matchA.matchId);
    expect(revealed.args.revealIndex).to.equal(0n);

    const matchAWinners = await draw.roundMatchWinnerTicketsBySlot(roundId, matchA.matchId);
    const matchAAlternates0 = await draw.roundMatchAlternateTicketsBySlot(roundId, matchA.matchId, 0);
    expect(matchAWinners).to.have.length(1);
    expect(matchAAlternates0).to.have.length(2);
    expect(uniqueTicketNumbers(matchAWinners, matchAAlternates0).size).to.equal(3);
    for (const ticket of [...matchAWinners, ...matchAAlternates0]) {
      expect(ticket).to.be.greaterThan(0n);
      expect(ticket).to.be.lessThanOrEqual(20n);
    }

    status = await draw.roundDrawStatus(roundId);
    expect(status.revealedMatchCount).to.equal(1n);
    expect(status.fulfilled).to.equal(false);

    await draw.revealRoundMatch(roundId, matchB.matchId);
    const matchBWinners = await draw.roundMatchWinnerTicketsBySlot(roundId, matchB.matchId);
    const matchBAlternatesFlat = await draw.roundMatchAlternateTicketsFlat(roundId, matchB.matchId);
    expect(matchBWinners).to.have.length(1);
    expect(matchBAlternatesFlat).to.have.length(2);
    expect(uniqueTicketNumbers(matchBWinners, matchBAlternatesFlat).size).to.equal(3);

    status = await draw.roundDrawStatus(roundId);
    expect(status.fulfilled).to.equal(true);
    expect(status.revealedMatchCount).to.equal(2n);
  });

  it("keeps the round VRF callback lightweight for a 16-match ledger", async function () {
    const { coordinator, draw } = await deployDraw();
    const drawAddress = await draw.getAddress();
    const roundId = ethers.id("round32");
    const matches = Array.from({ length: 16 }, (_, index) => roundMatchInput(`m${57 + index}`, 24n));

    await draw.finalizeRoundLedger(roundId, ethers.id("round32-ledger"), matches, "/match-draw-ledger.json#round32");
    await draw.requestRoundDraw(roundId);

    const fulfillGas = await coordinator.fulfill.estimateGas(drawAddress, 1n, 987654321n);
    expect(fulfillGas).to.be.lessThan(200_000n);

    await coordinator.fulfill(drawAddress, 1n, 987654321n);
    const status = await draw.roundDrawStatus(roundId);
    expect(status.randomnessReady).to.equal(true);
    expect(status.fulfilled).to.equal(false);
    expect(status.revealedMatchCount).to.equal(0n);
  });

  it("reveals winners when a match has exactly enough tickets for winner and alternates", async function () {
    const { coordinator, draw } = await deployDraw();
    const drawAddress = await draw.getAddress();
    const roundId = ethers.id("round32");
    const exactPool = roundMatchInput("m57", 3n);

    await draw.finalizeRoundLedger(roundId, ethers.id("round32-ledger"), [exactPool], "/match-draw-ledger.json#round32");
    await draw.requestRoundDraw(roundId);
    await coordinator.fulfill(drawAddress, 1n, 123456789n);
    await draw.revealRoundMatch(roundId, exactPool.matchId);

    const winners = await draw.roundMatchWinnerTicketsBySlot(roundId, exactPool.matchId);
    const alternates = await draw.roundMatchAlternateTicketsBySlot(roundId, exactPool.matchId, 0);
    expect(winners).to.have.length(1);
    expect(alternates).to.have.length(2);
    expect(uniqueTicketNumbers(winners, alternates).size).to.equal(3);
  });

  it("rejects a match pool that cannot cover winners plus alternates", async function () {
    const { draw } = await deployDraw();
    const roundId = ethers.id("round16");
    const tooSmall = roundMatchInput("m73", 2n);

    await expectCustomError(
      draw.finalizeRoundLedger(roundId, ethers.id("round16-ledger"), [tooSmall], "/match-draw-ledger.json#round16"),
      "InvalidPrizeSlots",
    );
  });
});
