import { join } from "node:path"
import { ClaudeCodeAdapter } from "../adapters/agents/claude-code/adapter.ts"
import { CLAUDE_AUTH_PROFILES } from "../adapters/agents/claude-code/credentials.ts"
import { LocalTempSandbox } from "../adapters/sandboxes/local-temp/sandbox.ts"
import { SrtSandbox } from "../adapters/sandboxes/srt/sandbox.ts"
import { resolveCredential } from "../auth/credential-resolver.ts"
import type { AgentAdapter } from "../ports/agent.ts"
import type { Sandbox } from "../ports/sandbox.ts"
import type { CtrfSink } from "../reporters/ctrf.ts"
import type { CtrfReport } from "../reporters/ctrf-types.ts"
import type { RenderOptions } from "../reporters/format.ts"
import { htmlPath, writeHtmlReport } from "../reporters/html.ts"
import { summaryPath, writeMarkdownSummary } from "../reporters/markdown.ts"
import { FakeAgentAdapter } from "../testing/fake-agent.ts"
import { FakeSandbox } from "../testing/fake-sandbox.ts"

/** What the command line hands to a factory. */
export interface FactoryOptions {
  /** `--auth`: forces a credential profile; each agent decides what it means. */
  readonly auth?: string
  /** `--out`: results directory, e.g. for transcripts. */
  readonly outDir: string
  /** `--plugin-root`: absolute directories where an agent looks up bare plugin names. */
  readonly pluginRoots?: readonly string[]
  /** Environment the credential is read from. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/** Factories keyed by the id used on the command line. */
export type Registry<T> = Readonly<Record<string, (options: FactoryOptions) => T>>

/** `--agent <id>`. Add an agent by adding its adapter file and one line here. */
export const agents: Registry<AgentAdapter> = {
  fake: () => new FakeAgentAdapter(),
  "claude-code": ({ auth, outDir, env, pluginRoots = [] }) =>
    new ClaudeCodeAdapter({
      credential: resolveCredential("claude-code", CLAUDE_AUTH_PROFILES, env, auth),
      transcriptsDir: join(outDir, "transcripts"),
      pluginRoots,
    }),
}

/** `--sandbox <id>`. Add a sandbox by adding its file and one line here. */
export const sandboxes: Registry<Sandbox> = {
  fake: () => new FakeSandbox(),
  "local-temp": () => new LocalTempSandbox(),
  srt: () => new SrtSandbox(),
}

/** Sandbox used when `--sandbox` is omitted and the agent has no entry in {@link defaultSandboxes}. */
export const DEFAULT_SANDBOX = "srt"

/** Per-agent exceptions to {@link DEFAULT_SANDBOX}: the fake agent runs nothing, so it needs no OS sandbox. */
export const defaultSandboxes: Readonly<Record<string, string>> = { fake: "fake" }

/**
 * The sandbox id to use for `agent`: `--sandbox` when given, else `srt`, the only full isolation.
 *
 * @example
 * sandboxIdFor("fake", undefined) // "fake"
 * sandboxIdFor("claude-code", undefined) // "srt"
 */
export function sandboxIdFor(agent: string, sandbox: string | undefined): string {
  return sandbox ?? (Object.hasOwn(defaultSandboxes, agent) ? defaultSandboxes[agent] : undefined) ?? DEFAULT_SANDBOX
}

/**
 * Looks `id` up in `registry`, or throws listing the available ids.
 *
 * @example
 * const format = lookup(reportFormats, "html", "report format")
 */
export function lookup<T>(registry: Readonly<Record<string, T>>, id: string, kind: string): T {
  // Own keys only: "toString" or "constructor" must not resolve to what every object inherits.
  const found = Object.hasOwn(registry, id) ? registry[id] : undefined
  if (found === undefined) throw new Error(`Unknown ${kind} "${id}". Available: ${Object.keys(registry).join(", ")}`)
  return found
}

/**
 * Instantiates `id` from `registry`, or throws listing the available ids.
 *
 * @example
 * const agent = create(agents, "fake", "agent", { outDir: "results", env: process.env })
 */
export function create<T>(registry: Registry<T>, id: string, kind: string, options: FactoryOptions): T {
  return lookup(registry, id, kind)(options)
}

/** Judge agent used when `--judge-agent` is omitted and the agent under test has no entry in {@link defaultJudgeAgents}. */
export const DEFAULT_JUDGE_AGENT = "claude-code"

/** Per-agent exceptions to {@link DEFAULT_JUDGE_AGENT}: the fake agent is judged by a fake, so no LLM is ever called. */
export const defaultJudgeAgents: Readonly<Record<string, string>> = { fake: "fake" }

/**
 * The judge agent id: `--judge-agent` when given, else `claude-code`, whatever the agent under test.
 *
 * @example
 * judgeAgentIdFor("opencode", undefined) // "claude-code"
 * judgeAgentIdFor("fake", undefined) // "fake"
 */
export function judgeAgentIdFor(agent: string, judgeAgent: string | undefined): string {
  return judgeAgent ?? (Object.hasOwn(defaultJudgeAgents, agent) ? defaultJudgeAgents[agent] : undefined) ?? DEFAULT_JUDGE_AGENT
}

/**
 * A file derived from a CTRF document: how to write it, and where by default (next to the CTRF file). One of the two
 * output extension points, next to the `Reporter` port, which gets the run's events as they happen.
 */
export interface ReportFormat {
  readonly write: (report: CtrfReport, path: string, options?: RenderOptions) => Promise<string>
  readonly path: (ctrfFile: string) => string
}

/**
 * The format as a CTRF sink, writing next to the CTRF file.
 *
 * @example
 * new CtrfReporter({ outDir, toolVersion, sinks: [sinkOf(reportFormats.html)] })
 */
export const sinkOf =
  (format: ReportFormat): CtrfSink =>
  (report, ctrfFile) =>
    format.write(report, format.path(ctrfFile))

/** `--report <formats>` of `run`, `--format` of `report`. Add a format by adding its file and one line here. */
export const reportFormats: Readonly<Record<string, ReportFormat>> = {
  markdown: { write: writeMarkdownSummary, path: summaryPath },
  html: { write: writeHtmlReport, path: htmlPath },
}
