import { resolve } from "node:path"
import type { Output } from "../reporters/console.ts"
import { readCtrf } from "../reporters/ctrf.ts"
import { lookup, reportFormats } from "./registry.ts"

/**
 * `proctor report <ctrf.json>`: regenerates a report (markdown by default, `--format html`) from a CTRF file,
 * next to it unless `-o` says where; `--baseline` recomputes the ablation against another variant.
 */
export async function reportCommand(
  file: string,
  options: { output?: string; format: string; baseline?: string },
  io: { stdout: Output; cwd: string },
): Promise<void> {
  const format = lookup(reportFormats, options.format, "report format")
  const path = resolve(io.cwd, file)
  const report = await readCtrf(path)
  const target = options.output ? resolve(io.cwd, options.output) : format.path(path)
  const render = options.baseline === undefined ? {} : { baseline: options.baseline }
  io.stdout.write(`Report: ${await format.write(report, target, render)}\n`)
}
