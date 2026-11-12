// @ts-check
/**
 * A fake MCP server over stdio, run by the agent inside the trial sandbox: `node stub-server.mjs <stub.json> <calls.jsonl>`.
 * Node built-ins only, plain JavaScript (Node 22.12 runs no TypeScript), so that it runs under any sandbox policy; the
 * rules it answers with live in ../../ports/mcp-stub-rules.mjs, copied with it. Serves the tools capability only, and
 * appends what it did to the call log. A program, never imported: the harness imports the rules module.
 *
 * @import { McpAnsweredBy, McpStubDefinition, McpToolDefinition } from "../../ports/mcp-stub.ts"
 */
import { appendFileSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import {
  answerText,
  DEFAULT_PROTOCOL_VERSION,
  reviveStub,
  StubResponder,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../../ports/mcp-stub-rules.mjs"

/** JSON-RPC error codes. */
const INVALID_REQUEST = -32600
const INVALID_PARAMS = -32602
const METHOD_NOT_FOUND = -32601
const PARSE_ERROR = -32700

/**
 * One line of the call log: the stub started, listed its tools, or answered a call.
 * @typedef {{ readonly event: "initialize" }
 *   | { readonly event: "tools/list", readonly tools: readonly string[] }
 *   | { readonly event: "call", readonly tool: string, readonly input: unknown, readonly answeredBy: McpAnsweredBy }} StubLogEvent
 */

/**
 * The tools as `tools/list` sends them.
 *
 * @param {readonly McpToolDefinition[]} tools
 */
const listed = (tools) =>
  tools.map(({ name, description, inputSchema }) => ({ name, ...(description !== undefined && { description }), inputSchema }))

/**
 * Reads one JSON-RPC line from the agent: the fields the stub answers on, whatever else it holds.
 *
 * @param {string} line
 * @returns {{ id?: string | number, method?: string, params: Record<string, unknown> } | "unparsable"}
 */
function parseMessage(line) {
  /** @type {unknown} */
  let value
  try {
    value = JSON.parse(line)
  } catch {
    return "unparsable"
  }
  if (typeof value !== "object" || value === null) return "unparsable"
  const { id, method, params } = /** @type {Record<string, unknown>} */ (value)
  return {
    ...((typeof id === "string" || typeof id === "number") && { id }),
    ...(typeof method === "string" && { method }),
    params: typeof params === "object" && params !== null ? /** @type {Record<string, unknown>} */ (params) : {},
  }
}

/**
 * Serves one stub over stdio until stdin closes, appending each event to `logPath`.
 *
 * @param {McpStubDefinition} definition
 * @param {string} logPath
 */
function serve(definition, logPath) {
  const responder = new StubResponder(definition)
  /** @param {StubLogEvent} event */
  const log = (event) => appendFileSync(logPath, `${JSON.stringify(event)}\n`)
  /** @param {unknown} message */
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)

  /**
   * @param {string} method
   * @param {Record<string, unknown>} params
   * @returns {{ result: unknown } | { error: { code: number, message: string } }}
   */
  const handle = (method, params) => {
    if (method === "initialize") {
      log({ event: "initialize" })
      const requested = params.protocolVersion
      const supported = typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      const protocolVersion = supported ? requested : DEFAULT_PROTOCOL_VERSION
      return { result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: definition.server, version: "1.0.0" } } }
    }
    if (method === "ping") return { result: {} }
    if (method === "tools/list") {
      log({ event: "tools/list", tools: definition.tools.map((tool) => tool.name) })
      return { result: { tools: listed(definition.tools) } }
    }
    if (method === "tools/call") {
      const tool = params.name
      if (typeof tool !== "string" || tool === "") {
        return { error: { code: INVALID_PARAMS, message: "Invalid params: tools/call needs the name of a tool" } }
      }
      const input = params.arguments ?? {}
      const { answer, answeredBy } = responder.answer(tool, input)
      log({ event: "call", tool, input, answeredBy })
      return { result: { content: [{ type: "text", text: answerText(answer) }], isError: answer.isError } }
    }
    return { error: { code: METHOD_NOT_FOUND, message: `Method not found: ${method}` } }
  }

  createInterface({ input: process.stdin }).on("line", (line) => {
    if (line.trim() === "") return
    const message = parseMessage(line)
    if (message === "unparsable") {
      send({ jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error" } })
      return
    }
    // A notification (no id) expects no answer: notifications/initialized and the like.
    if (message.id === undefined) return
    if (message.method === undefined) {
      send({ jsonrpc: "2.0", id: message.id, error: { code: INVALID_REQUEST, message: "Invalid Request: no method" } })
      return
    }
    send({ jsonrpc: "2.0", id: message.id, ...handle(message.method, message.params) })
  })
}

const [, , configPath, logPath] = process.argv
if (configPath === undefined || logPath === undefined) {
  process.stderr.write("usage: node stub-server.mjs <stub.json> <calls.jsonl>\n")
  process.exit(2)
}
serve(reviveStub(readFileSync(configPath, "utf8"), configPath), logPath)
