export const DEFAULT_WINNER_REVEAL_VIDEO_URL =
  "https://pub-7230fa99c50e44e9b241e47cac526165.r2.dev/draw/winner-reveal-2026-06-17-hq.mp4";

const emptyWinnerRevealData = {
  sourceLabel: "on-chain-reveal",
  sourceStatus: "pending",
  generatedAt: null,
  videoUrl: DEFAULT_WINNER_REVEAL_VIDEO_URL,
  winners: [],
  winnersBySlot: [],
  alternates: [],
  draws: [],
  transactions: [],
  txs: [],
  roundSnapshots: [],
  proof: {
    ledgerDownloadAvailable: false,
    ledgerDownloadUrl: "",
    transactions: [],
    roundTransactions: [],
    matchTransactions: [],
  },
};

function normalizeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function normalizeWinnerProfile(row) {
  if (!row || typeof row !== "object") return null;
  const twitterUsername = String(row.twitterUsername ?? row.twitter_username ?? "").trim().replace(/^@+/, "");
  const displayName = String(row.displayName ?? row.display_name ?? row.name ?? "").trim();
  const avatarUrl = String(row.avatarUrl ?? row.avatar_url ?? row.twitterPicture ?? row.twitter_picture ?? row.picture ?? "").trim();
  const walletAddress = String(row.walletAddress ?? row.wallet_address ?? "").trim();
  const twitterUrl = String(row.twitterUrl ?? row.twitter_url ?? (twitterUsername ? `https://x.com/${twitterUsername}` : "")).trim();
  const provider = String(row.provider ?? "").trim();

  if (!twitterUsername && !displayName && !avatarUrl && !walletAddress && !provider) return null;

  return {
    walletAddress,
    displayName,
    name: String(row.name ?? "").trim(),
    avatarUrl,
    picture: String(row.picture ?? "").trim(),
    twitterUsername,
    twitterUrl,
    provider,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
    lastSeenAt: row.lastSeenAt ?? row.last_seen_at ?? null,
  };
}

function normalizeTransactionHash(value) {
  const hash = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(hash) ? hash : "";
}

function normalizeMatchIds(value) {
  if (Array.isArray(value)) {
    return value.map((matchId) => String(matchId || "").trim()).filter(Boolean);
  }
  return String(value || "")
    .split(",")
    .map((matchId) => matchId.trim())
    .filter(Boolean);
}

function normalizeProofTransaction(row, index) {
  if (!row || typeof row !== "object") return null;
  const hash = normalizeTransactionHash(row.hash ?? row.txHash ?? row.tx_hash ?? row.transactionHash ?? row.transaction_hash);
  if (!hash) return null;
  const step = String(row.step ?? row.action ?? "transaction").trim() || "transaction";
  return {
    id: String(row.id ?? `${step}-${index}-${hash}`),
    index: normalizeInteger(row.index ?? index),
    step,
    hash,
    transactionHash: hash,
    matchIds: normalizeMatchIds(row.matchIds ?? row.match_ids ?? row.matchId ?? row.match_id),
  };
}

function normalizeProofTransactionList(rows) {
  return (Array.isArray(rows) ? rows : []).map(normalizeProofTransaction).filter(Boolean);
}

function normalizeMatchTransaction(row, index) {
  if (!row || typeof row !== "object") return null;
  const matchId = String(row.matchId ?? row.match_id ?? "").trim();
  const hash = normalizeTransactionHash(row.hash ?? row.txHash ?? row.tx_hash ?? row.transactionHash ?? row.transaction_hash);
  if (!matchId && !hash) return null;
  return {
    id: String(row.id ?? `${matchId || "match"}-${index}-${hash || "pending"}`),
    index: normalizeInteger(row.index ?? row.transactionIndex ?? row.transaction_index ?? index),
    matchId,
    matchKey: row.matchKey ?? row.match_key ?? null,
    step: String(row.step ?? row.action ?? "").trim(),
    hash,
    transactionHash: hash,
  };
}

function normalizeMatchTransactionList(rows) {
  return (Array.isArray(rows) ? rows : []).map(normalizeMatchTransaction).filter(Boolean);
}

function normalizeProof(payload) {
  const proof = payload?.proof && typeof payload.proof === "object" ? payload.proof : {};
  const transactions = normalizeProofTransactionList(proof.transactions ?? payload?.transactions ?? payload?.txs);
  const roundTransactions = normalizeProofTransactionList(proof.roundTransactions ?? proof.round_transactions)
    || transactions.filter((tx) => !tx.step.startsWith("revealRoundMatch"));
  const matchTransactions = normalizeMatchTransactionList(proof.matchTransactions ?? proof.match_transactions);
  return {
    ledgerDownloadAvailable: proof.ledgerDownloadAvailable === true || proof.ledger_download_available === true,
    ledgerDownloadUrl: String(proof.ledgerDownloadUrl ?? proof.ledger_download_url ?? "").trim(),
    ticketNamespace: String(proof.ticketNamespace ?? proof.ticket_namespace ?? "").trim(),
    transactions,
    roundTransactions: roundTransactions.length
      ? roundTransactions
      : transactions.filter((tx) => !tx.step.startsWith("revealRoundMatch")),
    matchTransactions,
  };
}

function normalizeWinner(row, index) {
  if (!row || typeof row !== "object") return null;
  const ticketNumber = String(row.ticketNumber ?? row.ticket_number ?? "").trim();
  const prizeSlotIndex = normalizeInteger(row.prizeSlotIndex ?? row.prize_slot_index);
  const revealIndex = normalizeInteger(row.revealIndex ?? row.reveal_index ?? index);
  const roundId = String(row.roundId ?? row.round_id ?? "");
  const matchId = String(row.matchId ?? row.match_id ?? "");
  const walletAddress = String(row.walletAddress ?? row.wallet_address ?? row.userAddress ?? row.user_address ?? "").trim();
  if (!ticketNumber) return null;

  return {
    id: String(row.id ?? [
      roundId || "round",
      matchId || "match",
      ticketNumber,
      revealIndex,
      prizeSlotIndex,
      walletAddress.toLowerCase() || "wallet",
    ].join(":")),
    revealIndex,
    prizeSlotIndex,
    role: String(row.role ?? "winner"),
    alternateIndex: row.alternateIndex ?? row.alternate_index ?? null,
    ticketNumber,
    walletAddress,
    userAddress: String(row.userAddress ?? row.user_address ?? row.walletAddress ?? row.wallet_address ?? "").trim(),
    allocationId: row.allocationId ?? row.allocation_id ?? null,
    roundId,
    matchId,
    teamId: String(row.teamId ?? row.team_id ?? ""),
    transactionHash: normalizeTransactionHash(
      row.transactionHash
        ?? row.transaction_hash
        ?? row.revealTransactionHash
        ?? row.reveal_transaction_hash
        ?? row.txHash
        ?? row.tx_hash,
    ),
    revealTransactionHash: normalizeTransactionHash(row.revealTransactionHash ?? row.reveal_transaction_hash ?? row.transactionHash ?? row.transaction_hash),
    entryRank: row.entryRank ?? row.entry_rank ?? row.rank ?? null,
    interval: row.interval && typeof row.interval === "object" ? row.interval : null,
    profile: normalizeWinnerProfile(row.profile ?? row.userProfile ?? row.user_profile),
  };
}

function normalizeWinnerList(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeWinner)
    .filter(Boolean)
    .sort((left, right) => {
      if (left.revealIndex !== right.revealIndex) return left.revealIndex - right.revealIndex;
      if (left.prizeSlotIndex !== right.prizeSlotIndex) return left.prizeSlotIndex - right.prizeSlotIndex;
      return left.ticketNumber.localeCompare(right.ticketNumber, undefined, { numeric: true });
    });
}

function normalizePrizeSlot(row, index) {
  if (!row || typeof row !== "object") return null;
  const prizeSlotIndex = normalizeInteger(row.prizeSlotIndex ?? row.prize_slot_index ?? index);
  const winner = normalizeWinner(row.winner, prizeSlotIndex);
  const alternates = normalizeWinnerList(row.alternates);
  return {
    prizeSlotIndex,
    winner,
    alternates,
  };
}

function normalizeDraw(row, index) {
  if (!row || typeof row !== "object") return null;
  const matchId = String(row.matchId ?? row.match_id ?? row.id ?? "").trim();
  const roundId = String(row.roundId ?? row.round_id ?? "").trim();
  if (!matchId && !roundId) return null;
  return {
    id: String(row.id ?? `${roundId}-${matchId || index}`),
    matchId,
    matchKey: row.matchKey ?? row.match_key ?? null,
    roundId,
    drawRoundId: row.drawRoundId ?? row.draw_round_id ?? roundId,
    ledgerHash: row.ledgerHash ?? row.ledger_hash ?? null,
    ledgerUri: row.ledgerUri ?? row.ledger_uri ?? null,
    totalTickets: String(row.totalTickets ?? row.total_tickets ?? ""),
    prizeSlotCount: normalizeInteger(row.prizeSlotCount ?? row.prize_slot_count),
    alternateCount: normalizeInteger(row.alternateCount ?? row.alternate_count),
    revealed: Boolean(row.revealed),
    transactionHash: normalizeTransactionHash(
      row.transactionHash
        ?? row.transaction_hash
        ?? row.revealTransactionHash
        ?? row.reveal_transaction_hash
        ?? row.txHash
        ?? row.tx_hash,
    ),
    revealTransactionHash: normalizeTransactionHash(row.revealTransactionHash ?? row.reveal_transaction_hash ?? row.transactionHash ?? row.transaction_hash),
    result: row.result && typeof row.result === "object" ? row.result : null,
    prizeSlots: (Array.isArray(row.prizeSlots) ? row.prizeSlots : [])
      .map(normalizePrizeSlot)
      .filter(Boolean)
      .sort((left, right) => left.prizeSlotIndex - right.prizeSlotIndex),
    winners: normalizeWinnerList(row.winners),
    alternates: normalizeWinnerList(row.alternates),
  };
}

function normalizeDrawList(rows) {
  return (Array.isArray(rows) ? rows : []).map(normalizeDraw).filter(Boolean);
}

function normalizeWinnerRevealSnapshot(payload, fallbackVideoUrl = DEFAULT_WINNER_REVEAL_VIDEO_URL) {
  if (!payload || typeof payload !== "object") {
    return {
      ...emptyWinnerRevealData,
      videoUrl: fallbackVideoUrl || DEFAULT_WINNER_REVEAL_VIDEO_URL,
    };
  }

  const videoUrl = String(payload.videoUrl ?? payload.video_url ?? fallbackVideoUrl ?? DEFAULT_WINNER_REVEAL_VIDEO_URL).trim();
  const proof = normalizeProof(payload);

  return {
    sourceLabel: String(payload.sourceLabel ?? payload.source_label ?? "on-chain-reveal"),
    sourceStatus: String(payload.sourceStatus ?? payload.source_status ?? "pending"),
    generatedAt: payload.generatedAt ?? payload.generated_at ?? null,
    videoUrl: videoUrl || DEFAULT_WINNER_REVEAL_VIDEO_URL,
    network: payload.network ?? null,
    chainId: payload.chainId ?? payload.chain_id ?? null,
    contract: payload.contract ?? null,
    roundId: payload.roundId ?? payload.round_id ?? null,
    sourceRoundId: payload.sourceRoundId ?? payload.source_round_id ?? payload.roundId ?? payload.round_id ?? null,
    drawRoundId: payload.drawRoundId ?? payload.draw_round_id ?? payload.roundId ?? payload.round_id ?? null,
    roundKey: payload.roundKey ?? payload.round_key ?? null,
    matchId: payload.matchId ?? payload.match_id ?? null,
    drawId: payload.drawId ?? payload.draw_id ?? null,
    ledgerHash: payload.ledgerHash ?? payload.ledger_hash ?? null,
    winnerCount: normalizeInteger(payload.winnerCount ?? payload.winner_count),
    alternateCount: normalizeInteger(payload.alternateCount ?? payload.alternate_count),
    proof,
    transactions: proof.transactions,
    txs: proof.transactions,
    winners: normalizeWinnerList(payload.winners),
    winnersBySlot: normalizeWinnerList(payload.winnersBySlot ?? payload.winners_by_slot),
    alternates: normalizeWinnerList(payload.alternates),
    draws: normalizeDrawList(payload.draws),
  };
}

export function normalizeWinnerRevealPayload(payload, fallbackVideoUrl = DEFAULT_WINNER_REVEAL_VIDEO_URL) {
  const normalized = normalizeWinnerRevealSnapshot(payload, fallbackVideoUrl);
  const roundSnapshots = (Array.isArray(payload?.roundSnapshots) ? payload.roundSnapshots : [])
    .map((snapshot) => normalizeWinnerRevealSnapshot(snapshot, fallbackVideoUrl))
    .filter((snapshot) => snapshot.sourceStatus === "revealed" && snapshot.roundId);

  return {
    ...normalized,
    roundSnapshots,
  };
}

export function getEmptyWinnerRevealData(videoUrl = DEFAULT_WINNER_REVEAL_VIDEO_URL) {
  return {
    ...emptyWinnerRevealData,
    videoUrl,
  };
}
