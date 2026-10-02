import { resolve } from "node:path"
import { loadSuite } from "../loaders/index.ts"
import type { Output } from "../reporters/console.ts"

/** `proctor list <file>`: prints the variants and cases of a suite without running it. */
export async function listCommand(file: string, io: { stdout: Output; cwd: string }): Promise<void> {
  const definition = await loadSuite(resolve(io.cwd, file))
  const cases = definition.cases.map((c) => {
    const details = [c.description, c.skipReason !== undefined && `skipped: ${c.skipReason}`].filter(Boolean)
    return `  ${c.id}${details.length > 0 ? ` — ${details.join(" · ")}` : ""}`
  })
  io.stdout.write([definition.name, `variants: ${definition.variants.map((v) => v.name).join(", ")}`, "cases:", ...cases, ""].join("\n"))
}
