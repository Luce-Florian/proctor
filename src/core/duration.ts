/** A duration with an explicit unit: `"500ms"`, `"30s"`, `"10m"`, `"1h"`. */
export type Duration = `${number}${"ms" | "s" | "m" | "h"}`

const MS_PER_UNIT = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 } as const

/** Longest delay `setTimeout` holds (2^31 - 1 ms, about 596h); a longer one would fire at once. */
export const MAX_DURATION_MS = 2_147_483_647

/**
 * Converts a {@link Duration} to milliseconds.
 *
 * @example
 * parseDuration("10m") // 600000
 * parseDuration("1.5s") // 1500
 */
export function parseDuration(duration: Duration): number {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(duration)
  const unit = match?.[2] as keyof typeof MS_PER_UNIT | undefined
  if (!match || !unit) {
    throw new Error(`Invalid duration "${duration}": use a number followed by ms, s, m or h, e.g. "10m".`)
  }
  const ms = Math.round(Number(match[1]) * MS_PER_UNIT[unit])
  if (ms <= 0) throw new Error(`Invalid duration "${duration}": it must be greater than zero.`)
  if (ms > MAX_DURATION_MS) throw new Error(`Invalid duration "${duration}": it must be at most 596h.`)
  return ms
}

/**
 * Formats milliseconds with the largest unit that keeps an integer, for messages.
 *
 * @example
 * formatDuration(600_000) // "10m"
 * formatDuration(1_500) // "1500ms"
 */
export function formatDuration(ms: number): Duration {
  const units = [
    ["h", 3_600_000],
    ["m", 60_000],
    ["s", 1_000],
  ] as const
  const unit = units.find(([, size]) => ms % size === 0)
  return unit ? `${ms / unit[1]}${unit[0]}` : `${ms}ms`
}
