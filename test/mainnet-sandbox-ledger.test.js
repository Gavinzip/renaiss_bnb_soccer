import { expect } from 'chai'

import { buildMainnetSandboxLedger } from '../scripts/build-mainnet-sandbox-ledger.mjs'

function lockedSemiFinalSource() {
  const matchM101 = {
    matchId: 'm101',
    matchKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
    ledgerHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    totalTickets: 1119,
    prizeSlotCount: 1,
    alternateCount: 2,
    ledgerUri: 'https://example.test/match-draw-ledger.json#m101',
  }
  const matchM102 = {
    matchId: 'm102',
    matchKey: '0x2222222222222222222222222222222222222222222222222222222222222222',
    ledgerHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    totalTickets: 1835,
    prizeSlotCount: 1,
    alternateCount: 2,
    ledgerUri: 'https://example.test/match-draw-ledger.json#m102',
  }
  return {
    version: 1,
    snapshotMode: 'locked-round-match-draw-ledger',
    lockedRoundId: 'semiFinal',
    lockedAt: '2026-07-20T00:00:00.000Z',
    roundDraws: [{
      roundId: 'semiFinal',
      sourceRoundId: 'semiFinal',
      roundKey: '0x3333333333333333333333333333333333333333333333333333333333333333',
      ledgerHash: '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      ledgerUri: 'https://example.test/match-draw-ledger.json#semiFinal',
      matchCount: 2,
      matches: [matchM101, matchM102],
    }],
    draws: [
      { ...matchM101, roundId: 'semiFinal', entries: [{ walletAddress: '0x1000000000000000000000000000000000000001' }] },
      { ...matchM102, roundId: 'semiFinal', entries: [{ walletAddress: '0x1000000000000000000000000000000000000002' }] },
    ],
  }
}

describe('mainnet sandbox draw ledger', function () {
  it('preserves the locked official round identifiers and ticket entries exactly', function () {
    const source = lockedSemiFinalSource()
    const ledger = buildMainnetSandboxLedger({ source, roundId: 'semiFinal' })

    expect(ledger).to.deep.equal(source)
    expect(ledger.roundDraws[0].roundKey).to.equal(source.roundDraws[0].roundKey)
    expect(ledger.roundDraws[0].ledgerHash).to.equal(source.roundDraws[0].ledgerHash)
    expect(ledger.draws.map((draw) => draw.entries)).to.deep.equal(source.draws.map((draw) => draw.entries))
  })

  it('rejects a source snapshot that is not locked for the selected round', function () {
    const source = lockedSemiFinalSource()
    source.lockedRoundId = 'quarterFinal'
    expect(() => buildMainnetSandboxLedger({ source, roundId: 'semiFinal' }))
      .to.throw('Locked source snapshot does not declare semiFinal')
  })
})
