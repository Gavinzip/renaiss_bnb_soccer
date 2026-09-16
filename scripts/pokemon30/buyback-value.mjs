const MONEY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/
const USDT_WEI = 10n ** 18n

function normalizedMoneyText(value) {
  return String(value ?? '')
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/,/g, '')
}

export function parseUsdCents(value) {
  const match = normalizedMoneyText(value).match(MONEY_PATTERN)
  if (!match) return null

  const whole = Number(match[1])
  const fraction = Number((match[2] || '').padEnd(2, '0'))
  if (!Number.isSafeInteger(whole) || !Number.isSafeInteger(fraction)) return null

  const cents = whole * 100 + fraction
  return Number.isSafeInteger(cents) ? cents : null
}

export function formatUsdCents(value) {
  const cents = Number(value)
  if (!Number.isSafeInteger(cents) || cents < 0) return ''
  const whole = Math.floor(cents / 100)
  const fraction = cents % 100
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`
}

export function usdCentsToUsdtWei(cents) {
  const normalized = Number(cents)
  if (!Number.isSafeInteger(normalized) || normalized < 0) return null
  return BigInt(normalized) * 10n ** 16n
}

export function applyBasisPoints(value, basisPoints) {
  try {
    const amount = BigInt(value)
    const rate = BigInt(basisPoints)
    if (amount < 0n || rate < 0n || rate > 10_000n) return null
    return amount * rate / 10_000n
  } catch {
    return null
  }
}

export function parseUsdtWei(value) {
  const text = String(value ?? '').trim()
  if (!/^(0|[1-9]\d*)$/.test(text)) return null
  try {
    return BigInt(text)
  } catch {
    return null
  }
}

export function formatUsdtWei(value) {
  const amount = parseUsdtWei(value)
  if (amount === null) return ''
  const whole = amount / USDT_WEI
  const fraction = (amount % USDT_WEI).toString().padStart(18, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}
