import { randomBytes } from "node:crypto"

/**
 * A file-name-safe id that sorts by creation time: the ISO timestamp, then `bytes` random bytes in hex.
 *
 * @example
 * timestampedId(2) // "2026-09-30T17-55-31-040Z-da4b"
 */
export function timestampedId(bytes: number): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(bytes).toString("hex")}`
}
