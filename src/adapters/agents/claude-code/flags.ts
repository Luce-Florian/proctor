import type { AgentRunInput, Permissions } from "../../../ports/agent.ts"

/**
 * The CLI flags shared by every run, whatever the credential. Verified on Claude Code 2.1.280:
 * - `--setting-sources user` reads only `$CLAUDE_CONFIG_DIR/settings.json`, a temp file the harness owns:
 *   the host settings and the cloned repo's `.claude/settings*.json` are ignored, while hooks, skills and
 *   plugin installs keep working (`--bare` and `--safe-mode` both drop hooks; `--safe-mode` also drops the
 *   skills and agents of `--plugin-dir` plugins).
 * - `--strict-mcp-config` with an explicit `--mcp-config`: only declared MCP servers load, no claude.ai connector.
 * - `--no-session-persistence`: nothing is written to resume later; the stream is the transcript.
 */
const BASE_FLAGS = ["--output-format", "stream-json", "--verbose", "--no-session-persistence", "--setting-sources", "user"]

/** Permission levels as Claude Code flags. `readonly` keeps only the Read tool; nothing ever prompts. */
const PERMISSION_FLAGS: Readonly<Record<Permissions, readonly string[]>> = {
  readonly: ["--permission-mode", "dontAsk", "--tools", "Read"],
  "workspace-write": ["--permission-mode", "acceptEdits", "--permission-prompts", "none"],
  full: ["--permission-mode", "bypassPermissions"],
}

/**
 * Translates an agent-neutral run into `claude` arguments. The prompt is not one of them: the adapter writes it on
 * stdin, which `claude -p` reads when no prompt argument is given. An argument is capped (128 KiB on Linux), and srt
 * re-quotes the whole command into one shell string, where each `'` takes 5 bytes.
 *
 * @example
 * claudeArgs(input, { pluginDirs: ["/tmp/ws/home/.proctor/plugins/0-sdlc"] })
 * // ["-p", "--output-format", "stream-json", ..., "--plugin-dir", "/tmp/ws/home/..."]
 */
export function claudeArgs(
  input: Pick<AgentRunInput, "mcpServers" | "model" | "permissions" | "settings">,
  plugins: { readonly pluginDirs: readonly string[] },
): string[] {
  const hasSettings = Object.keys(input.settings).length > 0
  return [
    "-p",
    ...BASE_FLAGS,
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: input.mcpServers }),
    ...(hasSettings ? ["--settings", JSON.stringify(input.settings)] : []),
    ...(input.model !== undefined ? ["--model", input.model] : []),
    ...PERMISSION_FLAGS[input.permissions],
    ...plugins.pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
  ]
}

/**
 * Environment variables that keep the CLI from reaching beyond the model API:
 * no auto-update, no telemetry or error reporting, no claude.ai connectors, no marketplace auto-install.
 */
export const QUIET_ENV: Readonly<Record<string, string>> = {
  DISABLE_AUTOUPDATER: "1",
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: "1",
}
