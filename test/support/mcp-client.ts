import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import { onTestFinished } from "vitest"
import type { Command } from "@fluce/proctor"

/** A JSON-RPC response, as an MCP server sends it. */
export interface McpResponse {
  readonly id: number | null
  readonly result?: Record<string, unknown>
  readonly error?: { readonly code: number; readonly message: string }
}

const isResponse = (value: unknown): value is McpResponse =>
  typeof value === "object" && value !== null && "id" in value && (typeof value.id === "number" || value.id === null)

/**
 * Talks to a stdio MCP server the way an agent does: one JSON-RPC message per line. The server is killed when the
 * current test finishes.
 *
 * @example
 * const client = McpClient.spawn(entry, { cwd, env: {} })
 * await client.request("tools/list") // { id: 1, result: { tools: [...] } }
 */
export class McpClient {
  readonly #server: ChildProcessWithoutNullStreams
  readonly #pending = new Map<number, { resolve: (response: McpResponse) => void; reject: (error: Error) => void }>()
  #stderr = ""
  #nextId = 1

  /** Use {@link McpClient.spawn}, which also kills the server at the end of the test. */
  constructor(server: ChildProcessWithoutNullStreams) {
    this.#server = server
    createInterface({ input: server.stdout }).on("line", (line) => {
      const response: unknown = JSON.parse(line)
      if (isResponse(response) && response.id !== null) this.#pending.get(response.id)?.resolve(response)
    })
    server.stderr.on("data", (chunk: Buffer) => (this.#stderr += chunk.toString()))
    // A server that dies, e.g. a sandbox that refuses to start it, fails the pending requests with its stderr.
    server.on("exit", (code) => {
      for (const { reject } of this.#pending.values()) reject(new Error(`MCP server exited with ${String(code)}: ${this.#stderr}`))
    })
  }

  static spawn(command: Command, options: { readonly cwd: string; readonly env: Readonly<Record<string, string>> }): McpClient {
    const server = spawn(command.file, command.args, { cwd: options.cwd, env: options.env, stdio: "pipe" })
    onTestFinished(() => void server.kill())
    return new McpClient(server)
  }

  /** Sends a request and resolves with its response. */
  request(method: string, params: Record<string, unknown> = {}): Promise<McpResponse> {
    return this.requestRaw({ method, params })
  }

  /** Sends a message as given, with a fresh id, and resolves with its response: for messages no agent sends. */
  requestRaw(message: Record<string, unknown>): Promise<McpResponse> {
    const id = this.#nextId++
    const response = new Promise<McpResponse>((resolve, reject) => this.#pending.set(id, { resolve, reject }))
    this.#send({ jsonrpc: "2.0", id, ...message })
    return response
  }

  /** Sends a notification, which expects no response. */
  notify(method: string): void {
    this.#send({ jsonrpc: "2.0", method })
  }

  /** Closes stdin, as an agent does at the end of its session, and waits for the server to exit. */
  async close(): Promise<void> {
    const exited = new Promise((resolve) => this.#server.once("exit", resolve))
    this.#server.stdin.end()
    await exited
  }

  #send(message: Record<string, unknown>): void {
    this.#server.stdin.write(`${JSON.stringify(message)}\n`)
  }
}
