// @ts-check
/**
 * The MCP side of test/fixtures/fake-claude.sh: what `claude` does with the stdio servers of `--mcp-config`. Spawns each
 * one, sends initialize and tools/list, then calls it once per `tool_use` of the replayed stream named
 * `mcp__<server>__<tool>`, and closes it. Usage: node fake-mcp-client.mjs '<--mcp-config JSON>' <stream.jsonl>
 */
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { createInterface } from "node:readline"

const [, , mcpConfig = "{}", streamPath = ""] = process.argv

/** @typedef {{ readonly type?: string, readonly command?: string, readonly args?: readonly string[] }} ServerConfig */
/** @typedef {{ readonly type: string, readonly name?: string, readonly input?: unknown }} ContentBlock */

/**
 * Parses JSON the harness, the stream or the server wrote: a fixture trusts its own inputs, so callers cast the result.
 *
 * @param {string} text
 * @returns {unknown}
 */
const parse = (text) => JSON.parse(text)

const servers = /** @type {{ mcpServers: Record<string, ServerConfig> }} */ (parse(mcpConfig)).mcpServers

/** Every `tool_use` block of the stream, in order. */
const toolUses = readFileSync(streamPath, "utf8")
  .split("\n")
  .filter((line) => line.startsWith("{"))
  .flatMap((line) => {
    const event = /** @type {{ type: string, message?: { content?: ContentBlock[] | string } }} */ (parse(line))
    const content = event.type === "assistant" ? event.message?.content : undefined
    return Array.isArray(content) ? content.filter((block) => block.type === "tool_use") : []
  })

/**
 * Runs one session with a stdio server: handshake, the calls of the stream addressed to it, then closes its stdin.
 *
 * @param {string} name
 * @param {ServerConfig} server
 */
async function session(name, server) {
  if (server.command === undefined) return
  const prefix = `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}__`
  const child = spawn(server.command, server.args ?? [], { stdio: ["pipe", "pipe", "inherit"] })
  /** @type {Map<number, () => void>} */
  const pending = new Map()
  createInterface({ input: child.stdout }).on("line", (line) => {
    const { id } = /** @type {{ id: number }} */ (parse(line))
    pending.get(id)?.()
  })
  let nextId = 1
  /**
   * @param {string} method
   * @param {Record<string, unknown>} params
   * @returns {Promise<void>}
   */
  const request = (method, params) => {
    const id = nextId++
    const answered = new Promise((resolve) => pending.set(id, () => resolve(undefined)))
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
    return answered.then(() => undefined)
  }
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {} })
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`)
  await request("tools/list", {})
  for (const use of toolUses.filter((block) => block.name?.startsWith(prefix))) {
    await request("tools/call", { name: use.name?.slice(prefix.length), arguments: use.input ?? {} })
  }
  const exited = new Promise((resolve) => child.once("exit", resolve))
  child.stdin.end()
  await exited
}

await Promise.all(Object.entries(servers).map(([name, server]) => session(name, server)))
