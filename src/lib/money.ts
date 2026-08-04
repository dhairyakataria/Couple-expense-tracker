/**
 * Money is always integer paise. Never floats, never strings, anywhere but the
 * boundary of this module.
 */

export const PAISE_PER_RUPEE = 100

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const inrWithPaise = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** ₹1,23,456 — Indian grouping, rupees only. The default everywhere in the UI. */
export function formatPaise(paise: number): string {
  return inr.format(Math.round(paise / PAISE_PER_RUPEE))
}

/** ₹1,23,456.78 — used only where exactness matters (settlement detail). */
export function formatPaiseExact(paise: number): string {
  return inrWithPaise.format(paise / PAISE_PER_RUPEE)
}

/** Compact form for dense dashboard tiles: ₹1.2L, ₹45.6k */
export function formatPaiseCompact(paise: number): string {
  const rupees = Math.abs(paise) / PAISE_PER_RUPEE
  const sign = paise < 0 ? '-' : ''
  if (rupees >= 10_000_000) return `${sign}₹${(rupees / 10_000_000).toFixed(1)}Cr`
  if (rupees >= 100_000) return `${sign}₹${(rupees / 100_000).toFixed(1)}L`
  if (rupees >= 1_000) return `${sign}₹${(rupees / 1_000).toFixed(1)}k`
  return `${sign}₹${Math.round(rupees)}`
}

/**
 * Parse user input into paise. Accepts "1200", "1,200", "1200.50", "₹1200".
 * Returns null for anything it cannot read — never NaN, never a guess.
 */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '')
  if (cleaned === '' || cleaned === '.') return null
  if (!/^-?\d*\.?\d*$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  return Math.round(value * PAISE_PER_RUPEE)
}

export function paiseToRupeeString(paise: number): string {
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / PAISE_PER_RUPEE)
  const remainder = abs % PAISE_PER_RUPEE
  const sign = paise < 0 ? '-' : ''
  return remainder === 0
    ? `${sign}${rupees}`
    : `${sign}${rupees}.${String(remainder).padStart(2, '0')}`
}

/** Rounded to the nearest whole rupee, expressed in paise. */
export function roundToRupee(paise: number): number {
  return Math.round(paise / PAISE_PER_RUPEE) * PAISE_PER_RUPEE
}
