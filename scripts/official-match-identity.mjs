export const LEGACY_TO_OFFICIAL_MATCH_IDS = Object.freeze({
  m73: 'M89',
  m74: 'M90',
  m75: 'M91',
  m76: 'M92',
  m77: 'M93',
  m78: 'M94',
  m79: 'M95',
  m80: 'M96',
  qf1: 'M97',
  qf2: 'M98',
  qf3: 'M99',
  qf4: 'M100',
  sf1: 'M101',
  sf2: 'M102',
  f1: 'M104',
})

export function canonicalMatchId(value) {
  const matchId = String(value || '').trim()
  return LEGACY_TO_OFFICIAL_MATCH_IDS[matchId] || matchId
}
