/** What replaces a secret in everything the harness keeps: transcripts, tool outputs, reports. */
export const REDACTED = "[redacted by proctor]"

/**
 * Anthropic credentials (API keys, OAuth tokens), masked even when they are not the configured one.
 * Written `sk-an[t]-` so that grepping the sources and reports for the literal prefix only finds leaks.
 */
const ANTHROPIC_SECRET = /sk-an[t]-[A-Za-z0-9_-]{8,}/g

/** Shorter values are not masked: they would blank ordinary words. */
const MIN_SECRET_LENGTH = 8

/**
 * Builds a function that masks `secrets`, and any Anthropic credential, in a text.
 * Adapters apply it to every line of the agent stream before it is written or parsed,
 * so that no transcript, tool output, grader, judge prompt or report ever holds a credential.
 *
 * @example
 * const redact = redactor([credential.value])
 * redact(`TOKEN=${credential.value}`) // "TOKEN=[redacted by proctor]"
 */
export function redactor(secrets: readonly string[]): (text: string) => string {
  const values = [...new Set(secrets.filter((s) => s.length >= MIN_SECRET_LENGTH))].sort((a, b) => b.length - a.length)
  return (text) => values.reduce((masked, secret) => masked.replaceAll(secret, REDACTED), text).replace(ANTHROPIC_SECRET, REDACTED)
}
