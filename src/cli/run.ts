import { isAbsolute, relative, resolve } from "node:path"
import { exitCodeFor, type ExitCode } from "../core/exit-code.ts"
import { runSuite } from "../core/orchestrator.ts"
import { loadSuite } from "../loaders/index.ts"
import { ConsoleReporter, type Output } from "../reporters/console.ts"
import { CtrfReporter } from "../reporters/ctrf.ts"
import { hostEnvironment } from "./host.ts"
import { agents, create, judgeAgentIdFor, lookup, reportFormats, sandboxes, sandboxIdFor, sinkOf } from "./registry.ts"

export interface RunCommandOptions {
  readonly agent: string
  readonly sandbox?: string
  readonly auth?: string
  readonly repeat: number
  readonly concurrency: number
  readonly case?: string[]
  readonly variant?: string[]
  readonly pluginRoot: string[]
  readonly out: string
  readonly judgeAgent?: string
  readonly judgeModel?: string
  readonly baseline: string
  readonly report: string[]
}

/** `proctor run <file>`: runs the suite, writes the CTRF and the `--report` files, returns the exit code. */
export async function runCommand(
  file: string,
  options: RunCommandOptions,
  io: { stdout: Output; cwd: string; toolVersion: string; env?: Readonly<Record<string, string | undefined>>; signal?: AbortSignal },
): Promise<ExitCode> {
  const outDir = resolve(io.cwd, options.out)
  const pluginRoots = options.pluginRoot.map((dir) => resolve(io.cwd, dir))
  const factory = { outDir, pluginRoots, env: io.env ?? process.env, ...(options.auth !== undefined && { auth: options.auth }) }
  const agent = create(agents, options.agent, "agent", factory)
  const sandbox = create(sandboxes, sandboxIdFor(options.agent, options.sandbox), "sandbox", factory)
  const definition = await loadSuite(resolve(io.cwd, file))
  // Only a suite that asks a judge gets one, so a deterministic suite needs no judge credential.
  const judged = definition.cases
    .filter((c) => options.case === undefined || options.case.includes(c.id))
    .flatMap((c) => c.graders.flatMap((g) => (g.usesJudge ? [g.usesJudge] : [])))
  const judgeAgent = judgeAgentIdFor(options.agent, options.judgeAgent)
  // The judge gets its own adapter and sandbox instances: it never shares state with the agent under test.
  const judge =
    judged.length === 0
      ? undefined
      : {
          agent: create(agents, judgeAgent, "judge agent", factory),
          sandbox: create(sandboxes, sandboxIdFor(judgeAgent, options.sandbox), "sandbox", factory),
          ...(options.judgeModel !== undefined && { model: options.judgeModel }),
        }
  const unpinned = options.judgeModel === undefined ? judged.filter((j) => j.model === undefined).length : 0
  if (unpinned > 0) {
    io.stdout.write(
      `Warning: ${unpinned} judge() grader(s) pin no model and --judge-model is not set: the judge runs on the default model of ${judgeAgent}, ` +
        `recorded as judgeModel "unpinned (<model>)". Pin one with judge().model(...) or --judge-model.\n`,
    )
  }
  const sinks = options.report.map((id) => sinkOf(lookup(reportFormats, id, "report format")))
  const ctrf = new CtrfReporter({ outDir, toolVersion: io.toolVersion, baseline: options.baseline, sinks })
  if (sandbox.isolation === "degraded") {
    io.stdout.write(
      `Warning: sandbox ${sandbox.id} only isolates the configuration: the agent can read your home and reach the network. ` +
        `The report says isolation "degraded".\n`,
    )
  }

  const run = await runSuite(definition, {
    agent,
    sandbox,
    ...(judge && { judge }),
    repeat: options.repeat,
    concurrency: options.concurrency,
    ...(options.case && { cases: options.case }),
    ...(options.variant && { variants: options.variant }),
    host: hostEnvironment(io.cwd),
    reporters: [new ConsoleReporter(io.stdout), ctrf],
    ...(io.signal && { signal: io.signal }),
  })
  for (const path of ctrf.written) io.stdout.write(`Wrote ${display(path, io.cwd)}\n`)
  return exitCodeFor(run)
}

/** Relative to `cwd` when inside it, absolute otherwise. */
function display(path: string, cwd: string): string {
  const rel = relative(cwd, path)
  return rel.startsWith("..") || isAbsolute(rel) ? path : rel
}
