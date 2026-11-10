import { execFileSync } from "node:child_process"
import { mkdir, symlink, truncate, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { checkStubsReady, readStubLogs, type StubLog } from "./call-log.ts"
import { stubLogPath } from "./materialize.ts"
import { tempWorkspace } from "#test/helpers.ts"

/** The entry of pgsql, with two tools. */
const pgsql = { name: "pgsql", tools: ["list_instances", "get_object_details"] }

const logOf = (...events: StubLog["events"]): StubLog[] => [{ server: "pgsql", events }]

describe("readStubLogs", () => {
  it("reads nothing for a stub that never started", async () => {
    const workspace = await tempWorkspace()

    expect(await readStubLogs([pgsql], workspace)).toEqual(logOf())
  })

  it("skips the lines that are not stub events, which the agent may have written in the log", async () => {
    const workspace = await tempWorkspace()
    const log = stubLogPath(workspace, "pgsql")
    await mkdir(dirname(log), { recursive: true })
    await writeFile(log, '{"event":"initialize"}\nnot json\n{"event":"call","tool":"list_instances"}\n')

    expect(await readStubLogs([pgsql], workspace)).toEqual(logOf({ event: "initialize" }))
  })
})

describe("readStubLogs on a log the agent tampered with", () => {
  /** A workspace whose pgsql log directory exists, without the log. */
  async function withLogDir() {
    const workspace = await tempWorkspace()
    const log = stubLogPath(workspace, "pgsql")
    await mkdir(dirname(log), { recursive: true })
    return { workspace, log }
  }

  it("refuses a log replaced by a symbolic link to a host file", async () => {
    const { workspace, log } = await withLogDir()
    const secret = join(dirname(workspace.home), "secret.txt")
    await writeFile(secret, '{"event":"initialize"}\n')
    await symlink(secret, log)

    await expect(readStubLogs([pgsql], workspace)).rejects.toThrow(
      'The MCP stub "pgsql" log cannot be trusted: ".proctor/mcp/pgsql.jsonl" is not a regular file',
    )
  })

  it("refuses a log replaced by a FIFO, whose read would hang", async () => {
    const { workspace, log } = await withLogDir()
    execFileSync("mkfifo", [log])

    await expect(readStubLogs([pgsql], workspace)).rejects.toThrow(
      'The MCP stub "pgsql" log cannot be trusted: ".proctor/mcp/pgsql.jsonl" is not a regular file',
    )
  })

  it("refuses a log over the size a stub writes", async () => {
    const { workspace, log } = await withLogDir()
    await writeFile(log, "")
    await truncate(log, 5 * 1024 * 1024)

    await expect(readStubLogs([pgsql], workspace)).rejects.toThrow(
      'The MCP stub "pgsql" log cannot be trusted: ".proctor/mcp/pgsql.jsonl" holds 5242880 bytes',
    )
  })
})

describe("checkStubsReady", () => {
  it("passes when every stub listed every tool it declares", () => {
    const ready = logOf({ event: "initialize" }, { event: "tools/list", tools: ["list_instances", "get_object_details"] })

    expect(() => checkStubsReady([pgsql], ready)).not.toThrow()
  })

  it.each([
    [
      "never started",
      logOf(),
      'The MCP stub "pgsql" never started: rerun with --sandbox local-temp to tell a sandbox denial from an agent that did not spawn it',
    ],
    [
      "was never asked for its tools",
      logOf({ event: "initialize" }),
      'The MCP stub "pgsql" started, but the agent never listed its tools, so it could not call them',
    ],
    [
      "listed fewer tools than declared",
      logOf({ event: "initialize" }, { event: "tools/list", tools: ["list_instances"] }),
      'The MCP stub "pgsql" did not list "get_object_details": its configuration is not the one declared',
    ],
  ])("fails the trial when a stub %s", (_, logs, message) => {
    expect(() => checkStubsReady([pgsql], logs)).toThrow(message)
  })
})
