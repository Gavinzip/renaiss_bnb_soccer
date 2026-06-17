import { randomUUID } from "node:crypto";
import {
  DEFAULT_DELTA_MAX_PAGES,
  DEFAULT_WATCH_INTERVAL_MS,
  getConfig,
  requireBearerToken,
} from "./config.js";
import { FollowerStore } from "./followerStore.js";
import { XApiClient, XApiError } from "./xApiClient.js";

export async function resolveTargetAccount(configInput = {}) {
  const config = getConfig(configInput);
  requireBearerToken(config);

  const client = new XApiClient(config);
  const store = new FollowerStore(config.dataDir);
  const response = await client.getUserByUsername(config.targetHandle);
  const user = response.body?.data;

  if (!user?.id) {
    throw new Error(`Unable to resolve X account @${config.targetHandle}.`);
  }

  const account = await store.saveAccount({
    handle: config.targetHandle,
    xUserId: user.id,
    username: user.username,
    name: user.name,
    protected: Boolean(user.protected),
    publicMetrics: user.public_metrics || null,
  });

  return {
    account,
    rateLimit: response.rateLimit,
  };
}

export async function runFollowerSync(options = {}) {
  const mode = options.mode || "delta";
  if (!["full", "delta"].includes(mode)) {
    throw new Error("Sync mode must be full or delta.");
  }

  const config = getConfig(options);
  requireBearerToken(config);

  const client = new XApiClient(config);
  const store = new FollowerStore(config.dataDir);
  const account = await getOrResolveAccount({ config, client, store });
  const startedAt = new Date().toISOString();
  const run = createRun({ account, mode, startedAt, maxPages: options.maxPages });

  try {
    const cache = await store.loadFollowerCache(account.xUserId);
    cache.handle = account.handle;

    const previousCurrentFollowerIds = new Set(
      Object.entries(cache.followers)
        .filter(([, follower]) => follower.isCurrent !== false)
        .map(([id]) => id),
    );
    const seenThisRun = new Set();

    let paginationToken;
    let pageNumber = 0;
    const maxPages = mode === "delta" ? Number(options.maxPages || DEFAULT_DELTA_MAX_PAGES) : Infinity;

    while (pageNumber < maxPages) {
      const response = await client.getFollowersPage(account.xUserId, {
        maxResults: 1000,
        paginationToken,
      });

      pageNumber += 1;
      run.pagesFetched = pageNumber;
      run.lastRateLimit = response.rateLimit;

      const followers = response.body?.data || [];
      const pageStats = upsertFollowers({
        cache,
        followers,
        seenThisRun,
        source: mode === "full" ? "full_sync" : "delta_sync",
        seenAt: startedAt,
      });

      run.followersSeen += followers.length;
      run.newFollowers += pageStats.newFollowers;
      run.reactivatedFollowers += pageStats.reactivatedFollowers;

      if (mode === "delta" && pageStats.newFollowers === 0 && pageStats.reactivatedFollowers === 0) {
        run.stopReason = "known_page";
        break;
      }

      paginationToken = response.body?.meta?.next_token;
      if (!paginationToken) {
        run.stopReason = "end_of_list";
        break;
      }
    }

    if (!run.stopReason) {
      run.stopReason = mode === "delta" ? "max_pages" : "end_of_list";
    }

    if (mode === "full") {
      run.removedFollowers = markMissingFollowersInactive({
        cache,
        previousCurrentFollowerIds,
        seenThisRun,
        seenAt: startedAt,
      });
    }

    await store.saveFollowerCache(account.xUserId, cache);
    run.status = "success";
    run.finishedAt = new Date().toISOString();
    await store.appendSyncRun(account.xUserId, run);
    return run;
  } catch (error) {
    run.status = "failed";
    run.finishedAt = new Date().toISOString();
    run.error = serializeError(error);
    await store.appendSyncRun(account.xUserId, run);
    throw error;
  }
}

export async function verifyFollower(options = {}) {
  const config = getConfig(options);
  const store = new FollowerStore(config.dataDir);
  const account = await store.getAccount(config.targetHandle);

  if (!account?.xUserId) {
    throw new Error(`No cached account found for @${config.targetHandle}. Run resolve-account or sync first.`);
  }

  const cache = await store.loadFollowerCache(account.xUserId);
  const followerId = options.followerId;
  const username = options.username?.toLowerCase();

  if (!followerId && !username) {
    throw new Error("Provide --follower-id or --username.");
  }

  const follower = followerId
    ? cache.followers[followerId]
    : Object.values(cache.followers).find((candidate) => candidate.username?.toLowerCase() === username);

  return {
    target: account,
    follower: follower || null,
    isCurrent: Boolean(follower && follower.isCurrent !== false),
    checkedAt: new Date().toISOString(),
  };
}

export async function watchDeltaSync(options = {}) {
  const intervalMs = Number(options.intervalMs || DEFAULT_WATCH_INTERVAL_MS);
  if (!Number.isFinite(intervalMs) || intervalMs < 10_000) {
    throw new Error("Watch interval must be at least 10000 ms.");
  }

  while (true) {
    try {
      const run = await runFollowerSync({
        ...options,
        mode: "delta",
      });
      console.log(formatRunSummary(run));
    } catch (error) {
      console.error(formatError(error));
    }

    await sleep(intervalMs);
  }
}

export function formatRunSummary(run) {
  return [
    `${run.mode} sync ${run.status}`,
    `pages=${run.pagesFetched}`,
    `seen=${run.followersSeen}`,
    `new=${run.newFollowers}`,
    `reactivated=${run.reactivatedFollowers}`,
    `removed=${run.removedFollowers}`,
    `stop=${run.stopReason}`,
  ].join(" ");
}

export function formatError(error) {
  if (error instanceof XApiError) {
    const reset = error.rateLimit?.reset ? ` reset=${error.rateLimit.reset}` : "";
    return `X API error status=${error.status}${reset} body=${JSON.stringify(error.body)}`;
  }

  return error?.stack || String(error);
}

async function getOrResolveAccount({ config, client, store }) {
  const cached = await store.getAccount(config.targetHandle);
  if (cached?.xUserId) {
    return cached;
  }

  const response = await client.getUserByUsername(config.targetHandle);
  const user = response.body?.data;
  if (!user?.id) {
    throw new Error(`Unable to resolve X account @${config.targetHandle}.`);
  }

  return store.saveAccount({
    handle: config.targetHandle,
    xUserId: user.id,
    username: user.username,
    name: user.name,
    protected: Boolean(user.protected),
    publicMetrics: user.public_metrics || null,
  });
}

function createRun({ account, mode, startedAt, maxPages }) {
  return {
    id: randomUUID(),
    targetHandle: account.handle,
    targetXUserId: account.xUserId,
    mode,
    startedAt,
    finishedAt: null,
    status: "running",
    pagesFetched: 0,
    followersSeen: 0,
    newFollowers: 0,
    reactivatedFollowers: 0,
    removedFollowers: 0,
    maxPages: mode === "delta" ? Number(maxPages || DEFAULT_DELTA_MAX_PAGES) : null,
    stopReason: null,
    lastRateLimit: null,
    error: null,
  };
}

function upsertFollowers({ cache, followers, seenThisRun, source, seenAt }) {
  let newFollowers = 0;
  let reactivatedFollowers = 0;

  for (const follower of followers) {
    const existing = cache.followers[follower.id];
    seenThisRun.add(follower.id);

    if (!existing) {
      newFollowers += 1;
      cache.followers[follower.id] = {
        id: follower.id,
        username: follower.username,
        name: follower.name,
        protected: Boolean(follower.protected),
        verified: Boolean(follower.verified),
        publicMetrics: follower.public_metrics || null,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        isCurrent: true,
        source,
      };
      continue;
    }

    if (existing.isCurrent === false) {
      reactivatedFollowers += 1;
    }

    cache.followers[follower.id] = {
      ...existing,
      username: follower.username,
      name: follower.name,
      protected: Boolean(follower.protected),
      verified: Boolean(follower.verified),
      publicMetrics: follower.public_metrics || existing.publicMetrics || null,
      lastSeenAt: seenAt,
      isCurrent: true,
      source,
    };
  }

  return {
    newFollowers,
    reactivatedFollowers,
  };
}

function markMissingFollowersInactive({ cache, previousCurrentFollowerIds, seenThisRun, seenAt }) {
  let removedFollowers = 0;
  for (const followerId of previousCurrentFollowerIds) {
    if (!seenThisRun.has(followerId) && cache.followers[followerId]) {
      cache.followers[followerId] = {
        ...cache.followers[followerId],
        isCurrent: false,
        lastCheckedAt: seenAt,
      };
      removedFollowers += 1;
    }
  }

  return removedFollowers;
}

function serializeError(error) {
  if (error instanceof XApiError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      body: error.body,
      rateLimit: error.rateLimit,
    };
  }

  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
