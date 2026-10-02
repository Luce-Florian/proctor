import { Command, CommanderError, InvalidArgumentError } from "commander"
import packageJson from "../../package.json" with { type: "json" }
import { asError } from "../core/errors.ts"
import { ExitCode } from "../core/exit-code.ts"
import { DEFAULT_BASELINE } from "../reporters/aggregates.ts"
import type { Output } from "../reporters/console.ts"
import { listCommand } from "./list.ts"
import { reportFormats } from "./registry.ts"
import { reportCommand } from "./report.ts"
import { runCommand, type RunCommandOptions } from "./run.ts"

export interface CliIo {
  readonly stdout: Output
  readonly stderr: Output
  /** Base directory for relative paths. Default: `process.cwd()`. */
  readonly cwd?: string
  /** Environment credentials are read from. Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>
  /** Interrupts a run (Ctrl-C), see `interruptOnSignals`. */
  readonly signal?: AbortSignal
}

const positiveInt = (flag: string) => (value: string) => {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new InvalidArgumentError(`${flag} must be a positive integer, got "${value}".`)
  return n
}

/** Repeatable, comma-separated list option: `--case a --case b,c`. Not variadic, so it never eats `<file>`. */
const list = (value: string, previous: string[] = []) => [...previous, ...value.split(",").filter(Boolean)]

/** Report formats the CLI knows, for its help. */
const formatIds = Object.keys(reportFormats).join(", ")

/** Repeatable option taken as is: `--plugin-root a --plugin-root b`. */
const repeatable = (value: string, previous: string[]) => [...previous, value]

/**
 * Parses `argv` (without `node` and the script) and runs the command.
 * Returns the exit code: 0 all passed, 1 an evaluation failed, 2 an infrastructure or usage error.
 *
 * @example
 * process.exitCode = await main(process.argv.slice(2))
 */
export async function main(argv: readonly string[], io: CliIo = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const cwd = io.cwd ?? process.cwd()
  let exitCode: number = ExitCode.Ok
  const program = new Command("proctor")
    .description("Evaluate coding agents: xUnit lifecycle, isolated trials, CTRF reports.")
    .version(packageJson.version)
    .exitOverride()
    .configureOutput({ writeOut: (s) => io.stdout.write(s), writeErr: (s) => io.stderr.write(s) })

  program
    .command("run <file>")
    .description("Run a *.eval.ts suite or a legacy theme directory; write <out>/<suite>/<runId>.ctrf.json and its reports")
    .requiredOption("--agent <id>", "agent adapter to evaluate: claude-code, fake")
    .option("--sandbox <id>", "sandbox isolating each trial: srt (default), local-temp, fake (default for --agent fake)")
    .option(
      "--auth <profile>",
      "credential profile, as the agent defines it, e.g. oauth for claude-code (default: the first credential found)",
    )
    .option("--repeat <n>", "trials per case × variant", positiveInt("--repeat"), 1)
    .option("-j, --concurrency <n>", "trials running at once", positiveInt("-j"), 1)
    .option("--case <ids>", "only run these cases (repeatable, comma-separated)", list)
    .option("--variant <names>", "only run these variants (repeatable, comma-separated)", list)
    .option("--plugin-root <dir>", "directory where a bare plugin name of .plugins(...) is looked up (repeatable)", repeatable, [])
    .option("--out <dir>", "results directory", "results")
    .option("--judge-agent <id>", "agent that judges, whatever --agent: claude-code (default), fake (default for --agent fake)")
    .option("--judge-model <id>", "default model of the judge; a suite's judge().model(...) wins")
    .option("--baseline <variant>", "variant the ablation compares the others with", DEFAULT_BASELINE)
    .option("--report <formats>", `files derived from the CTRF: ${formatIds} (repeatable, comma-separated)`, list, [])
    .action(async (file: string, parsed: RunCommandOptions) => {
      const options = { ...parsed, report: parsed.report.length > 0 ? parsed.report : ["markdown"] }
      exitCode = await runCommand(file, options, {
        stdout: io.stdout,
        cwd,
        toolVersion: packageJson.version,
        ...(io.env && { env: io.env }),
        ...(io.signal && { signal: io.signal }),
      })
    })

  program
    .command("report <ctrf>")
    .description("Regenerate a report from a CTRF file")
    .option("--format <format>", formatIds, "markdown")
    .option("-o, --output <path>", "file to write (default: <runId>.summary.md or <runId>.report.html next to the CTRF file)")
    .option("--baseline <variant>", "variant the ablation compares the others with (default: the run's)")
    .action((file: string, options: { output?: string; format: string; baseline?: string }) =>
      reportCommand(file, options, { stdout: io.stdout, cwd }),
    )

  program
    .command("list <file>")
    .description("List the variants and cases of a suite without running it")
    .action((file: string) => listCommand(file, { stdout: io.stdout, cwd }))

  try {
    await program.parseAsync(argv, { from: "user" })
    return exitCode
  } catch (error) {
    if (error instanceof CommanderError) {
      // Help and version exit with 0; usage errors were already printed by commander.
      return error.exitCode === 0 ? ExitCode.Ok : ExitCode.InfraError
    }
    io.stderr.write(`error: ${asError(error).message}\n`)
    return ExitCode.InfraError
  }
}
