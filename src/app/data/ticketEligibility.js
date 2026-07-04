export const CARRYOVER_LOCKED_ROUND_ID = "round32";
export const BUYBACK_LOCKED_ROUND_ID = "round32";
export const INSIDER_PRACTICE_ROUND_ID = "round32";
export const SHARED_INSIDER_GRANT_ROUND_IDS = ["round16", "quarterFinal", "semiFinal", "final"];
export const SHARED_INSIDER_GRANT_ROUND_SET = new Set(SHARED_INSIDER_GRANT_ROUND_IDS);

export function toTicketInteger(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

export function roundAllowsCarryoverTickets(roundId) {
  return String(roundId || "") !== CARRYOVER_LOCKED_ROUND_ID;
}

export function roundAllowsBuybackTickets(roundId) {
  return String(roundId || "") !== BUYBACK_LOCKED_ROUND_ID;
}

export function roundAllowsInsiderPracticeTickets(roundId) {
  return String(roundId || "") === INSIDER_PRACTICE_ROUND_ID;
}

export function roundAllowsSharedInsiderGrantTickets(roundId) {
  return SHARED_INSIDER_GRANT_ROUND_SET.has(String(roundId || ""));
}

export function roundUsesSharedVotingTicketPool(roundId) {
  return SHARED_INSIDER_GRANT_ROUND_SET.has(String(roundId || ""));
}

export function ticketsUsedByWalletInRound(allocations, walletAddress, roundId) {
  const normalizedWallet = String(walletAddress || "").trim().toLowerCase();
  const normalizedRound = String(roundId || "");
  if (!normalizedWallet || !normalizedRound) return 0;

  return (Array.isArray(allocations) ? allocations : []).reduce((total, allocation) => {
    const allocationWallet = String(allocation?.walletAddress || "").trim().toLowerCase();
    if (allocationWallet !== normalizedWallet || String(allocation?.roundId || "") !== normalizedRound) return total;
    return total + toTicketInteger(allocation?.tickets);
  }, 0);
}

export function getTicketBreakdownForRound(entry, roundId) {
  const rawTickets = toTicketInteger(entry?.rawTickets ?? entry?.raw_tickets);
  const carryoverTickets = toTicketInteger(entry?.carryoverTickets ?? entry?.carryover_tickets);
  const insiderPracticeTickets = toTicketInteger(entry?.insiderPracticeTickets ?? entry?.insider_practice_tickets);
  const taskRewardTickets = toTicketInteger(entry?.taskRewardTickets ?? entry?.task_reward_tickets);
  const insiderGrantTickets = Math.max(
    taskRewardTickets,
    toTicketInteger(entry?.insiderGrantTickets ?? entry?.insider_grant_tickets),
  );
  const fallbackFinalTickets = toTicketInteger(entry?.finalTickets ?? entry?.final_tickets);
  const buybackUnlocked = roundAllowsBuybackTickets(roundId);
  const carryoverUnlocked = roundAllowsCarryoverTickets(roundId);
  const insiderPracticeUnlocked = roundAllowsInsiderPracticeTickets(roundId);
  const insiderGrantUnlocked = roundAllowsSharedInsiderGrantTickets(roundId);
  const baseTickets = (buybackUnlocked ? rawTickets : 0) + (carryoverUnlocked ? carryoverTickets : 0);
  const usableInsiderPracticeTickets = insiderPracticeUnlocked ? insiderPracticeTickets : 0;
  const usableInsiderGrantTickets = insiderGrantUnlocked ? insiderGrantTickets : 0;
  const totalTickets = rawTickets + carryoverTickets + insiderPracticeTickets + insiderGrantTickets;

  return {
    rawTickets,
    carryoverTickets,
    insiderPracticeTickets,
    insiderGrantTickets,
    taskRewardTickets,
    finalTickets: Math.max(fallbackFinalTickets, rawTickets + carryoverTickets),
    totalTickets,
    baseTickets,
    usableTickets: baseTickets + usableInsiderPracticeTickets + usableInsiderGrantTickets,
    lockedRawTickets: buybackUnlocked ? 0 : rawTickets,
    lockedCarryoverTickets: carryoverUnlocked ? 0 : carryoverTickets,
    lockedInsiderPracticeTickets: insiderPracticeUnlocked ? 0 : insiderPracticeTickets,
    lockedInsiderGrantTickets: insiderGrantUnlocked ? 0 : insiderGrantTickets,
    usableInsiderPracticeTickets,
    usableInsiderGrantTickets,
    buybackUnlocked,
    carryoverUnlocked,
    insiderPracticeUnlocked,
    insiderGrantUnlocked,
  };
}

export function getSharedInsiderGrantTicketsUsed(allocations, walletAddress, entry, options = {}) {
  const sharedTicketsUsed = getSharedVotingTicketPoolTicketsUsed(allocations, walletAddress, options);
  const baseTickets = getTicketBreakdownForRound(entry, SHARED_INSIDER_GRANT_ROUND_IDS[0]).baseTickets;

  return Math.max(0, sharedTicketsUsed - baseTickets);
}

export function getSharedVotingTicketPoolTicketsUsed(allocations, walletAddress, options = {}) {
  const overrideRoundId = String(options.overrideRoundId || "");
  const hasOverride = overrideRoundId && Number.isFinite(Number(options.overrideRoundTickets));
  const excludeRoundId = String(options.excludeRoundId || "");

  return SHARED_INSIDER_GRANT_ROUND_IDS.reduce((total, roundId) => {
    if (excludeRoundId && roundId === excludeRoundId) return total;
    const roundTickets = hasOverride && roundId === overrideRoundId
      ? toTicketInteger(options.overrideRoundTickets)
      : ticketsUsedByWalletInRound(allocations, walletAddress, roundId);
    return total + roundTickets;
  }, 0);
}

export function getRoundTicketAvailability({ entry, roundId, allocations, walletAddress }) {
  const breakdown = getTicketBreakdownForRound(entry, roundId);
  const usedRoundTickets = ticketsUsedByWalletInRound(allocations, walletAddress, roundId);

  if (!roundUsesSharedVotingTicketPool(roundId)) {
    return {
      ...breakdown,
      usedRoundTickets,
      sharedVotingTicketPoolTicketsUsed: 0,
      sharedVotingTicketPoolTicketsRemaining: 0,
      sharedInsiderGrantTicketsUsed: 0,
      sharedInsiderGrantTicketsRemaining: 0,
      usedTickets: usedRoundTickets,
      remainingTickets: Math.max(0, breakdown.usableTickets - usedRoundTickets),
    };
  }

  const sharedVotingTicketPoolTicketsUsed = getSharedVotingTicketPoolTicketsUsed(allocations, walletAddress);
  const sharedVotingTicketPoolTicketsRemaining = Math.max(
    0,
    breakdown.usableTickets - sharedVotingTicketPoolTicketsUsed,
  );
  const sharedInsiderGrantTicketsUsed = getSharedInsiderGrantTicketsUsed(allocations, walletAddress, entry);
  const sharedInsiderGrantTicketsRemaining = Math.max(
    0,
    breakdown.insiderGrantTickets - sharedInsiderGrantTicketsUsed,
  );
  const baseTicketsRemaining = Math.max(0, breakdown.baseTickets - sharedVotingTicketPoolTicketsUsed);

  return {
    ...breakdown,
    usedRoundTickets,
    sharedVotingTicketPoolTicketsUsed,
    sharedVotingTicketPoolTicketsRemaining,
    baseTicketsRemaining,
    sharedInsiderGrantTicketsUsed,
    sharedInsiderGrantTicketsRemaining,
    usedTickets: sharedVotingTicketPoolTicketsUsed,
    remainingTickets: sharedVotingTicketPoolTicketsRemaining,
  };
}
