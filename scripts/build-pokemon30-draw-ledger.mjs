#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { readEnvFile } from './lucky-draw/utils.mjs'
import { buildPokemon30DrawLedger } from './pokemon30/draw-ledger.mjs'

function parseArgs(argv) {
  const args = {
    envFile: '',
    ticketLedger: process.env.POKEMON30_TICKET_LEDGER_PATH || '',
    out: process.env.POKEMON30_DRAW_LEDGER_PATH || '/data/pokemon30/draw-ledger.json',
    prizeSlots: process.env.POKEMON30_PRIZE_SLOT_COUNT || '',
    allowRepeatWinners: process.env.POKEMON30_ALLOW_REPEAT_WINNERS || '',
    ledgerUri: process.env.POKEMON30_DRAW_LEDGER_URI || '',
    drawLabel: process.env.POKEMON30_DRAW_LABEL || '',
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env-file') args.envFile = argv[++index] || ''
    else if (arg === '--ticket-ledger') args.ticketLedger = argv[++index] || ''
    else if (arg === '--out') args.out = argv[++index] || args.out
    else if (arg === '--prize-slots') args.prizeSlots = argv[++index] || ''
    else if (arg === '--allow-repeat-winners') args.allowRepeatWinners = argv[++index] || ''
    else if (arg === '--ledger-uri') args.ledgerUri = argv[++index] || ''
    else if (arg === '--draw-label') args.drawLabel = argv[++index] || ''
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--help') {
      console.log('Usage: node scripts/build-pokemon30-draw-ledger.mjs --env-file config/pokemon30.env.local --ticket-ledger /secure/ticket-ledger.json --prize-slots <count> --allow-repeat-winners true --ledger-uri <https-or-ipfs-url> [--dry-run]')
      process.exit(0)
    }
  }
  return args
}

function envValue(env, name, argumentValue = '') {
  return String(argumentValue || env[name] || process.env[name] || '').trim()
}

function requiredFile(path) {
  if (!path || !existsSync(path)) throw new Error('A ready Pokémon 30 ticket ledger file is required.')
  return JSON.parse(readFileSync(path, 'utf8'))
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const env = args.envFile ? readEnvFile(args.envFile) : {}
  const ticketLedgerPath = envValue(env, 'POKEMON30_TICKET_LEDGER_PATH', args.ticketLedger)
  const output = buildPokemon30DrawLedger({
    ticketLedger: requiredFile(ticketLedgerPath),
    ticketLedgerPath,
    prizeSlotCount: envValue(env, 'POKEMON30_PRIZE_SLOT_COUNT', args.prizeSlots),
    allowRepeatWinners: envValue(env, 'POKEMON30_ALLOW_REPEAT_WINNERS', args.allowRepeatWinners),
    ledgerUri: envValue(env, 'POKEMON30_DRAW_LEDGER_URI', args.ledgerUri),
    drawLabel: envValue(env, 'POKEMON30_DRAW_LABEL', args.drawLabel),
  })
  const draw = output.draws[0]
  if (!args.dryRun) {
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, `${JSON.stringify(output, null, 2)}\n`)
  }
  console.log(JSON.stringify({
    ok: true,
    eventId: output.eventId,
    sourceStatus: output.sourceStatus,
    drawId: draw.drawId,
    ledgerHash: draw.ledgerHash,
    totalTickets: draw.totalTickets,
    prizeSlotCount: draw.prizeSlotCount,
    winnerPolicy: draw.winnerPolicy,
    out: args.dryRun ? null : args.out,
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: 'pokemon30_draw_ledger_failed',
    error: error?.message || String(error),
  }))
  process.exit(1)
}
