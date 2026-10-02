import { describe, expect, it } from "vitest"
import { REDACTED, redactor } from "./redact.ts"

/** The Anthropic key prefix, assembled so that grepping the repository for it only finds real leaks. */
const ANTHROPIC = ["sk", "ant", ""].join("-")

describe("redactor", () => {
  it("masks every occurrence of a configured secret", () => {
    const redact = redactor(["s3cr3t-value-123"])

    expect(redact('{"out":"A=s3cr3t-value-123 B=s3cr3t-value-123"}')).toBe(`{"out":"A=${REDACTED} B=${REDACTED}"}`)
  })

  it("masks any Anthropic credential, even one it was not given", () => {
    expect(redactor([])(`key ${ANTHROPIC}api03-AbC_d-9xyz and ${ANTHROPIC}oat01-QwErTy12`)).toBe(`key ${REDACTED} and ${REDACTED}`)
  })

  it("ignores values too short to be a credential, and leaves other text alone", () => {
    const redact = redactor(["", "abc"])

    expect(redact(`abc ${ANTHROPIC} plain text`)).toBe(`abc ${ANTHROPIC} plain text`)
  })

  it("masks the longer secret first when one contains another", () => {
    expect(redactor(["token-1234", "token-1234-extended"])("x token-1234-extended")).toBe(`x ${REDACTED}`)
  })
})
