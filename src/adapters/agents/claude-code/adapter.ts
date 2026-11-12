import { createWriteStream, realpathSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { basename, delimiter, dirname, join } from "node:path"
import { finished } from "node:stream/promises"
import { realPath } from "../../../shared/fs.ts"
import { timestampedId } from "../../../shared/ids.ts"
import { AgentRunError, type AgentAdapter, type AgentPrepareInput, type AgentRunInput, type AgentRunResult } from "../../../ports/agent.ts"
import type { SandboxAccess } from "../../../ports/sandbox.ts"
import type { Workspace } from "../../../ports/workspace.ts"
import type { Credential } from "../../../auth/credential-resolver.ts"
import { collectStubCalls } from "../../mcp-stub/call-log.ts"
import { materializeStubs, STUB_RUNTIME_DIR } from "../../mcp-stub/materialize.ts"
import { checkExit, runProcess, which } from "../../process.ts"
import { redactor } from "../../redact.ts"
import { CLAUDE_AUTH_PROFILES, MODEL_API_DOMAINS, type ClaudeAuthProfile } from "./credentials.ts"
import { claudeArgs, QUIET_ENV } from "./flags.ts"
import { IsolationError, probeHooks, probeInit, probeStubs, type DeclaredComponents } from "./init-probe.ts"
import { claudeStubName, pluginServers, stubToolParser, type ClaudeStub } from "./mcp-stubs.ts"
import { addMarketplace, copyPlugin, installedPluginPaths, parsePluginRef, pluginCopyPath, pluginFingerprint } from "./plugins.ts"
import { StreamCollector, type ResultEvent } from "./stream-parser.ts"

/** Upper bound for installing one marketplace plugin (git clone included). */
const INSTALL_TIMEOUT_MS = 180_000
/** What the CLI answers when it refuses the credential, e.g. "Not logged in · Please run /login". */
const AUTH_FAILURE = /not logged in|invalid api key|invalid.*token|token.*(expired|revoked)|authentication_error|\b401\b/i

export interface ClaudeCodeOptions {
  readonly credential: Credential<ClaudeAuthProfile>
  /** `claude` executable, a path or a name looked up on `PATH`. Default `claude`. */
  readonly bin?: string
  /** Where stream transcripts are written, one `.jsonl` per run. None when omitted. */
  readonly transcriptsDir?: string
  /** `PATH` used to find `bin`. Default: the harness `PATH`. */
  readonly path?: string
  /** Directories where a bare plugin name of `.plugins(...)` is looked up (`--plugin-root`), in order. */
  readonly pluginRoots?: readonly string[]
}

/** What `prepare` installed in a workspace, read back by `run`. */
interface Prepared extends DeclaredComponents {
  readonly pluginSha?: string
  readonly stubs: readonly ClaudeStub[]
}

/** A plugin the session loads: its directory, and the name to use when its manifest has none. */
interface LoadedPlugin {
  readonly dir: string
  readonly name: string
}

/** A marketplace plugin: its installed id, `plugin@marketplace`, and its name. */
interface InstalledPlugin {
  readonly id: string
  readonly name: string
}

/**
 * Runs Claude Code headless (`claude -p --output-format stream-json`, the prompt on stdin) inside a sandboxed workspace.
 * The only module that knows Claude Code: flags, plugins, stream format, isolation probe.
 *
 * - Config isolation, always on: `CLAUDE_CONFIG_DIR` is `<sandbox home>/.claude`, see `flags.ts`.
 * - The credential goes through one environment variable, never a keychain or a config file. Its value, and any
 *   Anthropic key, is masked in every stream line before it is written or parsed.
 * - The `system/init` event is probed as it arrives: an undeclared MCP server or plugin kills the run
 *   as soon as the event arrives, and the trial is `other`.
 *
 * @example
 * const credential = resolveCredential("claude-code", CLAUDE_AUTH_PROFILES, process.env)
 * const agent = new ClaudeCodeAdapter({ credential, transcriptsDir: "results/transcripts" })
 */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = "claude-code"
  readonly details: Readonly<Record<string, string>>
  readonly #options: ClaudeCodeOptions
  readonly #bin: string
  readonly #prepared = new WeakMap<Workspace, Prepared>()
  readonly #redact: (text: string) => string

  constructor(options: ClaudeCodeOptions) {
    this.#options = options
    this.#bin = findExecutable(options.bin ?? "claude", options.path ?? process.env.PATH ?? "")
    this.#redact = redactor([options.credential.value])
    this.details = { auth: options.credential.profile, credential: options.credential.variable }
  }

  /**
   * The model API, and the binary read from its real location, which may sit under the host home (e.g. ~/.local/bin);
   * so may the Node that runs the MCP stubs, readable only in a trial with stubs.
   *
   * @example
   * agent.sandboxAccess(input) // { allowedDomains: ["api.anthropic.com", ...], readablePaths: ["/usr/local/bin"] }
   */
  sandboxAccess(input: AgentPrepareInput): SandboxAccess {
    const readablePaths = input.mcpStubs.length > 0 ? [dirname(this.#bin), STUB_RUNTIME_DIR] : [dirname(this.#bin)]
    return { allowedDomains: MODEL_API_DOMAINS[this.#options.credential.profile], readablePaths }
  }

  /** @example await agent.version() // "2.1.280" */
  async version(): Promise<string> {
    const { stdout } = checkExit(
      await runProcess(
        { file: this.#bin, args: ["--version"] },
        { cwd: dirname(this.#bin), env: { PATH: [dirname(this.#bin), "/usr/bin", "/bin"].join(delimiter) } },
      ),
      `${this.#bin} --version`,
    )
    return stdout.trim().split(/\s+/)[0] ?? "unknown"
  }

  /**
   * Copies directory plugins into the sandbox home and installs marketplace plugins in its config directory,
   * so nothing is read from or written to the host configuration. Writes the MCP stubs into the sandbox home.
   *
   * @example
   * await agent.prepare({ ...input, plugins: ["/repo/plugins/sdlc", "caveman@JuliusBrussee/caveman"] }, workspace)
   */
  async prepare(input: AgentPrepareInput, workspace: Workspace): Promise<void> {
    await this.#prepare(input, workspace)
  }

  async #prepare(input: AgentPrepareInput, workspace: Workspace): Promise<Prepared> {
    const refs = input.plugins.map((ref) => parsePluginRef(ref, this.#options.pluginRoots))
    const copied: LoadedPlugin[] = []
    const sources: string[] = []
    const installed: InstalledPlugin[] = []
    const marketplaces = new Map<string, string>()
    for (const [index, ref] of refs.entries()) {
      if (ref.kind === "directory") {
        const target = pluginCopyPath(workspace.home, index, ref.source)
        await copyPlugin(ref.source, target)
        copied.push({ dir: target, name: basename(ref.source) })
        sources.push(ref.source)
        continue
      }
      const cli = (args: readonly string[], what: string) => this.#cli(args, workspace, what, input.signal)
      const name = marketplaces.get(ref.marketplace) ?? (await addMarketplace(ref.marketplace, join(workspace.home, ".claude"), cli))
      marketplaces.set(ref.marketplace, name)
      const id = `${ref.plugin}@${name}`
      await cli(["plugin", "install", id, "--scope", "user", "-y"], `claude plugin install ${id}`)
      installed.push({ id, name: ref.plugin })
    }
    const pluginDirs = copied.map((plugin) => plugin.dir)
    const pluginIds = installed.map((plugin) => plugin.id)
    const pluginSha = refs.length > 0 ? await pluginFingerprint(sources, pluginIds) : undefined
    const hookEvents = Object.keys((input.settings.hooks as Record<string, unknown> | undefined) ?? {})
    const stubs = await this.#stubs(input, workspace, copied, installed)
    const mcpServers = [...Object.keys(input.mcpServers), ...stubs.map((stub) => stub.name)]
    const prepared = { pluginDirs, pluginIds, mcpServers, hookEvents, stubs, ...(pluginSha && { pluginSha }) }
    this.#prepared.set(workspace, prepared)
    return prepared
  }

  /**
   * Writes the MCP stubs into the sandbox home, each named as the plugin server it replaces when a loaded plugin
   * declares one of its name: `--strict-mcp-config` never starts the plugin's own server.
   */
  async #stubs(
    input: AgentPrepareInput,
    workspace: Workspace,
    copied: readonly LoadedPlugin[],
    installed: readonly InstalledPlugin[],
  ): Promise<ClaudeStub[]> {
    if (input.mcpStubs.length === 0) return []
    const installPath = await installedPluginPaths(join(workspace.home, ".claude"))
    const loaded = [...copied, ...installed.map((plugin) => ({ dir: installPath(plugin.id), name: plugin.name }))]
    const servers = await Promise.all(loaded.map((plugin) => pluginServers(plugin.dir, plugin.name)))
    const entries = await materializeStubs(input.mcpStubs, workspace)
    return entries.map((entry) => ({ name: claudeStubName(entry.name, servers), entry }))
  }

  /** @example const result = await agent.run(input, workspace) // result.model: "claude-sonnet-5" */
  async run(input: AgentRunInput, workspace: Workspace): Promise<AgentRunResult> {
    const prepared = this.#prepared.get(workspace) ?? (await this.#prepare(input, workspace))
    const declared: DeclaredComponents = { ...prepared, pluginDirs: prepared.pluginDirs.map(realPath) }
    const args = claudeArgs(input, prepared)
    const command = workspace.wrap?.({ file: this.#bin, args }) ?? { file: this.#bin, args }

    const stream = new StreamCollector()
    const probe = new AbortController()
    const transcriptPath = await this.#transcriptPath()
    const transcript = transcriptPath ? createWriteStream(transcriptPath) : undefined
    const started = Date.now()
    const redact = this.#redact
    try {
      // A leak aborts the process with an IsolationError, which runProcess rejects with.
      const exit = await runProcess(command, {
        cwd: workspace.cwd,
        env: this.#env(workspace),
        input: input.prompt,
        signal: AbortSignal.any([input.signal, probe.signal]),
        onLine: (raw) => {
          const line = redact(raw)
          transcript?.write(`${line}\n`)
          const event = stream.add(line)
          const init = stream.init
          if (!init || event !== init) return
          const plugins = init.plugins?.map((p) => (p.path === undefined ? p : { ...p, path: realPath(p.path) }))
          const leaks = [...probeInit({ ...init, ...(plugins && { plugins }) }, declared), ...probeHooks(stream.hooks, declared)]
          if (leaks.length > 0) probe.abort(new IsolationError(isolationMessage(leaks)))
          const unready = probeStubs(init, prepared.stubs)
          if (unready.length > 0) probe.abort(new Error(stubsMessage(unready)))
        },
      })
      const stderr = exit.stderr ? `: ${redact(exit.stderr)}` : ""
      if (!stream.init) throw new Error(`claude exited with ${exit.code} before its init event${stderr}. ${NO_INIT_HINT}`)
      const result = stream.result
      if (!result) throw new Error(`claude exited with ${exit.code} without a result event${stderr}: it died mid-run, see the transcript.`)
      if (result.is_error) throw new Error(this.#errorMessage(result, redact(exit.stderr)))
      const run = stream.finish({ durationMs: Date.now() - started, ...(transcriptPath && { transcriptPath }) })
      const stubEntries = prepared.stubs.map((stub) => stub.entry)
      const toolCalls = await collectStubCalls(stubEntries, workspace, run.toolCalls, stubToolParser(prepared.stubs))
      return { ...run, toolCalls, ...(prepared.pluginSha && { pluginSha: prepared.pluginSha }) }
    } catch (error) {
      throw transcriptPath && error instanceof Error ? new AgentRunError(error, transcriptPath) : error
    } finally {
      if (transcript) {
        transcript.end()
        await finished(transcript)
      }
    }
  }

  /** The CLI error result as an actionable message: a refused credential says how to get a new one. */
  #errorMessage(result: ResultEvent, stderr: string): string {
    const text = result.result ?? stderr
    if (!AUTH_FAILURE.test(text)) return `claude reported an error (${result.subtype ?? "unknown"}): ${text}`
    const { profile, variable } = this.#options.credential
    return `claude refused the credential ${variable} (profile ${profile}): ${text}. Fix: ${CLAUDE_AUTH_PROFILES[profile].howTo}.`
  }

  /** The agent process environment: the sandbox allow-list, the sandbox config directory and the credential. */
  #env(workspace: Workspace, withCredential = true): Record<string, string> {
    const { variable, value } = this.#options.credential
    return {
      ...workspace.env,
      ...QUIET_ENV,
      HOME: workspace.home,
      // Always set: left unset, the CLI falls back to the keychain entry of the host's default config.
      CLAUDE_CONFIG_DIR: join(workspace.home, ".claude"),
      // The Bash tool writes under /tmp/claude-<uid> by default: shared with the host sessions, and not writable under srt.
      CLAUDE_CODE_TMPDIR: workspace.env.TMPDIR ?? join(workspace.home, ".tmp"),
      ...(withCredential && { [variable]: value }),
    }
  }

  /** Runs a `claude plugin ...` command outside the agent sandbox (it needs git and the network), without credential. */
  async #cli(args: readonly string[], workspace: Workspace, what: string, signal: AbortSignal) {
    const env = { ...this.#env(workspace, false), GIT_TERMINAL_PROMPT: "0" }
    const options = { cwd: workspace.cwd, env, signal: AbortSignal.any([signal, AbortSignal.timeout(INSTALL_TIMEOUT_MS)]) }
    return checkExit(await runProcess({ file: this.#bin, args }, options), what)
  }

  async #transcriptPath(): Promise<string | undefined> {
    const dir = this.#options.transcriptsDir
    if (!dir) return undefined
    await mkdir(dir, { recursive: true })
    return join(dir, `${timestampedId(3)}.jsonl`)
  }
}

/** Without an init event, the CLI did not even start its session: most often a sandbox denial or a broken binary. */
const NO_INIT_HINT =
  "Check that the binary runs (claude --version), then rerun with --sandbox local-temp to tell a sandbox denial from a CLI failure"

const stubsMessage = (problems: readonly string[]) =>
  `MCP stub check: a stub did not start, run stopped at its init event: ${problems.join("; ")}. Rerun with --sandbox local-temp to tell a sandbox denial from a stub failure`

const isolationMessage = (leaks: readonly string[]) =>
  `isolation probe: the session loaded what the variant did not declare, run stopped at its init event: ${leaks.join("; ")}`

/**
 * Real path of an executable given as a path or looked up on `path`, or throws saying how to fix it.
 *
 * @example
 * findExecutable("claude", process.env.PATH ?? "") // "/opt/homebrew/Caskroom/claude-code/2.1.280/claude"
 */
export function findExecutable(bin: string, path: string): string {
  const found = which(bin, path)
  if (!found) throw new Error(`"${bin}" not found on PATH: install Claude Code (https://claude.com/claude-code) or put it on PATH.`)
  return realpathSync(found)
}
