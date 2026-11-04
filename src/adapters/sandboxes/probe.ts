import type { Workspace } from "../../ports/workspace.ts"
import { clip } from "../../shared/text.ts"
import { runProcess } from "../process.ts"

/** Written, read back and removed in the workspace by {@link probeSandbox}: the workspace is left as it was. */
const PROBE_FILE = ".proctor-sandbox-probe"

/** What the probe prints when the sandbox ran it to the end. */
const PROBE_MARK = "proctor-sandbox-ok"

/** Characters of the sandbox stderr kept in the error: enough for the whole srt or bubblewrap message. */
const MAX_STDERR = 2_000

/**
 * Runs a shell command through `workspace.wrap`, in the workspace, the way an agent would start: the sandbox must
 * start, and the workspace must be writable under it. Does nothing for a workspace without `wrap` (`fake`,
 * `local-temp`). Lets `--agent fake --sandbox srt` check the sandbox at no LLM cost, e.g. in a consumer's CI.
 *
 * @example
 * await probeSandbox(workspace, signal) // throws "The sandbox did not run a command in the workspace (exit 1): bwrap: …"
 */
export async function probeSandbox(workspace: Workspace, signal: AbortSignal): Promise<void> {
  if (!workspace.wrap) return
  const script = `echo ${PROBE_MARK} > ${PROBE_FILE} && cat ${PROBE_FILE} && rm ${PROBE_FILE}`
  const command = workspace.wrap({ file: "/bin/sh", args: ["-c", script] })
  const result = await runProcess(command, { cwd: workspace.cwd, env: workspace.env, signal })
  if (result.code === 0 && result.stdout.includes(PROBE_MARK)) return
  const stderr = clip(result.stderr.trim(), MAX_STDERR) || "no stderr"
  throw new Error(
    `The sandbox did not run a command in the workspace (exit ${String(result.code)}): ${stderr}. ` +
      `A real agent would fail the same way: see the sandbox requirements in docs/sandboxes.md.`,
  )
}
