import { parseSuiteDefinition, type SuiteDefinition, type SuiteHook } from "../core/model.ts"
import { mergeAccess, NO_ACCESS, type SandboxAccess } from "../ports/sandbox.ts"
import { CaseBuilder, emptyCase } from "./case.ts"
import { emptyVariant, VariantBuilder } from "./variant.ts"

/** Marks suite builders, so loaders recognise them even across module instances. */
export const SUITE_BRAND = Symbol.for("proctor.suite")

interface SuiteState {
  readonly name: string
  readonly variants: readonly VariantBuilder[]
  readonly cases: readonly CaseBuilder[]
  readonly beforeAll: readonly SuiteHook[]
  readonly afterAll: readonly SuiteHook[]
  readonly sandboxAccess: SandboxAccess
}

/**
 * Describes a theme of evaluation: variants × cases. Start with {@link suite}.
 * Every method returns a new builder: builders are immutable and can be shared.
 */
export class SuiteBuilder {
  readonly [SUITE_BRAND] = true
  readonly #state: SuiteState

  /** @internal Use {@link suite} instead. */
  constructor(state: SuiteState) {
    this.#state = state
  }

  /**
   * Adds a variant: one arm of the comparison, run on every case. It must set `.prompt()`.
   *
   * @example
   * suite("review").variant("baseline", v => v.prompt(c => `/code-review\n\n${c.context}`))
   */
  variant(name: string, configure: (variant: VariantBuilder<"without-prompt">) => VariantBuilder<"with-prompt">): SuiteBuilder {
    return this.#with({ variants: [...this.#state.variants, configure(emptyVariant(name))] })
  }

  /**
   * Adds a case: one scenario, run once per variant and per repetition. It must `.expect()` something, or `.skip()`.
   *
   * @example
   * suite("hello").case("greets-world", c => c.context("world").expect(regex("says-hello", /hello/i)))
   */
  case(id: string, configure: (testCase: CaseBuilder<"without-expectation">) => CaseBuilder<"with-expectation">): SuiteBuilder {
    return this.#with({ cases: [...this.#state.cases, configure(emptyCase(id))] })
  }

  /**
   * Runs once before any trial (build an image, warm a git cache...). If it throws, every trial is `other`.
   *
   * @example
   * suite("review").beforeAll(() => warmGitCache())
   */
  beforeAll(hook: SuiteHook): SuiteBuilder {
    return this.#with({ beforeAll: [...this.#state.beforeAll, hook] })
  }

  /**
   * Runs once after every trial, even when `beforeAll` or a trial failed.
   *
   * @example
   * suite("review").afterAll(() => cleanGitCache())
   */
  afterAll(hook: SuiteHook): SuiteBuilder {
    return this.#with({ afterAll: [...this.#state.afterAll, hook] })
  }

  /**
   * Lets every trial reach these domains, on top of what the agent needs (its model API).
   * Everything else stays blocked by an OS-level sandbox such as `srt`.
   *
   * @example
   * suite("deps").allowDomains("registry.npmjs.org", "*.github.com")
   */
  allowDomains(...domains: string[]): SuiteBuilder {
    return this.#with({ sandboxAccess: mergeAccess(this.#state.sandboxAccess, { allowedDomains: domains, readablePaths: [] }) })
  }

  /**
   * Lets every trial read these absolute host paths, e.g. a hook script outside the workspace.
   * The rest of the host home stays hidden by an OS-level sandbox such as `srt`.
   *
   * @example
   * suite("rtk").allowRead("/opt/tools/hooks")
   */
  allowRead(...paths: string[]): SuiteBuilder {
    return this.#with({ sandboxAccess: mergeAccess(this.#state.sandboxAccess, { allowedDomains: [], readablePaths: paths }) })
  }

  /**
   * Lets every trial write, and read back, these absolute host paths, e.g. a tool that insists on `/tmp/.dotnet`.
   * Nothing else outside the trial is writable under an OS-level sandbox such as `srt`.
   *
   * @example
   * suite("rtk").allowWrite("/tmp/.dotnet")
   */
  allowWrite(...paths: string[]): SuiteBuilder {
    return this.#with({
      sandboxAccess: mergeAccess(this.#state.sandboxAccess, { allowedDomains: [], readablePaths: [], writablePaths: paths }),
    })
  }

  /**
   * Validates and returns the plain definition run by the orchestrator.
   * Throws a `SuiteDefinitionError` listing every issue.
   *
   * @example
   * const definition = suite("hello").variant(...).case(...).toDefinition()
   */
  toDefinition(): SuiteDefinition {
    return parseSuiteDefinition({
      ...this.#state,
      variants: this.#state.variants.map((v) => v.toDefinition()),
      cases: this.#state.cases.map((c) => c.toDefinition()),
    })
  }

  #with(patch: Partial<SuiteState>): SuiteBuilder {
    return new SuiteBuilder({ ...this.#state, ...patch })
  }
}

/**
 * Starts a suite. Export it as the default export of a `*.eval.ts` file.
 *
 * @example
 * export default suite("hello")
 *   .variant("baseline", v => v.prompt(c => `Say hello to ${c.context}`))
 *   .case("greets-world", c => c.context("world").expect(regex("says-hello", /hello/i)))
 */
export function suite(name: string): SuiteBuilder {
  return new SuiteBuilder({ name, variants: [], cases: [], beforeAll: [], afterAll: [], sandboxAccess: NO_ACCESS })
}

/**
 * True for a {@link SuiteBuilder}, including one created by another copy of this module.
 *
 * @example
 * if (isSuiteBuilder(module.default)) definition = module.default.toDefinition()
 */
export function isSuiteBuilder(value: unknown): value is SuiteBuilder {
  return typeof value === "object" && value !== null && SUITE_BRAND in value
}
