import type { CredentialProfile } from "../../../auth/credential-resolver.ts"

/** How Claude Code authenticates in the harness. */
export type ClaudeAuthProfile = "oauth" | "api-key"

/**
 * Profiles tried in order when `--auth` is omitted. `api-key` is planned: the config layer is the same,
 * only the variable changes, but it is not validated yet.
 */
export const CLAUDE_AUTH_PROFILES: Readonly<Record<ClaudeAuthProfile, CredentialProfile>> = {
  oauth: { variable: "CLAUDE_CODE_OAUTH_TOKEN", howTo: "run `claude setup-token` and export the token as CLAUDE_CODE_OAUTH_TOKEN" },
  "api-key": {
    variable: "ANTHROPIC_API_KEY",
    howTo: "set ANTHROPIC_API_KEY",
    unavailable: "profile api-key (ANTHROPIC_API_KEY) is not validated yet: use --auth oauth with CLAUDE_CODE_OAUTH_TOKEN",
  },
}

/** Domains the CLI needs for each profile; everything else stays blocked under an OS sandbox. */
export const MODEL_API_DOMAINS: Readonly<Record<ClaudeAuthProfile, readonly string[]>> = {
  "api-key": ["api.anthropic.com"],
  oauth: ["api.anthropic.com", "claude.ai", "platform.claude.com"],
}
