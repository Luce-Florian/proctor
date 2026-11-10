import { describe, expect, it } from "vitest"
import type { McpAnswer, McpStubDefinition } from "../../ports/mcp-stub.ts"
import { DEFAULT_PROTOCOL_VERSION } from "../../ports/mcp-stub-rules.mjs"
import { readStubLogs } from "./call-log.ts"
import { materializeStubs } from "./materialize.ts"
import { tempWorkspace } from "#test/helpers.ts"
import { McpClient } from "#test/mcp-client.ts"
import { stub, stubTool } from "#test/mcp-stubs.ts"

const error = (content: string): McpAnswer => ({ content, isError: true })

describe("stub server over stdio", () => {
  /** pgsql with get_object_details, which answers orders as JSON, anything else with an error. */
  const details = stubTool("get_object_details", {
    description: "Columns, nullability, constraints and indexes of a table.",
    inputSchema: { type: "object", properties: { object_name: { type: "string" } } },
    rules: [
      {
        when: { object_name: /^(public\.)?orders$/ },
        answers: [{ content: { table: "public.orders", rows: 180 }, isError: false }],
        answeredBy: "case",
      },
    ],
    otherwise: error("relation does not exist"),
  })
  const pgsql = stub("pgsql", details)

  async function serve(definition: McpStubDefinition) {
    const workspace = await tempWorkspace()
    const [entry] = await materializeStubs([definition], workspace)
    if (!entry) throw new Error("no stub entry")
    return { client: McpClient.spawn({ file: entry.command, args: entry.args }, { cwd: workspace.cwd, env: {} }), workspace }
  }

  it("answers the handshake as a server of tools named after the stub, echoing the client's protocol version", async () => {
    const { client } = await serve(pgsql)

    const response = await client.request("initialize", { protocolVersion: "2025-03-26", capabilities: {} })

    expect(response.result).toEqual({
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "pgsql", version: "1.0.0" },
    })
  })

  it("answers its default protocol version to a client asking for one it does not support", async () => {
    const { client } = await serve(pgsql)

    const response = await client.request("initialize", { protocolVersion: "1999-01-01", capabilities: {} })

    expect(response.result).toMatchObject({ protocolVersion: DEFAULT_PROTOCOL_VERSION })
  })

  it("lists the declared tools with their description and input schema", async () => {
    const { client } = await serve(pgsql)

    const response = await client.request("tools/list")

    expect(response.result).toEqual({
      tools: [
        {
          name: "get_object_details",
          description: "Columns, nullability, constraints and indexes of a table.",
          inputSchema: { type: "object", properties: { object_name: { type: "string" } } },
        },
      ],
    })
  })

  it("sends a JSON answer as pretty JSON text, matched by a RegExp that crossed to the process", async () => {
    const { client } = await serve(pgsql)

    const response = await client.request("tools/call", { name: "get_object_details", arguments: { object_name: "public.orders" } })

    expect(response.result).toEqual({
      content: [{ type: "text", text: '{\n  "table": "public.orders",\n  "rows": 180\n}' }],
      isError: false,
    })
  })

  it("sends a tool error with isError", async () => {
    const { client } = await serve(pgsql)

    const response = await client.request("tools/call", { name: "get_object_details", arguments: { object_name: "customers" } })

    expect(response.result).toEqual({ content: [{ type: "text", text: "relation does not exist" }], isError: true })
  })

  it("ignores notifications and refuses any method but initialize, ping, tools/list and tools/call", async () => {
    const { client } = await serve(pgsql)

    client.notify("notifications/initialized")
    const response = await client.request("resources/list")

    expect(response).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found: resources/list" } })
  })

  it("refuses a tool call without a tool name, and logs no call", async () => {
    const { client, workspace } = await serve(pgsql)

    const response = await client.request("tools/call", { arguments: { object_name: "orders" } })
    await client.close()

    expect(response.error).toEqual({ code: -32602, message: "Invalid params: tools/call needs the name of a tool" })
    expect(await readStubLogs([{ name: "pgsql" }], workspace)).toEqual([{ server: "pgsql", events: [] }])
  })

  it("refuses a request without a method", async () => {
    const { client } = await serve(pgsql)

    const response = await client.requestRaw({ params: {} })

    expect(response).toEqual({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "Invalid Request: no method" } })
  })

  it("logs its start, the tools it listed and each call with what answered it", async () => {
    const { client, workspace } = await serve(pgsql)

    await client.request("initialize")
    await client.request("tools/list")
    await client.request("tools/call", { name: "get_object_details", arguments: { object_name: "orders" } })
    await client.request("tools/call", { name: "get_object_details", arguments: { object_name: "customers" } })
    await client.close()

    expect(await readStubLogs([{ name: "pgsql" }], workspace)).toEqual([
      {
        server: "pgsql",
        events: [
          { event: "initialize" },
          { event: "tools/list", tools: ["get_object_details"] },
          { event: "call", tool: "get_object_details", input: { object_name: "orders" }, answeredBy: "case" },
          { event: "call", tool: "get_object_details", input: { object_name: "customers" }, answeredBy: "fallback" },
        ],
      },
    ])
  })
})
