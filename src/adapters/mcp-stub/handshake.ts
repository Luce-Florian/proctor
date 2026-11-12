import { DEFAULT_PROTOCOL_VERSION } from "../../ports/mcp-stub-rules.mjs"
import type { McpStubDefinition } from "../../ports/mcp-stub.ts"
import type { Workspace } from "../../ports/workspace.ts"
import { clip } from "../../shared/text.ts"
import { runProcess } from "../process.ts"
import { readServedStubLogs } from "./call-log.ts"
import { materializeStubs, type StubEntry } from "./materialize.ts"

/** What an agent sends a stdio MCP server before it can call a tool: one JSON-RPC message per line. */
const HANDSHAKE = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: DEFAULT_PROTOCOL_VERSION, capabilities: {} } },
  { jsonrpc: "2.0", method: "notifications/initialized" },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
]
  .map((message) => `${JSON.stringify(message)}\n`)
  .join("")

/** Characters of the sandbox stderr kept in the error: enough for the whole srt or bubblewrap message. */
const MAX_STDERR = 2_000

/**
 * Starts each stub through `workspace.wrap`, as an agent would inside the sandbox, and has it list its tools: Node must
 * be readable, the configuration valid, the log writable. Does nothing for a workspace without `wrap` (`fake`,
 * `local-temp`). Lets `--agent fake --sandbox srt` check the stubs at no LLM cost. The stubs start together; the first
 * that failed, in declaration order, is the one reported.
 *
 * @example
 * await handshakeStubs(input.mcpStubs, workspace, signal) // throws 'The MCP stub "pgsql" did not start in the sandbox: …'
 */
export async function handshakeStubs(stubs: readonly McpStubDefinition[], workspace: Workspace, signal: AbortSignal): Promise<void> {
  const { wrap } = workspace
  if (!wrap || stubs.length === 0) return
  const entries = await materializeStubs(stubs, workspace)
  const failures = await Promise.all(entries.map((entry) => handshakeFailure(entry, wrap, workspace, signal)))
  const [firstFailure] = failures.filter((failure) => failure !== undefined)
  if (firstFailure) throw firstFailure
  await readServedStubLogs(entries, workspace)
}

/** Runs the handshake with one stub through the sandbox; the error that says why it did not start, if it did not. */
async function handshakeFailure(
  entry: StubEntry,
  wrap: NonNullable<Workspace["wrap"]>,
  workspace: Workspace,
  signal: AbortSignal,
): Promise<Error | undefined> {
  const result = await runProcess(wrap({ file: entry.command, args: entry.args }), {
    cwd: workspace.cwd,
    env: workspace.env,
    input: HANDSHAKE,
    signal,
  })
  if (result.code === 0) return undefined
  const stderr = clip(result.stderr.trim(), MAX_STDERR) || "no stderr"
  return new Error(`The MCP stub "${entry.name}" did not start in the sandbox (exit ${String(result.code)}): ${stderr}`)
}
