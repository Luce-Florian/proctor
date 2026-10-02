/**
 * Loaded before every test file (vitest `setupFiles`): `npm test` runs without credential and without network.
 * Child processes inherit the cleared environment; the network block covers the test process only.
 */
import net from "node:net"
import { afterEach } from "vitest"

/** Environment variables that may hold a credential. */
export const CREDENTIAL_ENV = /^(ANTHROPIC_|CLAUDE_CODE_|OPENAI_|AWS_|AZURE_|GOOGLE_)|(_TOKEN|_API_KEY|_SECRET|_PASSWORD)$/

for (const key of Object.keys(process.env)) {
  // `delete` is the only way to unset an environment variable.
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  if (CREDENTIAL_ENV.test(key)) delete process.env[key]
}

const attempts: string[] = []

/**
 * Returns and forgets the blocked connection attempts, for a test that checks the block itself.
 *
 * @example
 * expect(takeNetworkAttempts()).toEqual(["example.com:80"])
 */
export const takeNetworkAttempts = (): string[] => attempts.splice(0)

interface ConnectTarget {
  host?: string
  port?: number | string
  path?: string
}

// Unbound on purpose: the patch calls it back with `connect.apply(this, args)`.
// eslint-disable-next-line @typescript-eslint/unbound-method
const connect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  // net.connect() hands Socket#connect its normalized arguments as a single array.
  const [first] = Array.isArray(args[0]) ? args[0] : args
  const target = typeof first === "object" && first !== null ? (first as ConnectTarget) : undefined
  // A string or `path` is a local IPC socket, e.g. the vitest worker channel: allowed.
  if (typeof first === "string" || target?.path !== undefined) return connect.apply(this, args as never)
  const address = target ? `${target.host ?? "localhost"}:${target.port}` : `localhost:${String(first)}`
  attempts.push(address)
  throw new Error(`Network access is blocked in npm test (tried ${address}): use a fake or a recorded stream instead.`)
}

afterEach(() => {
  const blocked = takeNetworkAttempts()
  if (blocked.length > 0) throw new Error(`This test tried to reach the network: ${blocked.join(", ")}`)
})
