import { z } from "zod"
import { PERMISSIONS, type Permissions } from "../ports/agent.ts"
import type { Fixture } from "../ports/fixture.ts"
import type { Grader } from "../ports/grader.ts"
import type { SandboxAccess } from "../ports/sandbox.ts"
import type { Workspace } from "../ports/workspace.ts"
import { MAX_DURATION_MS } from "./duration.ts"

/** What a variant prompt can read from the case it runs. */
export interface CaseContext {
  readonly id: string
  /** Free text attached to the case with `.context(...)`, empty by default. */
  readonly context: string
}

/** What `beforeEach` / `afterEach` hooks receive. */
export interface TrialContext {
  readonly caseId: string
  readonly variant: string
  /** 1-based repetition index. */
  readonly trial: number
  readonly workspace: Workspace
}

export type SuiteHook = () => void | Promise<void>
export type TrialHook = (context: TrialContext) => void | Promise<void>

/** One arm of the comparison: what changes between two measures (prompt, plugins, model...). */
export interface VariantDefinition {
  readonly name: string
  readonly prompt: (context: CaseContext) => string
  readonly plugins: readonly string[]
  readonly mcpServers: Readonly<Record<string, unknown>>
  readonly model?: string
  readonly permissions: Permissions
  readonly settings: Readonly<Record<string, unknown>>
  readonly beforeEach: readonly TrialHook[]
  readonly afterEach: readonly TrialHook[]
}

/** One scenario, run once per variant and per repetition. */
export interface CaseDefinition {
  readonly id: string
  readonly description?: string
  readonly context: string
  readonly fixtures: readonly Fixture[]
  readonly graders: readonly Grader[]
  /** Maximum duration of the agent run, in milliseconds. */
  readonly timeoutMs: number
  /** When set, trials are reported `skipped` without running. */
  readonly skipReason?: string
}

/** A theme of evaluation: variants × cases, plus suite-level hooks. */
export interface SuiteDefinition {
  readonly name: string
  readonly variants: readonly VariantDefinition[]
  readonly cases: readonly CaseDefinition[]
  readonly beforeAll: readonly SuiteHook[]
  readonly afterAll: readonly SuiteHook[]
  /** What every trial of the suite needs through the sandbox, on top of what the agent needs. */
  readonly sandboxAccess: SandboxAccess
}

const name = (what: string) =>
  z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i, `${what} must start with a letter or digit and contain only letters, digits, ".", "_" or "-"`)

const fn = <T>(message: string) => z.custom<T>((value) => typeof value === "function", message)

const graderSchema = z.custom<Grader>(
  (value) => typeof (value as Grader | undefined)?.grade === "function" && typeof (value as Grader).id === "string",
  "expected a Grader (an object with an id and a grade() method)",
)

const fixtureSchema = z.custom<Fixture>(
  (value) => typeof (value as Fixture | undefined)?.setup === "function",
  "expected a Fixture (an object with a setup() method)",
)

const variantSchema = z.object({
  name: name("Variant name"),
  prompt: fn<VariantDefinition["prompt"]>("Variant has no prompt: add .prompt(c => `...`)"),
  plugins: z.array(z.string().min(1)),
  mcpServers: z.record(z.string(), z.unknown()),
  model: z.string().min(1).optional(),
  permissions: z.enum(PERMISSIONS),
  settings: z.record(z.string(), z.unknown()),
  beforeEach: z.array(fn<TrialHook>("beforeEach expects a function")),
  afterEach: z.array(fn<TrialHook>("afterEach expects a function")),
})

const caseSchema = z
  .object({
    id: name("Case id"),
    description: z.string().optional(),
    context: z.string(),
    fixtures: z.array(fixtureSchema),
    graders: z.array(graderSchema),
    timeoutMs: z.number().int().positive().max(MAX_DURATION_MS),
    skipReason: z.string().optional(),
  })
  .refine((c) => c.skipReason !== undefined || c.graders.length > 0, {
    message: 'Case has no expectation: add .expect(...), e.g. .expect(regex("says-hello", /hello/i))',
    path: ["graders"],
  })

const duplicates = (values: readonly string[]) => [...new Set(values.filter((v, i) => values.indexOf(v) !== i))]

/** Validates a suite built with the fluent API; see {@link parseSuiteDefinition}. */
export const suiteSchema = z
  .object({
    name: name("Suite name"),
    variants: z.array(variantSchema).min(1, 'Suite has no variant: add .variant("baseline", v => v.prompt(...))'),
    cases: z.array(caseSchema).min(1, 'Suite has no case: add .case("my-case", c => c.expect(...))'),
    beforeAll: z.array(fn<SuiteHook>("beforeAll expects a function")),
    afterAll: z.array(fn<SuiteHook>("afterAll expects a function")),
    sandboxAccess: z.object({
      allowedDomains: z.array(z.string().regex(/^(\*\.)?[a-z0-9.-]+(:\d+)?$/i, "expected a domain, e.g. github.com or *.github.com")),
      readablePaths: z.array(z.string().startsWith("/", "expected an absolute path")),
      writablePaths: z.array(z.string().startsWith("/", "expected an absolute path")).optional(),
    }),
  })
  .superRefine((s, ctx) => {
    const named = [
      ["variants", "Variant names", s.variants.map((v) => v.name)],
      ["cases", "Case ids", s.cases.map((c) => c.id)],
    ] as const
    for (const [path, what, values] of named) {
      const repeated = duplicates(values)
      if (repeated.length === 0) continue
      const list = repeated.map((v) => `"${v}"`).join(", ")
      const verb = repeated.length === 1 ? "is" : "are"
      ctx.addIssue({
        code: "custom",
        path: [path],
        message: `${what} must be unique: ${list} ${verb} declared more than once; rename the duplicates`,
      })
    }
  })

/** Raised when a suite definition is invalid; the message lists every issue with its path. */
export class SuiteDefinitionError extends Error {
  override readonly name = "SuiteDefinitionError"
}

/**
 * Validates a suite definition and returns it unchanged, or throws a {@link SuiteDefinitionError}.
 *
 * @example
 * const definition = parseSuiteDefinition(candidate)
 */
export function parseSuiteDefinition(candidate: SuiteDefinition): SuiteDefinition {
  const parsed = suiteSchema.safeParse(candidate)
  if (parsed.success) return candidate
  const issues = parsed.error.issues.map((issue) => `  - ${describePath(candidate, issue.path)}: ${issue.message}`)
  throw new SuiteDefinitionError(`Invalid suite "${candidate.name}":\n${issues.join("\n")}`)
}

/** Turns `["cases", 0, "graders"]` into `case "hello" > graders`, easier to act on than indexes. */
function describePath(suite: SuiteDefinition, path: readonly PropertyKey[]): string {
  const [collection, index, ...rest] = path
  const named: Record<string, (i: number) => string> = {
    cases: (i) => `case "${suite.cases[i]?.id}"`,
    variants: (i) => `variant "${suite.variants[i]?.name}"`,
  }
  const head = typeof index === "number" ? named[String(collection)]?.(index) : undefined
  return [head ?? "suite", ...(head ? rest : path).map(String)].join(" > ")
}
