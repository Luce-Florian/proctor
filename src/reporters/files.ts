import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

/**
 * Writes `text` to `path`, creating parent directories, and returns `path`.
 *
 * @example
 * await writeTextFile("results/hello/<runId>.summary.md", markdown)
 */
export async function writeTextFile(path: string, text: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return path
}
