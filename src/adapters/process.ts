import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { delimiter, isAbsolute, join } from "node:path"
import { createInterface } from "node:readline"
import type { Command } from "../ports/workspace.ts"

/** Time a process gets to exit after SIGTERM before it is killed. */
const KILL_GRACE_MS = 2_000
/** How much of stderr is kept for error messages. */
const STDERR_TAIL = 4_000

export interface ProcessOptions {
  readonly cwd: string
  /** The whole environment of the process: nothing is inherited. */
  readonly env: Readonly<Record<string, string>>
  /** Aborting it terminates the whole process group. */
  readonly signal?: AbortSignal
  /** Called for each stdout line, as it arrives. */
  readonly onLine?: (line: string) => void
  /** Written to the command's stdin, which is then closed. Without it, stdin is closed at once: the command reads EOF. */
  readonly input?: string
}

export interface ProcessResult {
  readonly code: number | null
  /** Whole stdout, only kept when no `onLine` consumes it. */
  readonly stdout: string
  /** Last few thousand characters of stderr. */
  readonly stderr: string
}

/** Process groups of the commands still running, killed by {@link killProcessGroups}. */
const running = new Set<number>()

const killGroup = (pid: number, sig: NodeJS.Signals) => {
  try {
    process.kill(-pid, sig)
  } catch {
    // Already gone.
  }
}

/**
 * Kills, with SIGKILL, every process group started by {@link runProcess} that is still running.
 * Also runs when the harness process exits, so a forced exit (second Ctrl-C) leaves no agent behind.
 *
 * @example
 * process.on("SIGINT", () => { killProcessGroups(); process.exit(130) })
 */
export function killProcessGroups(): void {
  for (const pid of running) killGroup(pid, "SIGKILL")
}

let exitHook = false

/**
 * Runs a command with an explicit environment, streaming stdout line by line to `onLine`, or buffering it without.
 * The command gets its own process group: on abort, SIGTERM then SIGKILL go to the whole group, so wrappers (`srt`)
 * and their children stop too; once the command exits, what it left in the background is killed.
 * Resolves with the exit code; rejects only when the command cannot start or was aborted.
 *
 * @example
 * const { code, stdout } = await runProcess({ file: "claude", args: ["--version"] }, { cwd, env })
 */
export function runProcess(command: Command, options: ProcessOptions): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const { signal } = options
    if (signal?.aborted) {
      reject(asAbortError(signal))
      return
    }
    const child = spawn(command.file, command.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    })
    // A command that exits without reading its stdin closes the pipe: EPIPE is not an error of the run.
    child.stdin.on("error", () => undefined)
    child.stdin.end(options.input ?? "")
    const { pid } = child
    if (pid !== undefined) running.add(pid)
    if (!exitHook) {
      exitHook = true
      process.once("exit", killProcessGroups)
    }
    const out: string[] = []
    let stderr = ""
    let killTimer: NodeJS.Timeout | undefined
    const kill = (sig: NodeJS.Signals) => {
      if (pid !== undefined) killGroup(pid, sig)
    }
    const onAbort = () => {
      kill("SIGTERM")
      killTimer = setTimeout(() => kill("SIGKILL"), KILL_GRACE_MS)
      killTimer.unref()
    }
    signal?.addEventListener("abort", onAbort, { once: true })

    createInterface({ input: child.stdout }).on("line", options.onLine ?? ((line) => out.push(line)))
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL)
    })
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort)
      if (pid !== undefined) running.delete(pid)
      reject(new Error(`cannot start ${command.file}: ${error.message}`, { cause: error }))
    })
    // A background descendant (a dev server, an MCP server) would keep stdout open, delaying "close" forever.
    child.on("exit", () => kill("SIGKILL"))
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort)
      if (pid !== undefined) running.delete(pid)
      clearTimeout(killTimer)
      if (signal?.aborted) reject(asAbortError(signal))
      else resolve({ code, stdout: out.join("\n"), stderr: stderr.trim() })
    })
  })
}

function asAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error("aborted")
}

/**
 * Throws with the stderr tail unless the process exited with 0.
 *
 * @example
 * checkExit(await runProcess(cmd, options), "claude plugin install")
 */
export function checkExit(result: ProcessResult, what: string): ProcessResult {
  if (result.code === 0) return result
  const details = result.stderr || result.stdout.slice(-STDERR_TAIL)
  throw new Error(`${what} exited with ${result.code}${details ? `: ${details}` : ""}`)
}

/**
 * The first `bin` found on `path`, or `bin` itself when it is a path that exists; `undefined` otherwise.
 *
 * @example
 * which("rg", process.env.PATH ?? "") // "/opt/homebrew/bin/rg"
 */
export function which(bin: string, path: string): string | undefined {
  const candidates =
    isAbsolute(bin) || bin.includes("/")
      ? [bin]
      : path
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, bin))
  return candidates.find((candidate) => existsSync(candidate))
}
