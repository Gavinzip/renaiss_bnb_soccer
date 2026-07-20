import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect } from 'chai'

import {
  buildMainnetSandboxLedger,
  writeMainnetSandboxLedger,
} from '../scripts/build-mainnet-sandbox-ledger.mjs'
import { snapshotHash } from '../scripts/soccer-match-results.mjs'

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

  it('creates a new sandbox-only round key without changing the official ticket ledger', function () {
    const source = lockedSemiFinalSource()
    const drawRoundId = 'semiFinal-sandbox-redraw-1'
    const ledger = buildMainnetSandboxLedger({
      source,
      sourceRoundId: 'semiFinal',
      drawRoundId,
    })

    expect(ledger.lockedRoundId).to.equal(drawRoundId)
    expect(ledger.sourceLockedRoundId).to.equal('semiFinal')
    expect(ledger.roundDraws[0]).to.include({
      roundId: drawRoundId,
      sourceRoundId: 'semiFinal',
      redrawOf: 'semiFinal',
      drawId: drawRoundId,
      ledgerHash: source.roundDraws[0].ledgerHash,
    })
    expect(ledger.roundDraws[0].roundKey).to.equal(
      snapshotHash({ type: 'round-id', roundId: drawRoundId }),
    )
    expect(ledger.roundDraws[0].roundKey).not.to.equal(source.roundDraws[0].roundKey)
    expect(ledger.roundDraws[0].matches).to.deep.equal(source.roundDraws[0].matches)
    expect(ledger.draws.map((draw) => draw.entries)).to.deep.equal(source.draws.map((draw) => draw.entries))
    expect(ledger.draws.map((draw) => draw.ledgerHash)).to.deep.equal(source.draws.map((draw) => draw.ledgerHash))
    expect(ledger.draws.map((draw) => draw.roundId)).to.deep.equal([drawRoundId, drawRoundId])
  })

  it('writes a sandbox redraw into isolated storage without rewriting the official snapshot', function () {
    const root = mkdtempSync(join(tmpdir(), 'renaiss-sandbox-ledger-'))
    const sourceDir = join(root, 'official-locked-rounds')
    const sandboxDir = join(root, 'sandbox-locked-rounds')
    const aggregatePath = join(root, 'sandbox-match-draw-ledger.json')
    const sourcePath = join(sourceDir, 'semiFinal.json')
    const source = lockedSemiFinalSource()

    try {
      mkdirSync(sourceDir, { recursive: true })
      writeFileSync(sourcePath, JSON.stringify(source, null, 2))

      const result = writeMainnetSandboxLedger({
        sourceLockedRoundsDir: sourceDir,
        out: aggregatePath,
        lockedRoundsDir: sandboxDir,
        sourceRoundId: 'semiFinal',
        drawRoundId: 'semiFinal-sandbox-redraw-1',
      })
      const writtenSnapshot = JSON.parse(
        readFileSync(join(sandboxDir, 'semiFinal-sandbox-redraw-1.json'), 'utf8'),
      )
      const sourceAfterWrite = JSON.parse(readFileSync(sourcePath, 'utf8'))

      expect(result.summary).to.include({
        roundId: 'semiFinal-sandbox-redraw-1',
        sourceRoundId: 'semiFinal',
        redrawOf: 'semiFinal',
        ledgerHash: source.roundDraws[0].ledgerHash,
      })
      expect(writtenSnapshot.roundDraws[0].matches).to.deep.equal(source.roundDraws[0].matches)
      expect(writtenSnapshot.draws.map((draw) => draw.entries)).to.deep.equal(source.draws.map((draw) => draw.entries))
      expect(sourceAfterWrite).to.deep.equal(source)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
