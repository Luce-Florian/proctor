import { existsSync } from "node:fs"
import { writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { homedir, platform } from "node:os"
import { dirname, join } from "node:path"
import { realPath } from "../../../shared/fs.ts"
import type { Sandbox, SandboxSpec } from "../../../ports/sandbox.ts"
import type { Command, Workspace } from "../../../ports/workspace.ts"
import { which } from "../../process.ts"
import { allocateLayout, layoutEnv, releaseLayout, type LayoutOptions } from "../temp-layout.ts"
import { SHARED_TEMP_DIRS, srtSettings } from "./config.ts"

/** Host tools `srt` needs on each platform, see the `@anthropic-ai/sandbox-runtime` README. */
const REQUIRED_TOOLS: Readonly<Record<string, readonly string[]>> = {
  darwin: ["rg"],
  linux: ["bwrap", "socat", "rg"],
}

export interface SrtOptions extends LayoutOptions {
  /** Path of the `srt` CLI script. Default: the one of the `@anthropic-ai/sandbox-runtime` dependency. */
  readonly cli?: string
  /** Default: `os.platform()`. */
  readonly platform?: string
}

/**
 * OS-level isolation with `srt` (`@anthropic-ai/sandbox-runtime`: Seatbelt on macOS, bubblewrap on Linux),
 * on top of the same temp layout as `local-temp`. The agent command, its sub-processes, hooks and MCP servers
 * cannot read the host home, the host temp dirs or another trial, write outside the trial, or reach any domain
 * but the declared ones: isolation `full`.
 *
 * @example
 * const ws = await new SrtSandbox().create({ label: "probe [baseline] #1", access })
 * ws.wrap?.({ file: "claude", args: ["-p", "hi"] }) // { file: "/usr/local/bin/node", args: [".../srt/dist/cli.js", "--settings", ...] }
 */
export class SrtSandbox implements Sandbox {
  readonly id = "srt"
  readonly isolation = "full"
  readonly #options: SrtOptions
  /** The srt CLI, resolved once the preflight passed. */
  #cli: string | undefined

  constructor(options: SrtOptions = {}) {
    this.#options = options
  }

  /** @example const ws = await sandbox.create(spec) // ws.wrap runs commands under srt */
  async create(spec: SandboxSpec): Promise<Workspace> {
    const layout = await allocateLayout(spec.label, this.#options)
    // srt hands the command TMPDIR=$CLAUDE_CODE_TMPDIR, else /tmp/claude: shared by every srt sandbox of the host,
    // and hidden here with the rest of /tmp. The trial's own tmp keeps temp files private and readable.
    const env: Record<string, string> = { ...layoutEnv(layout, this.#options), CLAUDE_CODE_TMPDIR: layout.tmp }
    try {
      const cli = this.#resolveCli(env.PATH ?? "")
      const settings = join(layout.root, "srt-settings.json")
      const roots = dirname(layout.root)
      const sharedTemp = [roots, realPath(roots), ...SHARED_TEMP_DIRS.filter((dir) => existsSync(dir))]
      const policy = srtSettings(layout, spec.access, { home: this.#options.hostHome ?? homedir(), sharedTemp })
      await writeFile(settings, `${JSON.stringify(policy, null, 2)}\n`)
      const wrap = (command: Command): Command => ({
        file: process.execPath,
        args: [cli, "--settings", settings, "--", command.file, ...command.args],
      })
      return { cwd: layout.cwd, home: layout.home, env, wrap }
    } catch (error) {
      await releaseLayout(layout.root)
      throw error
    }
  }

  /** @example await sandbox.destroy(ws) // removes the whole temp root */
  destroy(workspace: Workspace): Promise<void> {
    return releaseLayout(dirname(workspace.cwd))
  }

  /** Checks the host tools srt needs, once, then returns the srt CLI path. */
  #resolveCli(path: string): string {
    if (this.#cli) return this.#cli
    const os = this.#options.platform ?? platform()
    const tools = REQUIRED_TOOLS[os]
    if (!tools) throw new Error(`srt does not support ${os}: pass --sandbox local-temp (isolation degraded).`)
    const missing = tools.filter((tool) => which(tool, path) === undefined)
    if (missing.length > 0) {
      throw new Error(
        `srt needs ${missing.join(", ")} on PATH (outside your home directory): install ${missing.join(", ")}, ` +
          `or pass --sandbox local-temp (isolation degraded).`,
      )
    }
    this.#cli = this.#options.cli ?? join(dirname(createRequire(import.meta.url).resolve("@anthropic-ai/sandbox-runtime")), "cli.js")
    return this.#cli
  }
}
