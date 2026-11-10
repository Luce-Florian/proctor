import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { serializeStub } from "../../ports/mcp-stub-rules.mjs"
import type { McpStubDefinition } from "../../ports/mcp-stub.ts"
import type { Workspace } from "../../ports/workspace.ts"

/** The `src/` directory of the package, which the stub files are copied from. */
const SOURCE_ROOT = new URL("../../", import.meta.url)

/** The stub program, under `src/`. */
const STUB_PROGRAM = "adapters/mcp-stub/stub-server.mjs"

/**
 * What the stub program needs in each trial: itself and the rules module it imports. Copied because the package often
 * sits under the host home, hidden by the sandbox; each copy keeps its path under `src/`, so that the program's relative
 * import of the rules resolves in the trial home as in the package.
 */
const STUB_FILES = [STUB_PROGRAM, "ports/mcp-stub-rules.mjs"]

/**
 * A stub as any agent declares a stdio MCP server: a name, and the command that serves it. The command runs Node by
 * absolute path, the one running the harness: the sandbox `PATH` drops the host home, where nvm or volta install it.
 */
export interface StubEntry {
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  /** The tools the stub lists, for the checks that it served them. */
  readonly tools: readonly string[]
}

/**
 * Where the stub files sit: the trial home. The agent can read them there, and their paths and contents say they are
 * stubs; only what the session shows, server and tool names and answers, looks like the real server.
 */
const stubDir = (workspace: Workspace) => join(workspace.home, ".proctor", "mcp")
const configPath = (workspace: Workspace, server: string) => join(stubDir(workspace), `${server}.json`)

/**
 * Where a stub appends what it does during a trial: the trial home, which every sandbox lets it write.
 *
 * @example
 * stubLogPath(workspace, "pgsql") // "<home>/.proctor/mcp/pgsql.jsonl"
 */
export const stubLogPath = (workspace: Workspace, server: string): string => join(stubDir(workspace), `${server}.jsonl`)

/**
 * Copies the stub program and its rules into the trial home and writes one configuration per stub next to them. Runs
 * outside the agent's sandbox, before the run. Returns the entry each agent adapter declares to its agent.
 *
 * @example
 * await materializeStubs(input.mcpStubs, workspace)
 * // [{ name: "pgsql", command: "/usr/local/bin/node", args: ["<home>/.proctor/mcp/adapters/mcp-stub/stub-server.mjs", "<home>/.proctor/mcp/pgsql.json", ...], tools: [...] }]
 */
export async function materializeStubs(stubs: readonly McpStubDefinition[], workspace: Workspace): Promise<StubEntry[]> {
  if (stubs.length === 0) return []
  await Promise.all(STUB_FILES.map((file) => copySource(file, join(stubDir(workspace), file))))
  const program = join(stubDir(workspace), STUB_PROGRAM)
  return Promise.all(
    stubs.map(async (stub) => {
      await writeFile(configPath(workspace, stub.server), serializeStub(stub))
      return {
        name: stub.server,
        command: process.execPath,
        args: [program, configPath(workspace, stub.server), stubLogPath(workspace, stub.server)],
        tools: stub.tools.map((tool) => tool.name),
      }
    }),
  )
}

async function copySource(file: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await copyFile(fileURLToPath(new URL(file, SOURCE_ROOT)), target)
}
