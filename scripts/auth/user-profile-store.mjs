import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import Database from 'better-sqlite3'

const SQLITE_SCHEMA_VERSION = 3
const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true })
}

function normalizeAddress(value) {
  const address = String(value || '').trim()
  return WALLET_ADDRESS_PATTERN.test(address) ? address.toLowerCase() : ''
}

function cleanText(value, maxLength = 160) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, maxLength) : null
}

function cleanEmail(value) {
  const email = String(value ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

function cleanUrl(value) {
  const url = String(value ?? '').trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function cleanTwitterUsername(value) {
  const username = String(value ?? '').trim().replace(/^@+/, '')
  return /^[A-Za-z0-9_]{1,15}$/.test(username) ? username : null
}

function normalizeTwitterUsername(value) {
  return String(cleanTwitterUsername(value) || '').toLowerCase()
}

function cleanTwitterUserId(value) {
  const id = String(value ?? '').trim()
  return /^\d{1,32}$/.test(id) ? id : null
}

function nowIso() {
  return new Date().toISOString()
}

function openDatabase(dbPath, options = {}) {
  if (!dbPath) throw new Error('SOCCER_PROFILE_DB_PATH is required.')
  ensureParent(dbPath)
  const db = new Database(dbPath, options)
  db.pragma('journal_mode = WAL')
  db.pragma('busy_timeout = 5000')
  return db
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_profile_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      wallet_address TEXT PRIMARY KEY,
      last_provider TEXT,
      last_provider_user_id TEXT,
      email TEXT,
      email_verified INTEGER,
      name TEXT,
      picture TEXT,
      twitter_username TEXT,
      twitter_user_id TEXT,
      twitter_picture TEXT,
      renaiss_twitter_username TEXT,
      renaiss_twitter_user_id TEXT,
      renaiss_twitter_picture TEXT,
      x_username TEXT,
      x_user_id TEXT,
      x_picture TEXT,
      safe_wallet_address TEXT,
      legacy_wallet_address TEXT,
      chain_id TEXT,
      last_ip_hash TEXT,
      last_ip_prefix TEXT,
      last_ip_country TEXT,
      last_ip_region TEXT,
      last_ip_city TEXT,
      last_ip_timezone TEXT,
      last_login_audit_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      login_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS user_profiles_twitter_username_idx
      ON user_profiles (twitter_username);

    CREATE TABLE IF NOT EXISTS user_login_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_address TEXT,
      provider TEXT,
      provider_user_id TEXT,
      twitter_username TEXT,
      ip_hash TEXT,
      ip_prefix TEXT,
      ip_version INTEGER,
      ip_is_private INTEGER,
      country TEXT,
      region TEXT,
      city TEXT,
      timezone TEXT,
      geo_source TEXT,
      user_agent_hash TEXT,
      referrer_origin TEXT,
      request_host TEXT,
      request_pathname TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS user_login_audits_wallet_address_idx
      ON user_login_audits (wallet_address);
    CREATE INDEX IF NOT EXISTS user_login_audits_created_at_idx
      ON user_login_audits (created_at);
    CREATE INDEX IF NOT EXISTS user_login_audits_provider_idx
      ON user_login_audits (provider);
  `)
  db.prepare(`
    INSERT INTO user_profile_meta (key, value)
    VALUES ('schemaVersion', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(String(SQLITE_SCHEMA_VERSION))

  const columns = db.prepare('PRAGMA table_info(user_profiles)').all().map((row) => row.name)
  for (const [column, type] of [
    ['renaiss_twitter_username', 'TEXT'],
    ['renaiss_twitter_user_id', 'TEXT'],
    ['renaiss_twitter_picture', 'TEXT'],
    ['x_username', 'TEXT'],
    ['x_user_id', 'TEXT'],
    ['x_picture', 'TEXT'],
    ['last_ip_hash', 'TEXT'],
    ['last_ip_prefix', 'TEXT'],
    ['last_ip_country', 'TEXT'],
    ['last_ip_region', 'TEXT'],
    ['last_ip_city', 'TEXT'],
    ['last_ip_timezone', 'TEXT'],
    ['last_login_audit_at', 'TEXT'],
  ]) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE user_profiles ADD COLUMN ${column} ${type}`)
  }
}

function rowToPublicProfile(row) {
  if (!row) return null
  const renaissTwitterUsername = cleanTwitterUsername(row.renaiss_twitter_username || row.twitter_username)
  const xUsername = cleanTwitterUsername(row.x_username)
  const twitterUsername = renaissTwitterUsername || xUsername
  const avatarUrl = cleanUrl(row.x_picture) || cleanUrl(row.twitter_picture) || cleanUrl(row.renaiss_twitter_picture) || cleanUrl(row.picture)
  const name = cleanText(row.name)
  const displayName = twitterUsername ? `@${twitterUsername}` : name

  return {
    walletAddress: normalizeAddress(row.wallet_address),
    displayName: displayName || null,
    name,
    avatarUrl,
    picture: cleanUrl(row.picture),
    twitterUsername,
    renaissTwitterUsername,
    xUsername,
    twitterUrl: twitterUsername ? `https://x.com/${twitterUsername}` : null,
    provider: cleanText(row.last_provider),
    providerUserId: cleanText(row.last_provider_user_id),
    email: cleanEmail(row.email),
    updatedAt: cleanText(row.updated_at),
    lastSeenAt: cleanText(row.last_seen_at),
  }
}

function buildProfileRow({ session, identity } = {}) {
  const walletAddress = normalizeAddress(
    session?.walletAddress
      || identity?.safeWalletAddress
      || identity?.walletAddress
      || identity?.legacyWalletAddress,
  )
  if (!walletAddress) return null

  const provider = cleanText(identity?.provider)
  const providerUserId = cleanText(identity?.providerUserId)
  const isRenaissIdentity = provider === 'renaiss'
  const isXIdentity = provider === 'x'
  const renaissTwitterUsername = isRenaissIdentity ? cleanTwitterUsername(identity?.twitterUsername) : null
  const renaissTwitterUserId = isRenaissIdentity ? cleanTwitterUserId(identity?.twitterUserId) : null
  const xUsername = isXIdentity ? cleanTwitterUsername(identity?.username || identity?.twitterUsername) : null
  const xUserId = isXIdentity ? cleanTwitterUserId(providerUserId) : null
  const picture = cleanUrl(identity?.picture)
  const renaissTwitterPicture = isRenaissIdentity ? cleanUrl(identity?.twitterPicture || identity?.picture) : null
  const timestamp = nowIso()

  return {
    walletAddress,
    lastProvider: provider,
    lastProviderUserId: providerUserId,
    email: cleanEmail(identity?.email),
    emailVerified: typeof identity?.emailVerified === 'boolean' ? (identity.emailVerified ? 1 : 0) : null,
    name: cleanText(identity?.name || identity?.globalName || identity?.username),
    picture,
    twitterUsername: renaissTwitterUsername,
    twitterUserId: renaissTwitterUserId,
    twitterPicture: renaissTwitterPicture,
    renaissTwitterUsername,
    renaissTwitterUserId,
    renaissTwitterPicture,
    xUsername,
    xUserId,
    xPicture: isXIdentity ? picture : null,
    safeWalletAddress: normalizeAddress(identity?.safeWalletAddress),
    legacyWalletAddress: normalizeAddress(identity?.legacyWalletAddress),
    chainId: cleanText(identity?.chainId),
    firstSeenAt: timestamp,
    lastSeenAt: timestamp,
    updatedAt: timestamp,
  }
}

function buildAuditRow({ session, identity, audit } = {}) {
  if (!audit || typeof audit !== 'object') return null
  const walletAddress = normalizeAddress(
    audit.walletAddress
      || session?.walletAddress
      || identity?.safeWalletAddress
      || identity?.walletAddress
      || identity?.legacyWalletAddress,
  )
  const provider = cleanText(audit.provider || identity?.provider)
  const providerUserId = cleanText(audit.providerUserId || identity?.providerUserId)
  const timestamp = nowIso()

  return {
    walletAddress: walletAddress || null,
    provider,
    providerUserId,
    twitterUsername: cleanTwitterUsername(audit.twitterUsername || identity?.twitterUsername || identity?.username),
    ipHash: cleanText(audit.ipHash, 128),
    ipPrefix: cleanText(audit.ipPrefix, 64),
    ipVersion: audit.ipVersion === 4 || audit.ipVersion === 6 ? audit.ipVersion : null,
    ipIsPrivate: audit.ipIsPrivate ? 1 : 0,
    country: cleanText(audit.country, 32),
    region: cleanText(audit.region, 80),
    city: cleanText(audit.city, 120),
    timezone: cleanText(audit.timezone, 80),
    geoSource: cleanText(audit.geoSource, 32),
    userAgentHash: cleanText(audit.userAgentHash, 128),
    referrerOrigin: cleanUrl(audit.referrerOrigin),
    requestHost: cleanText(audit.requestHost, 180),
    requestPathname: cleanText(audit.requestPathname, 220),
    createdAt: timestamp,
  }
}

function applyProfileAudit(row, auditRow) {
  if (!row || !auditRow) return row
  return {
    ...row,
    lastIpHash: auditRow.ipHash,
    lastIpPrefix: auditRow.ipPrefix,
    lastIpCountry: auditRow.country,
    lastIpRegion: auditRow.region,
    lastIpCity: auditRow.city,
    lastIpTimezone: auditRow.timezone,
    lastLoginAuditAt: auditRow.createdAt,
  }
}

function upsertProfile(db, row) {
  db.prepare(`
    INSERT INTO user_profiles (
      wallet_address, last_provider, last_provider_user_id, email, email_verified, name, picture,
      twitter_username, twitter_user_id, twitter_picture, renaiss_twitter_username, renaiss_twitter_user_id,
      renaiss_twitter_picture, x_username, x_user_id, x_picture, safe_wallet_address, legacy_wallet_address,
      chain_id, last_ip_hash, last_ip_prefix, last_ip_country, last_ip_region, last_ip_city, last_ip_timezone,
      last_login_audit_at, first_seen_at, last_seen_at, updated_at, login_count
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(wallet_address) DO UPDATE SET
      last_provider = COALESCE(excluded.last_provider, user_profiles.last_provider),
      last_provider_user_id = COALESCE(excluded.last_provider_user_id, user_profiles.last_provider_user_id),
      email = COALESCE(excluded.email, user_profiles.email),
      email_verified = COALESCE(excluded.email_verified, user_profiles.email_verified),
      name = COALESCE(excluded.name, user_profiles.name),
      picture = COALESCE(excluded.picture, user_profiles.picture),
      twitter_username = COALESCE(excluded.twitter_username, user_profiles.twitter_username),
      twitter_user_id = COALESCE(excluded.twitter_user_id, user_profiles.twitter_user_id),
      twitter_picture = COALESCE(excluded.twitter_picture, user_profiles.twitter_picture),
      renaiss_twitter_username = COALESCE(excluded.renaiss_twitter_username, user_profiles.renaiss_twitter_username),
      renaiss_twitter_user_id = COALESCE(excluded.renaiss_twitter_user_id, user_profiles.renaiss_twitter_user_id),
      renaiss_twitter_picture = COALESCE(excluded.renaiss_twitter_picture, user_profiles.renaiss_twitter_picture),
      x_username = COALESCE(excluded.x_username, user_profiles.x_username),
      x_user_id = COALESCE(excluded.x_user_id, user_profiles.x_user_id),
      x_picture = COALESCE(excluded.x_picture, user_profiles.x_picture),
      safe_wallet_address = COALESCE(excluded.safe_wallet_address, user_profiles.safe_wallet_address),
      legacy_wallet_address = COALESCE(excluded.legacy_wallet_address, user_profiles.legacy_wallet_address),
      chain_id = COALESCE(excluded.chain_id, user_profiles.chain_id),
      last_ip_hash = COALESCE(excluded.last_ip_hash, user_profiles.last_ip_hash),
      last_ip_prefix = COALESCE(excluded.last_ip_prefix, user_profiles.last_ip_prefix),
      last_ip_country = COALESCE(excluded.last_ip_country, user_profiles.last_ip_country),
      last_ip_region = COALESCE(excluded.last_ip_region, user_profiles.last_ip_region),
      last_ip_city = COALESCE(excluded.last_ip_city, user_profiles.last_ip_city),
      last_ip_timezone = COALESCE(excluded.last_ip_timezone, user_profiles.last_ip_timezone),
      last_login_audit_at = COALESCE(excluded.last_login_audit_at, user_profiles.last_login_audit_at),
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at,
      login_count = user_profiles.login_count + 1
  `).run(
    row.walletAddress,
    row.lastProvider,
    row.lastProviderUserId,
    row.email,
    row.emailVerified,
    row.name,
    row.picture,
    row.twitterUsername,
    row.twitterUserId,
    row.twitterPicture,
    row.renaissTwitterUsername,
    row.renaissTwitterUserId,
    row.renaissTwitterPicture,
    row.xUsername,
    row.xUserId,
    row.xPicture,
    row.safeWalletAddress || null,
    row.legacyWalletAddress || null,
    row.chainId,
    row.lastIpHash || null,
    row.lastIpPrefix || null,
    row.lastIpCountry || null,
    row.lastIpRegion || null,
    row.lastIpCity || null,
    row.lastIpTimezone || null,
    row.lastLoginAuditAt || null,
    row.firstSeenAt,
    row.lastSeenAt,
    row.updatedAt,
  )
}

function insertLoginAudit(db, row) {
  db.prepare(`
    INSERT INTO user_login_audits (
      wallet_address, provider, provider_user_id, twitter_username, ip_hash, ip_prefix, ip_version,
      ip_is_private, country, region, city, timezone, geo_source, user_agent_hash, referrer_origin,
      request_host, request_pathname, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.walletAddress,
    row.provider,
    row.providerUserId,
    row.twitterUsername,
    row.ipHash,
    row.ipPrefix,
    row.ipVersion,
    row.ipIsPrivate,
    row.country,
    row.region,
    row.city,
    row.timezone,
    row.geoSource,
    row.userAgentHash,
    row.referrerOrigin,
    row.requestHost,
    row.requestPathname,
    row.createdAt,
  )
}

export function createUserProfileStore({ dbPath, logger = console, maxQueueSize = 250 }) {
  const db = openDatabase(dbPath)
  ensureSchema(db)

  let queue = []
  let flushScheduled = false
  let droppedCount = 0
  let writeErrorCount = 0

  function readProfilesForWallets(wallets) {
    const normalized = [...new Set((Array.isArray(wallets) ? wallets : []).map(normalizeAddress).filter(Boolean))]
    if (!normalized.length) return new Map()
    const placeholders = normalized.map(() => '?').join(', ')
    const rows = db.prepare(`
      SELECT *
      FROM user_profiles
      WHERE wallet_address IN (${placeholders})
    `).all(...normalized)
    return new Map(rows.map((row) => [normalizeAddress(row.wallet_address), rowToPublicProfile(row)]))
  }

  function readProfile(walletAddress) {
    const address = normalizeAddress(walletAddress)
    if (!address) return null
    const row = db.prepare('SELECT * FROM user_profiles WHERE wallet_address = ?').get(address)
    return rowToPublicProfile(row)
  }

  function checkXIdentityForWallet({ walletAddress, identity } = {}) {
    const address = normalizeAddress(walletAddress)
    if (!address) {
      return { ok: false, code: 'wallet_required', expectedUsername: null, actualUsername: null }
    }

    const row = db.prepare('SELECT * FROM user_profiles WHERE wallet_address = ?').get(address)
    const expectedUsername = normalizeTwitterUsername(row?.renaiss_twitter_username)
    const expectedUserId = cleanTwitterUserId(row?.renaiss_twitter_user_id)
    if (!expectedUsername && !expectedUserId) {
      return { ok: false, code: 'renaiss_twitter_required', expectedUsername: null, actualUsername: null }
    }

    const actualUsername = normalizeTwitterUsername(identity?.username || identity?.twitterUsername)
    const actualUserId = cleanTwitterUserId(identity?.providerUserId || identity?.twitterUserId)
    if (!identity) {
      return { ok: true, code: null, expectedUsername, actualUsername: null }
    }
    if (!actualUsername && !actualUserId) {
      return { ok: false, code: 'twitter_identity_missing', expectedUsername, actualUsername: null }
    }
    if (expectedUserId && actualUserId && expectedUserId !== actualUserId) {
      return { ok: false, code: 'twitter_identity_mismatch', expectedUsername, actualUsername }
    }
    if (expectedUsername && actualUsername && expectedUsername !== actualUsername) {
      return { ok: false, code: 'twitter_identity_mismatch', expectedUsername, actualUsername }
    }
    return { ok: true, code: null, expectedUsername, actualUsername }
  }

  function flushQueue() {
    flushScheduled = false
    const batch = queue
    queue = []
    for (const entry of batch) {
      try {
        if (entry.profileRow) upsertProfile(db, entry.profileRow)
        if (entry.auditRow) insertLoginAudit(db, entry.auditRow)
      } catch (error) {
        writeErrorCount += 1
        logger.warn?.('[user-profile-store] profile write failed', {
          walletAddress: entry.profileRow?.walletAddress || entry.auditRow?.walletAddress || null,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (queue.length) scheduleFlush()
  }

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    setTimeout(flushQueue, 0)
  }

  return {
    mode: 'sqlite',
    dbPath,
    enqueueLoginProfile({ session, identity, audit } = {}) {
      const auditRow = buildAuditRow({ session, identity, audit })
      const profileRow = applyProfileAudit(buildProfileRow({ session, identity }), auditRow)
      if (!profileRow && !auditRow) return { queued: false, reason: 'login-profile-missing' }
      if (queue.length >= maxQueueSize) {
        queue.shift()
        droppedCount += 1
      }
      queue.push({ profileRow, auditRow })
      scheduleFlush()
      return { queued: true, walletAddress: profileRow?.walletAddress || auditRow?.walletAddress || null }
    },
    readProfile,
    readProfilesForWallets,
    checkXIdentityForWallet,
    health() {
      const count = db.prepare('SELECT COUNT(*) AS count FROM user_profiles').get()?.count || 0
      const auditCount = db.prepare('SELECT COUNT(*) AS count FROM user_login_audits').get()?.count || 0
      return {
        mode: 'sqlite',
        dbPath,
        exists: existsSync(dbPath),
        profileCount: Number(count),
        loginAuditCount: Number(auditCount),
        queuedWrites: queue.length,
        droppedWrites: droppedCount,
        writeErrorCount,
        schemaVersion: SQLITE_SCHEMA_VERSION,
      }
    },
    close() {
      db.close()
    },
  }
}
