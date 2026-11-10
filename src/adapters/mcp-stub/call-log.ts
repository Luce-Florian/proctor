import { lstat } from "node:fs/promises"
import { relative } from "node:path"
import { z } from "zod"
import { MCP_ANSWERED_BY } from "../../ports/mcp-stub.ts"
import type { Workspace } from "../../ports/workspace.ts"
import { readWorkspaceFile } from "../../shared/fs.ts"
import { parseJsonOrUndefined } from "../../shared/text.ts"
import { stubLogPath, type StubEntry } from "./materialize.ts"
import type { StubLogEvent } from "./stub-server.mjs"

/** What one stub logged during a trial, in order; empty when it never started. */
export interface StubLog {
  readonly server: string
  readonly events: readonly StubLogEvent[]
}

const logEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("initialize") }),
  z.object({ event: z.literal("tools/list"), tools: z.array(z.string()) }),
  z.object({ event: z.literal("call"), tool: z.string(), input: z.unknown(), answeredBy: z.enum(MCP_ANSWERED_BY) }),
])

/**
 * Reads what each stub logged during the trial. The agent can write the log too: a line that is not a stub event is
 * skipped, and the agent's own stream stays the source of truth for what it called. Throws, naming the stub, for a log
 * the harness will not read (see {@link readStubLog}).
 *
 * @example
 * await readStubLogs(entries, workspace) // [{ server: "pgsql", events: [{ event: "initialize" }, ...] }]
 */
export async function readStubLogs(entries: readonly Pick<StubEntry, "name">[], workspace: Workspace): Promise<StubLog[]> {
  return Promise.all(
    entries.map(async ({ name: server }) => {
      const text = await readStubLog(workspace, server)
      const events = text.split("\n").flatMap((line) => {
        const parsed = logEventSchema.safeParse(parseJsonOrUndefined(line))
        return parsed.success ? [parsed.data] : []
      })
      return { server, events }
    }),
  )
}

/**
 * The most a stub log may hold. A stub writes one short line per call, so a few MiB is far beyond any trial; past it,
 * the agent wrote the log, and reading it whole could exhaust the harness's memory.
 */
const MAX_STUB_LOG_BYTES = 4 * 1024 * 1024

/**
 * The text of one stub's log, empty when the stub never started. The log sits in the trial home, which the agent can
 * write, and the harness reads it outside the sandbox: a log turned into a symbolic link (to a host secret), a FIFO or a
 * device (which would hang the read), or grown past {@link MAX_STUB_LOG_BYTES} is refused, never read as empty.
 */
async function readStubLog(workspace: Workspace, server: string): Promise<string> {
  const log = stubLogPath(workspace, server)
  const written = await lstat(log).catch(() => undefined)
  if (!written) return ""
  try {
    return await readWorkspaceFile(workspace.home, relative(workspace.home, log), { maxBytes: MAX_STUB_LOG_BYTES })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `The MCP stub "${server}" log cannot be trusted: ${reason}. The agent can write the trial home: check what the run did to .proctor/mcp/`,
    )
  }
}

/**
 * Throws when a stub did not serve the run: it never started, the agent never listed its tools, or it listed fewer tools
 * than declared. A trial measured without its server would grade the skill as if the server were absent. The check
 * reads the stubs' own logs, so it holds whatever the agent.
 *
 * @example
 * checkStubsReady(entries, await readStubLogs(entries, workspace))
 * // throws 'The MCP stub "pgsql" never started: ...'
 */
export function checkStubsReady(entries: readonly Pick<StubEntry, "name" | "tools">[], logs: readonly StubLog[]): void {
  const problems = entries.flatMap((entry) => readinessProblems(entry, logs.find((log) => log.server === entry.name)?.events ?? []))
  if (problems.length > 0) throw new Error(problems.join("; "))
}

function readinessProblems(entry: Pick<StubEntry, "name" | "tools">, events: readonly StubLogEvent[]): string[] {
  const name = `The MCP stub "${entry.name}"`
  if (!events.some((event) => event.event === "initialize")) {
    return [`${name} never started: rerun with --sandbox local-temp to tell a sandbox denial from an agent that did not spawn it`]
  }
  const listed = events.findLast((event) => event.event === "tools/list")
  if (!listed) return [`${name} started, but the agent never listed its tools, so it could not call them`]
  const missing = entry.tools.filter((tool) => !listed.tools.includes(tool))
  return missing.length > 0
    ? [`${name} did not list ${missing.map((tool) => `"${tool}"`).join(", ")}: its configuration is not the one declared`]
    : []
}
