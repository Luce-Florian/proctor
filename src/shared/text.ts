/**
 * Cuts `text` to at most `max` characters, an ellipsis included, for a message or a report cell.
 *
 * @example
 * clip("a very long reason line", 10) // "a very lo…"
 */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Length a line of the agent's answer is cut to when a verdict quotes it. */
export const MAX_QUOTED = 60

/**
 * The value of a JSON text, or `undefined` when it is not JSON: for lines a program or an agent may have written.
 *
 * @example
 * parseJsonOrUndefined('{"event":"initialize"}') // { event: "initialize" }
 * parseJsonOrUndefined("not json") // undefined
 */
export function parseJsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
