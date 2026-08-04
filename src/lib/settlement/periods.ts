/**
 * Period maths, mirroring period_start_for() in the database exactly.
 *
 * Dates are handled as YYYY-MM-DD strings with UTC-based Date objects so the
 * result never shifts when the browser is in a different timezone from the
 * household. period_start_day is constrained to 1..28 in the database, which
 * removes every month-length edge case from this file.
 */

export type IsoDate = string

export function toIso(d: Date): IsoDate {
  return d.toISOString().slice(0, 10)
}

export function fromIso(s: IsoDate): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function todayIso(timeZone = 'Asia/Kolkata'): IsoDate {
  // en-CA gives YYYY-MM-DD, which is exactly the shape we want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = fromIso(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return toIso(d)
}

export function addMonths(iso: IsoDate, months: number): IsoDate {
  const d = fromIso(iso)
  const day = d.getUTCDate()
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, lastDay))
  return toIso(d)
}

/** First day of the settlement period containing `iso`. */
export function periodStartFor(iso: IsoDate, startDay: number): IsoDate {
  const d = fromIso(iso)
  const anchor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), startDay))
  if (d.getUTCDate() >= startDay) return toIso(anchor)
  anchor.setUTCMonth(anchor.getUTCMonth() - 1)
  return toIso(anchor)
}

/** Last day of the settlement period beginning on `startIso`. */
export function periodEndFor(startIso: IsoDate): IsoDate {
  return addDays(addMonths(startIso, 1), -1)
}

export function periodRangeFor(iso: IsoDate, startDay: number): { startsOn: IsoDate; endsOn: IsoDate } {
  const startsOn = periodStartFor(iso, startDay)
  return { startsOn, endsOn: periodEndFor(startsOn) }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * "August 2026" when the period is a calendar month, otherwise
 * "28 Jul – 27 Aug 2026" so a salary-cycle household is never misled.
 */
export function formatPeriodLabel(startsOn: IsoDate, endsOn: IsoDate): string {
  const s = fromIso(startsOn)
  const e = fromIso(endsOn)
  if (s.getUTCDate() === 1) {
    return `${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`
  }
  const short = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`
  return `${short(s)} – ${short(e)} ${e.getUTCFullYear()}`
}

export function formatDayLabel(iso: IsoDate, today = todayIso()): string {
  if (iso === today) return 'Today'
  if (iso === addDays(today, -1)) return 'Yesterday'
  const d = fromIso(iso)
  const sameYear = d.getUTCFullYear() === fromIso(today).getUTCFullYear()
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)}`
  return sameYear ? base : `${base} ${d.getUTCFullYear()}`
}
