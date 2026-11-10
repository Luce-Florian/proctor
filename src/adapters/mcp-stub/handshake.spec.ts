import { describe, expect, it } from "vitest"
import type { Command, Workspace } from "../../ports/workspace.ts"
import { handshakeStubs } from "./handshake.ts"
import { tempWorkspace } from "#test/helpers.ts"
import { stub, stubTool } from "#test/mcp-stubs.ts"

const pgsql = stub("pgsql", stubTool("get_object_details"))
const signal = new AbortController().signal

/** A workspace whose sandbox runs each command through `wrap`. */
const sandboxed = async (wrap: (command: Command) => Command): Promise<Workspace> => ({ ...(await tempWorkspace()), wrap })

describe("handshakeStubs", () => {
  it("starts each stub through the sandbox and has it list its tools", async () => {
    const workspace = await sandboxed((command) => command)

    await expect(handshakeStubs([pgsql], workspace, signal)).resolves.toBeUndefined()
  })

  it("says which stub the sandbox did not start, with what the sandbox printed", async () => {
    const denying = (): Command => ({ file: "/bin/sh", args: ["-c", "echo 'sandbox-exec: Operation not permitted' >&2; exit 71"] })
    const workspace = await sandboxed(denying)

    await expect(handshakeStubs([pgsql], workspace, signal)).rejects.toThrow(
      'The MCP stub "pgsql" did not start in the sandbox (exit 71): sandbox-exec: Operation not permitted',
    )
  })

  it("reports the first stub of the declaration whose start failed, whichever failed first", async () => {
    const tickets = stub("tickets", stubTool("get_ticket"))
    /** A sandbox that refuses every stub, pgsql after a while. */
    const denying = ({ args }: Command): Command => {
      const delay = args.some((arg) => arg.endsWith("pgsql.json")) ? "sleep 0.2; " : ""
      return { file: "/bin/sh", args: ["-c", `${delay}echo 'denied' >&2; exit 71`] }
    }
    const workspace = await sandboxed(denying)

    await expect(handshakeStubs([pgsql, tickets], workspace, signal)).rejects.toThrow('The MCP stub "pgsql" did not start in the sandbox')
  })
})
