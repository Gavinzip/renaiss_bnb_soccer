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

describe("RenaissLuckyDraw round-level draws", function () {
  it("uses one VRF request to reveal winners and alternates for multiple matches", async function () {
    const { coordinator, draw } = await deployDraw();
    const drawAddress = await draw.getAddress();
    const roundId = ethers.id("round16");
    const matchA = roundMatchInput("m73");
    const matchB = roundMatchInput("m74", 24n);

    await expect(draw.finalizeRoundLedger(roundId, ethers.id("round16-ledger"), [matchA, matchB], "/match-draw-ledger.json#round16"))
      .to.emit(draw, "RoundLedgerFinalized")
      .withArgs(roundId, ethers.id("round16-ledger"), 2n, "/match-draw-ledger.json#round16");

    await expect(draw.requestRoundDraw(roundId))
      .to.emit(draw, "RoundDrawRequested")
      .withArgs(roundId, 1n, (await ethers.getSigners())[0].address);

    await coordinator.fulfill(drawAddress, 1n, 123456789n);
    let status = await draw.roundDrawStatus(roundId);
    expect(status.randomnessReady).to.equal(true);
    expect(status.fulfilled).to.equal(false);

    await expect(draw.revealRoundMatch(roundId, matchA.matchId))
      .to.emit(draw, "RoundMatchRevealed")
      .withArgs(roundId, matchA.matchId, 0n);

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

  it("rejects a match pool that cannot cover winners plus alternates", async function () {
    const { draw } = await deployDraw();
    const roundId = ethers.id("round16");
    const tooSmall = roundMatchInput("m73", 2n);

    await expect(
      draw.finalizeRoundLedger(roundId, ethers.id("round16-ledger"), [tooSmall], "/match-draw-ledger.json#round16"),
    ).to.be.revertedWithCustomError(draw, "InvalidPrizeSlots");
  });
});
