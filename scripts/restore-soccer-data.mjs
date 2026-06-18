#!/usr/bin/env node
import { execFile } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_REPO_URL = 'https://github.com/Gavinzip/renaiss_bnb_soccer_data.git'

function parseBool(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function parseArgs(argv) {
  const args = {
    dataDir: process.env.SOCCER_DATA_DIR || process.env.LUCKY_DRAW_DATA_DIR || '/data/soccer',
    repoUrl: process.env.DATA_BACKUP_REPO_URL || DEFAULT_REPO_URL,
    branch: process.env.DATA_BACKUP_BRANCH || 'main',
    worktree: process.env.DATA_BACKUP_RESTORE_WORKTREE || '/tmp/renaiss-bnb-soccer-data-restore',
    force: parseBool(process.env.DATA_BACKUP_RESTORE_FORCE),
    dryRun: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--data-dir') args.dataDir = argv[++index] || args.dataDir
    else if (arg === '--repo-url') args.repoUrl = argv[++index] || args.repoUrl
    else if (arg === '--branch') args.branch = argv[++index] || args.branch
    else if (arg === '--worktree') args.worktree = argv[++index] || args.worktree
    else if (arg === '--force') args.force = true
    else if (arg === '--dry-run') args.dryRun = true
  }

  args.dataDir = resolve(args.dataDir)
  args.worktree = resolve(args.worktree)
  return args
}

function redactUrl(url) {
  return String(url || '').replace(/\/\/[^/@]+@/, '//[redacted]@')
}

function githubUrlWithUsername(url) {
  if (!url.startsWith('https://github.com/')) return url
  return url.replace('https://github.com/', 'https://x-access-token@github.com/')
}

function assertSafeRestoreRoot(worktree, dataDir) {
  if (!worktree || worktree === '/' || worktree.length < 8) {
    throw new Error(`Refusing unsafe restore worktree: ${worktree}`)
  }
  if (!dataDir || dataDir === '/' || dataDir.length < 8) {
    throw new Error(`Refusing unsafe data directory: ${dataDir}`)
  }
  if (dataDir === worktree || dataDir.startsWith(`${worktree}/`)) {
    throw new Error('Restore worktree must not contain the data directory.')
  }
  if (worktree.startsWith(`${dataDir}/`)) {
    throw new Error('Restore worktree must not be inside the data directory.')
  }
}

function writeAskpassScript() {
  const path = `/tmp/renaiss-soccer-git-restore-askpass-${process.pid}.sh`
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

async function checkoutBranch(args, gitEnv) {
  try {
    await git(['-C', args.worktree, 'fetch', '--depth', '1', 'origin', args.branch], { env: gitEnv })
    await git(['-C', args.worktree, 'checkout', '-B', args.branch, 'FETCH_HEAD'], { env: gitEnv })
    return true
  } catch (error) {
    try {
      await git(['-C', args.worktree, 'checkout', '-B', args.branch], { env: gitEnv })
      return true
    } catch {
      return false
    }
  }
}

async function ensureWorktree(args, gitEnv) {
  const repoUrl = githubUrlWithUsername(args.repoUrl)
  if (!existsSync(args.worktree)) {
    mkdirSync(resolve(args.worktree, '..'), { recursive: true })
    await git(['clone', repoUrl, args.worktree], { env: gitEnv })
  }

  if (!existsSync(join(args.worktree, '.git'))) {
    throw new Error(`Restore worktree is not a git checkout: ${args.worktree}`)
  }

  await git(['-C', args.worktree, 'remote', 'set-url', 'origin', repoUrl], { env: gitEnv })
  return checkoutBranch(args, gitEnv)
}

function summarizeDirectory(dataDir) {
  return {
    ledgerExists: existsSync(join(dataDir, 'lucky-draw-ledger.json')),
    voteStateExists: existsSync(join(dataDir, 'votes', 'vote-state.json')),
    voteEventsExists: existsSync(join(dataDir, 'votes', 'vote-events.jsonl')),
    cacheExists: existsSync(join(dataDir, 'cache')),
  }
}

function copyMissingDirectory(source, target, options, stats) {
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(source)) {
    if (name === '.git') continue
    const sourcePath = join(source, name)
    const targetPath = join(target, name)
    const stat = statSync(sourcePath)
    if (stat.isDirectory()) {
      copyMissingDirectory(sourcePath, targetPath, options, stats)
      continue
    }
    if (!stat.isFile()) continue

    if (!options.force && existsSync(targetPath)) {
      stats.skipped += 1
      continue
    }

    mkdirSync(resolve(targetPath, '..'), { recursive: true })
    copyFileSync(sourcePath, targetPath)
    stats.copied += 1
  }
}

function hasRestorePayload(worktree) {
  if (!existsSync(worktree)) return false
  return readdirSync(worktree).some((name) => name !== '.git')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const token = process.env.DATA_BACKUP_GITHUB_TOKEN || ''
  const requiresToken = args.repoUrl.startsWith('https://github.com/')

  if (!args.repoUrl) throw new Error('DATA_BACKUP_REPO_URL is required.')
  if (requiresToken && !token && !args.dryRun) throw new Error('DATA_BACKUP_GITHUB_TOKEN is required.')
  assertSafeRestoreRoot(args.worktree, args.dataDir)
  mkdirSync(args.dataDir, { recursive: true })

  console.log(
    `[data-restore] ${args.dryRun ? 'dry-run ' : ''}source=${redactUrl(args.repoUrl)} branch=${args.branch} target=${args.dataDir}`,
  )
  console.log(`[data-restore] worktree=${args.worktree} force=${args.force ? 'true' : 'false'}`)
  console.log(`[data-restore] before=${JSON.stringify(summarizeDirectory(args.dataDir))}`)
  if (args.dryRun) return

  const askpassPath = writeAskpassScript()
  const gitEnv = {
    ...process.env,
    GIT_ASKPASS: askpassPath,
    GIT_TERMINAL_PROMPT: '0',
    DATA_BACKUP_GITHUB_TOKEN: token,
  }

  try {
    const checkedOut = await ensureWorktree(args, gitEnv)
    if (!checkedOut || !hasRestorePayload(args.worktree)) {
      console.log('[data-restore] no backup payload found')
      return
    }

    const stats = { copied: 0, skipped: 0 }
    copyMissingDirectory(args.worktree, args.dataDir, { force: args.force }, stats)
    console.log(`[data-restore] copied=${stats.copied} skipped=${stats.skipped}`)
    console.log(`[data-restore] after=${JSON.stringify(summarizeDirectory(args.dataDir))}`)
  } finally {
    rmSync(askpassPath, { force: true })
  }
}

main().catch((error) => {
  console.error(`[data-restore] failed: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
