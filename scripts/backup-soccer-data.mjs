#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

import Database from 'better-sqlite3'

import { stableStringify } from './lucky-draw/utils.mjs'

const execFileAsync = promisify(execFile)
const DEFAULT_REPO_URL = 'https://github.com/Gavinzip/renaiss_bnb_soccer_data.git'

function parseExcludeDirs(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry && entry !== '.' && entry !== '..' && !entry.includes('/')),
  )
}

function parseArgs(argv) {
  const args = {
    dataDir: process.env.SOCCER_DATA_DIR || process.env.LUCKY_DRAW_DATA_DIR || '/data/soccer',
    repoUrl: process.env.DATA_BACKUP_REPO_URL || DEFAULT_REPO_URL,
    branch: process.env.DATA_BACKUP_BRANCH || 'main',
    worktree: process.env.DATA_BACKUP_WORKTREE || '/tmp/renaiss-bnb-soccer-data-backup',
    excludeDirs: parseExcludeDirs(process.env.DATA_BACKUP_EXCLUDE_DIRS || ''),
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--data-dir') args.dataDir = argv[++index] || args.dataDir
    else if (arg === '--repo-url') args.repoUrl = argv[++index] || args.repoUrl
    else if (arg === '--branch') args.branch = argv[++index] || args.branch
    else if (arg === '--worktree') args.worktree = argv[++index] || args.worktree
    else if (arg === '--exclude-dir') args.excludeDirs.add(argv[++index] || '')
    else if (arg === '--dry-run') args.dryRun = true
  }

  args.excludeDirs.delete('')
  args.dataDir = resolve(args.dataDir)
  args.worktree = resolve(args.worktree)
  return args
}

function timestampId(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function redactUrl(url) {
  return String(url || '').replace(/\/\/[^/@]+@/, '//[redacted]@')
}

function githubUrlWithUsername(url) {
  if (!url.startsWith('https://github.com/')) return url
  return url.replace('https://github.com/', 'https://x-access-token@github.com/')
}

function assertSafeSyncRoot(worktree, dataDir) {
  if (!worktree || worktree === '/' || worktree.length < 8) {
    throw new Error(`Refusing unsafe backup worktree: ${worktree}`)
  }
  if (dataDir === worktree || dataDir.startsWith(`${worktree}/`)) {
    throw new Error('Backup worktree must not contain the data directory.')
  }
}

function removeWorktreeContents(worktree) {
  for (const name of readdirSync(worktree)) {
    if (name === '.git') continue
    rmSync(join(worktree, name), { recursive: true, force: true })
  }
}

function isSqliteDatabaseFile(name) {
  return /\.(sqlite|sqlite3|db)$/i.test(name)
}

function isSqliteSidecarFile(name) {
  return /\.(sqlite|sqlite3|db)-(wal|shm)$/i.test(name)
}

function copySqliteSnapshot(sourcePath, targetPath) {
  rmSync(targetPath, { force: true })
  const db = new Database(sourcePath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('busy_timeout = 5000')
    db.prepare('VACUUM INTO ?').run(targetPath)
  } finally {
    db.close()
  }
}

function copyDirectory(source, target, options = {}) {
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(source)) {
    if (name === '.git') continue
    if (options.excludeDirs?.has(name)) continue
    if (isSqliteSidecarFile(name)) continue

    const sourcePath = join(source, name)
    const targetPath = join(target, name)
    const stat = statSync(sourcePath)
    if (stat.isDirectory()) {
      copyDirectory(sourcePath, targetPath, options)
      continue
    }
    if (stat.isFile() && isSqliteDatabaseFile(name)) {
      copySqliteSnapshot(sourcePath, targetPath)
      continue
    }
    if (stat.isFile()) copyFileSync(sourcePath, targetPath)
  }
}

function writeAskpassScript() {
  const path = `/tmp/renaiss-soccer-git-askpass-${process.pid}.sh`
  writeFileSync(
    path,
    [
      '#!/bin/sh',
      'case "$1" in',
      '  *Username*) printf "%s\\n" "x-access-token" ;;',
      '  *) printf "%s\\n" "$DATA_BACKUP_GITHUB_TOKEN" ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o700 },
  )
  return path
}

async function git(args, options) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    ...options,
    maxBuffer: 1024 * 1024 * 12,
  })
  return { stdout, stderr }
}

async function fetchBranch(args, gitEnv) {
  try {
    await git(['-C', args.worktree, 'fetch', '--depth', '1', 'origin', args.branch], { env: gitEnv })
    await git(['-C', args.worktree, 'checkout', '-B', args.branch, 'FETCH_HEAD'], { env: gitEnv })
    return true
  } catch (error) {
    await git(['-C', args.worktree, 'checkout', '-B', args.branch], { env: gitEnv })
    return false
  }
}

async function ensureWorktree(args, gitEnv) {
  const repoUrl = githubUrlWithUsername(args.repoUrl)
  if (!existsSync(args.worktree)) {
    mkdirSync(resolve(args.worktree, '..'), { recursive: true })
    await git(['clone', repoUrl, args.worktree], { env: gitEnv })
  }

  if (!existsSync(join(args.worktree, '.git'))) {
    throw new Error(`Backup worktree is not a git checkout: ${args.worktree}`)
  }

  await git(['-C', args.worktree, 'remote', 'set-url', 'origin', repoUrl], { env: gitEnv })
  await fetchBranch(args, gitEnv)
  await git(['-C', args.worktree, 'config', 'user.name', 'Renaiss Soccer Data Backup'], { env: gitEnv })
  await git(['-C', args.worktree, 'config', 'user.email', 'backup@renaiss.xyz'], { env: gitEnv })
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8'))
}

function readSqliteVoteSummary(dataDir) {
  const dbPath = join(dataDir, 'votes', 'vote-store.sqlite')
  if (!existsSync(dbPath)) return null
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('busy_timeout = 5000')
    const voteEventColumns = new Set(db.prepare('PRAGMA table_info(vote_events)').all().map((row) => String(row.name || '')))
    return {
      exists: true,
      mode: 'sqlite',
      allocationCount: Number(db.prepare('SELECT COUNT(*) AS count FROM vote_allocations').get()?.count || 0),
      eventCount: Number(db.prepare('SELECT COUNT(*) AS count FROM vote_events').get()?.count || 0),
      eventHashHead: voteEventColumns.has('event_hash')
        ? db.prepare(`
          SELECT event_hash
          FROM vote_events
          WHERE event_hash IS NOT NULL
          ORDER BY rowid DESC
          LIMIT 1
        `).get()?.event_hash || null
        : null,
    }
  } finally {
    db.close()
  }
}

function summarizeDataDir(dataDir) {
  const ledger = readJsonIfExists(join(dataDir, 'lucky-draw-ledger.json'))
  const voteState = readJsonIfExists(join(dataDir, 'votes', 'vote-state.json'))
  const sqliteVotes = readSqliteVoteSummary(dataDir)
  return {
    dataDir: basename(dataDir),
    ledger: ledger
      ? {
          exists: true,
          generatedAt: ledger.generatedAt,
          ledgerHash: ledger.ledgerHash,
          totalEntries: ledger.totalEntries,
          totalRawTickets: ledger.totalRawTickets,
          totalBonusTickets: ledger.totalBonusTickets,
          totalFinalTickets: ledger.totalFinalTickets,
        }
      : { exists: false },
    votes: sqliteVotes || (voteState
      ? {
          exists: true,
          mode: 'json-snapshot',
          generatedAt: voteState.generatedAt,
          updatedAt: voteState.updatedAt,
          allocationCount: Array.isArray(voteState.allocations) ? voteState.allocations.length : 0,
          eventCount: voteState.eventCount || 0,
          eventHashHead: voteState.eventHashHead || null,
        }
      : { exists: false }),
  }
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function listSnapshotFiles(root, relativeDir = '') {
  const dir = join(root, relativeDir)
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '.git') return []
    if (relativeDir === '' && ['backup-meta.json', 'backup-manifest.json'].includes(entry.name)) return []
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name
    const absolutePath = join(root, relativePath)
    if (entry.isDirectory()) return listSnapshotFiles(root, relativePath)
    if (!entry.isFile()) return []
    const stat = statSync(absolutePath)
    return [{
      path: relativePath,
      bytes: stat.size,
      sha256: sha256File(absolutePath),
    }]
  })
}

function buildBackupManifest(worktree, summary) {
  return {
    version: 1,
    generatedAt: Math.floor(Date.now() / 1000),
    generatedAtIso: new Date().toISOString(),
    summary,
    files: listSnapshotFiles(worktree).sort((left, right) => left.path.localeCompare(right.path)),
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.DATA_BACKUP_GITHUB_TOKEN || ''
  const requiresToken = args.repoUrl.startsWith('https://github.com/')

  if (!existsSync(args.dataDir)) throw new Error(`Data directory does not exist: ${args.dataDir}`)
  if (!args.repoUrl) throw new Error('DATA_BACKUP_REPO_URL is required.')
  if (requiresToken && !token && !args.dryRun) throw new Error('DATA_BACKUP_GITHUB_TOKEN is required.')
  assertSafeSyncRoot(args.worktree, args.dataDir)

  const summary = summarizeDataDir(args.dataDir)
  console.log(
    `[data-backup] ${args.dryRun ? 'dry-run ' : ''}source=${args.dataDir} repo=${redactUrl(args.repoUrl)} branch=${args.branch}`,
  )
  console.log(`[data-backup] worktree=${args.worktree}`)
  console.log(`[data-backup] excluding directories=${Array.from(args.excludeDirs).join(',') || 'none'}`)
  console.log(`[data-backup] ledger=${summary.ledger.ledgerHash || 'missing'} entries=${summary.ledger.totalEntries || 0}`)
  console.log(`[data-backup] voteEvents=${summary.votes.eventCount || 0} voteAllocations=${summary.votes.allocationCount || 0}`)
  if (args.dryRun) return

  const askpassPath = writeAskpassScript()
  const gitEnv = {
    ...process.env,
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: '0',
    DATA_BACKUP_GITHUB_TOKEN: token,
  }

  try {
    await ensureWorktree(args, gitEnv)
    removeWorktreeContents(args.worktree)
    copyDirectory(args.dataDir, args.worktree, { excludeDirs: args.excludeDirs })
    const manifest = buildBackupManifest(args.worktree, summary)
    writeFileSync(
      join(args.worktree, 'backup-manifest.json'),
      `${stableStringify(manifest)}\n`,
    )
    writeFileSync(
      join(args.worktree, 'backup-meta.json'),
      `${stableStringify({
        backedUpAt: Math.floor(Date.now() / 1000),
        backedUpAtIso: new Date().toISOString(),
        source: basename(args.dataDir),
        repo: args.repoUrl,
        branch: args.branch,
        excludedDirectories: Array.from(args.excludeDirs).sort(),
        summary,
        manifest: {
          fileCount: manifest.files.length,
          voteEventHashHead: summary.votes?.eventHashHead || null,
        },
      })}\n`,
    )

    await git(['-C', args.worktree, 'add', '-A'], { env: gitEnv })
    const { stdout: status } = await git(['-C', args.worktree, 'status', '--porcelain'], { env: gitEnv })
    if (!status.trim()) {
      console.log('[data-backup] no changes to commit')
      return
    }

    const id = timestampId()
    await git(['-C', args.worktree, 'commit', '-m', `Backup soccer data ${id}`], { env: gitEnv })
    await git(['-C', args.worktree, 'push', 'origin', `HEAD:${args.branch}`], { env: gitEnv })
    console.log(`[data-backup] pushed ${id}`)
  } finally {
    rmSync(askpassPath, { force: true })
  }
}

main().catch((error) => {
  console.error(`[data-backup] failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
