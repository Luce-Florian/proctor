import { describe, expect, it } from "vitest"
import { CLAUDE_AUTH_PROFILES } from "../adapters/agents/claude-code/credentials.ts"
import { resolveCredential as resolve } from "./credential-resolver.ts"

const resolveCredential = (env: Record<string, string>, forced?: string) => resolve("claude-code", CLAUDE_AUTH_PROFILES, env, forced)

describe("resolveCredential", () => {
  const token = { CLAUDE_CODE_OAUTH_TOKEN: "fake-oauth-token" }

  it("reads the OAuth token from the environment", () => {
    expect(resolveCredential(token)).toEqual({ profile: "oauth", variable: "CLAUDE_CODE_OAUTH_TOKEN", value: "fake-oauth-token" })
    expect(resolveCredential(token, "oauth")).toMatchObject({ profile: "oauth" })
  })

  it("says which variable to set when nothing is found", () => {
    expect(() => resolveCredential({ CLAUDE_CODE_OAUTH_TOKEN: "  " })).toThrow(
      "No credential for claude-code: run `claude setup-token` and export the token as CLAUDE_CODE_OAUTH_TOKEN (profile oauth).",
    )
  })

  it("says what a forced profile lacks, and rejects an unknown one", () => {
    expect(() => resolveCredential({}, "oauth")).toThrow("--auth oauth needs CLAUDE_CODE_OAUTH_TOKEN: run `claude setup-token`")
    expect(() => resolveCredential(token, "keychain")).toThrow('Unknown --auth "keychain" for claude-code. Use one of: oauth, api-key.')
  })

  it("keeps the api-key profile for later, with an actionable error", () => {
    expect(() => resolveCredential({ ANTHROPIC_API_KEY: "k", ...token }, "api-key")).toThrow(
      "--auth api-key: profile api-key (ANTHROPIC_API_KEY) is not validated yet: use --auth oauth with CLAUDE_CODE_OAUTH_TOKEN.",
    )
  })
})
