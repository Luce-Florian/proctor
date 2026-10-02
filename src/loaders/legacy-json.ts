import { readdir, readFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { z } from "zod"
import { isDirectory } from "../shared/fs.ts"
import { suite, type SuiteBuilder } from "../dsl/suite.ts"
import { gitRepo } from "../fixtures/git-repo.ts"
import { judge, Judge, type JudgeBuilder } from "../graders/llm-judge.ts"
import type { Grader } from "../ports/grader.ts"
import { legacyId, verdictGraders } from "./legacy-verdicts.ts"
import type { SuiteLoader } from "./loader.ts"

/**
 * Model of the legacy bench's `judge.sh`, pinned as it did. The prompt is `judge()`'s, not `judge.sh`'s.
 */
export const LEGACY_JUDGE_MODEL = "claude-sonnet-5"
/** No timeout in the bash bench: the longest recorded run took 6 minutes. */
const LEGACY_TIMEOUT = "30m"
/** Placeholder of the bash bench for the repository root in `settings.json`. */
const REPO_ROOT = "__REPO_ROOT__"

const caseSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  prompt: z.union([z.string(), z.record(z.string(), z.string())]),
  repo: z.object({ url: z.string().min(1), ref: z.string().default("main"), commit: z.string().optional() }).optional(),
  diff_file: z.string().optional(),
  diff_apply: z.boolean().optional(),
  overlay_dir: z.string().optional(),
  expected: z.object({ criteria: z.array(z.string()).min(1) }),
})
type LegacyCase = z.infer<typeof caseSchema>

interface LegacyVariant {
  readonly name: string
  readonly settings: Record<string, unknown>
  readonly plugins: readonly string[]
  /** Host directories the settings point at (hook scripts), readable inside the sandbox. */
  readonly readable: readonly string[]
}

/**
 * Loads a theme of the bash bench (`evals/<theme>/`) unchanged: `cases/*.json`, and per variant
 * `settings.json`, `plugins`, `initialize.sh`, `cleanup.sh`. A yes/no case is graded in three tiers (`verdictEquals`,
 * `answerShape`, a judge gated on `oui`), see `legacy-verdicts.ts`; any other case by `judge()`. The judge reads the case diff.
 *
 * | Bash bench | Harness |
 * |---|---|
 * | `repo`, `diff_file`, `diff_apply`, `overlay_dir` | `gitRepo(...)` fixture |
 * | `prompt` string or object per variant | variant prompt |
 * | `settings.json`, `__REPO_ROOT__` resolved | variant settings, model pinned from `settings.model` |
 * | `plugins` (names under `marketplace/plugins/`) | directory plugins |
 * | `claude plugin marketplace add` + `install` in `initialize.sh` | marketplace plugins, installed in the sandbox home |
 * | `claude plugin uninstall` / `marketplace remove` in `cleanup.sh` | nothing: the sandbox home is thrown away |
 *
 * Any other line in `initialize.sh` / `cleanup.sh` is rejected: port that variant to a `*.eval.ts`.
 *
 * @example
 * const definition = await legacyJsonLoader.load("/repo/evals/my-theme")
 */
export const legacyJsonLoader: SuiteLoader = {
  accepts: "a legacy theme directory (cases/*.json + variants/)",
  canLoad: (path) => isDirectory(path) && isDirectory(join(path, "cases")) && isDirectory(join(path, "variants")),
  load: async (themeDir) => (await legacySuite(resolve(themeDir))).toDefinition(),
}

/** Builds the suite of a theme; the repository root is two levels up, as in `run.sh`. */
async function legacySuite(themeDir: string): Promise<SuiteBuilder> {
  const repoRoot = resolve(themeDir, "..", "..")
  const cases = await readCases(themeDir)
  const variants = await readVariants(themeDir, repoRoot)
  const readable = [...new Set(variants.flatMap((v) => v.readable))]
  let builder = suite(basename(themeDir)).allowRead(...readable)
  for (const variant of variants) {
    const model = typeof variant.settings.model === "string" ? variant.settings.model : undefined
    builder = builder.variant(variant.name, (v) => {
      const configured = v
        .prompt((c) => promptFor(cases, c.id, variant.name))
        .plugins(...variant.plugins)
        .settings(variant.settings)
        // The bash bench always ran with --permission-mode bypassPermissions.
        .permissions("full")
      return model === undefined ? configured : configured.model(model)
    })
  }
  for (const legacy of cases.values()) {
    builder = builder.case(legacy.id, (c) => {
      const described = legacy.description === undefined ? c : c.description(legacy.description)
      const fixture = repoFixture(legacy, themeDir)
      const [first, ...others] = gradersOf(legacy, themeDir)
      let graded = (fixture ? described.fixture(fixture) : described).expect(first)
      for (const grader of others) graded = graded.expect(grader)
      return graded.timeout(LEGACY_TIMEOUT)
    })
  }
  return builder
}

async function readCases(themeDir: string): Promise<Map<string, LegacyCase>> {
  const dir = join(themeDir, "cases")
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()
  const cases = new Map<string, LegacyCase>()
  for (const file of files) {
    const path = join(dir, file)
    const parsed = caseSchema.safeParse(JSON.parse(await readFile(path, "utf8")))
    if (!parsed.success) throw new Error(`Invalid legacy case ${path}:\n${z.prettifyError(parsed.error)}`)
    cases.set(parsed.data.id, parsed.data)
  }
  return cases
}

async function readVariants(themeDir: string, repoRoot: string): Promise<LegacyVariant[]> {
  const dir = join(themeDir, "variants")
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
  return Promise.all(names.map((name) => readVariant(join(dir, name), repoRoot)))
}

async function readVariant(dir: string, repoRoot: string): Promise<LegacyVariant> {
  const read = (file: string, required: string) =>
    readFile(join(dir, file), "utf8").catch(() => {
      throw new Error(`${join(dir, file)} is missing (${required}), as run.sh requires.`)
    })
  const rawSettings = await read("settings.json", "required, even '{}'")
  const settings = JSON.parse(rawSettings.replaceAll(REPO_ROOT, repoRoot)) as Record<string, unknown>
  const readable = [...rawSettings.matchAll(/__REPO_ROOT__([^"\s]*)/g)].map((m) => readableFor(join(repoRoot, m[1] ?? "")))
  const local = (await readFile(join(dir, "plugins"), "utf8").catch(() => ""))
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((plugin) => {
      const path = join(repoRoot, "marketplace", "plugins", plugin)
      if (!isDirectory(path)) throw new Error(`Plugin "${plugin}" of ${join(dir, "plugins")} not found: ${path}`)
      return path
    })
  const installed = marketplacePlugins(await read("initialize.sh", "required, even a no-op"), join(dir, "initialize.sh"))
  checkCleanup(await read("cleanup.sh", "required, even a no-op"), join(dir, "cleanup.sh"))
  return { name: basename(dir), settings, plugins: [...local, ...installed], readable }
}

/** Commands of a script, without comments, blank lines and `set` options. */
const commands = (script: string) =>
  script
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("set "))

const unsupported = (file: string, line: string) =>
  new Error(
    `${file} runs "${line}": the legacy loader only understands claude plugin marketplace add / install ` +
      `(and uninstall / marketplace remove in cleanup.sh). Port this variant to a *.eval.ts with a beforeEach.`,
  )

/** `claude plugin marketplace add <source>` then `claude plugin install <plugin>@<name>` → `<plugin>@<source>`. */
function marketplacePlugins(script: string, file: string): string[] {
  const sources: string[] = []
  const plugins: string[] = []
  for (const line of commands(script)) {
    const added = /^claude plugin marketplace add (\S+)(\s+--scope \S+)?$/.exec(line)
    const install = /^claude plugin install ([^@\s]+)@(\S+)(\s.*)?$/.exec(line)
    if (added?.[1]) sources.push(added[1])
    else if (install?.[1] && install[2]) plugins.push(`${install[1]}@${sourceOf(install[2], sources, file)}`)
    else throw unsupported(file, line)
  }
  return plugins
}

/** The marketplace source registered under `name`: the one whose last segment is `name`, or the only one. */
function sourceOf(name: string, sources: readonly string[], file: string): string {
  const named = sources.find((s) => basename(s).replace(/\.git$/, "") === name)
  const source = named ?? (sources.length === 1 ? sources[0] : undefined)
  if (!source) throw new Error(`${file} installs from marketplace "${name}" without adding it first with claude plugin marketplace add.`)
  return source
}

function checkCleanup(script: string, file: string) {
  for (const line of commands(script)) {
    if (!/^claude plugin (uninstall|marketplace remove) /.test(line)) throw unsupported(file, line)
  }
}

function promptFor(cases: ReadonlyMap<string, LegacyCase>, caseId: string, variant: string): string {
  const prompt = cases.get(caseId)?.prompt
  if (typeof prompt === "string") return prompt
  const forVariant = prompt?.[variant]
  if (forVariant === undefined) throw new Error(`case "${caseId}" has no prompt for variant "${variant}": add it to its "prompt" object.`)
  return forVariant
}

function repoFixture(legacy: LegacyCase, themeDir: string) {
  const { repo, diff_file: diff, diff_apply: apply, overlay_dir: overlay } = legacy
  if (!repo) {
    if (diff || overlay || apply) throw new Error(`case "${legacy.id}": diff_file, diff_apply and overlay_dir need a repo.`)
    return undefined
  }
  if (apply && !diff) throw new Error(`case "${legacy.id}": diff_apply needs diff_file.`)
  let fixture = gitRepo(repo.url).ref(repo.ref)
  if (repo.commit) fixture = fixture.at(repo.commit)
  if (diff) fixture = apply ? fixture.applyDiff(join(themeDir, diff)) : fixture.diff(join(themeDir, diff))
  if (overlay) fixture = fixture.overlay(join(themeDir, overlay))
  return fixture
}

/**
 * A yes/no case (`check-human-review`) gets its three tiers, see `legacy-verdicts.ts`. Any other case gets one
 * judge criterion per `expected.criteria` entry, in order, flagged by its `[principal]` / `[leurre]` prefix.
 * Both judges are pinned to {@link LEGACY_JUDGE_MODEL} and read the case diff.
 */
function gradersOf(legacy: LegacyCase, themeDir: string): [Grader, ...Grader[]] {
  const model = judge().model(LEGACY_JUDGE_MODEL)
  const base = legacy.diff_file === undefined ? model : model.diff(join(themeDir, legacy.diff_file))
  const [verdict, ...others] = verdictGraders(legacy.expected.criteria, base) ?? []
  if (verdict) return [verdict, ...others]
  let graded: JudgeBuilder | Judge = base
  for (const [index, text] of legacy.expected.criteria.entries()) graded = addCriterion(graded, legacyId(index), text)
  if (!(graded instanceof Judge)) throw new Error(`case "${legacy.id}" has no criterion.`)
  return [graded]
}

function addCriterion(builder: JudgeBuilder | Judge, id: string, text: string): Judge {
  if (text.startsWith("[principal] ")) return builder.criterion(id, text.slice("[principal] ".length), { principal: true })
  if (text.startsWith("[leurre] ")) return builder.decoy(id, text.slice("[leurre] ".length))
  return builder.criterion(id, text)
}

/** What a sandbox must let the variant read for a path of its settings: a directory as is, a script's directory. */
const readableFor = (path: string) => (isDirectory(path) ? path : dirname(path))
