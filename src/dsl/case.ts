import { parseDuration, type Duration } from "../core/duration.ts"
import type { CaseDefinition } from "../core/model.ts"
import type { Fixture } from "../ports/fixture.ts"
import type { Grader } from "../ports/grader.ts"

/** Default maximum duration of an agent run. */
export const DEFAULT_TIMEOUT: Duration = "10m"

/** Whether the case has an `.expect()` or a `.skip()`. `suite().case()` only accepts a `"with-expectation"` builder. */
export type ExpectationState = "without-expectation" | "with-expectation"

declare const expectationState: unique symbol

/**
 * Describes one scenario. Obtained from `suite(...).case(id, c => c...)`.
 * Every method returns a new builder: builders are immutable and can be shared.
 * Forgetting `.expect()` is a type error: `CaseBuilder<"without-expectation">` is not assignable to `CaseBuilder<"with-expectation">`.
 */
export class CaseBuilder<State extends ExpectationState = ExpectationState> {
  /** Type-level only, absent at runtime. */
  declare readonly [expectationState]: State
  readonly #state: CaseDefinition

  /** @internal Use `suite(...).case(id, c => ...)` instead. */
  constructor(state: CaseDefinition) {
    this.#state = state
  }

  /**
   * One-line description shown in `proctor list` and reports.
   *
   * @example
   * c.description("Date filter inverted in the finder")
   */
  description(description: string): CaseBuilder<State> {
    return this.#with({ description })
  }

  /**
   * Free text handed to variant prompts as `c.context`.
   *
   * @example
   * c.context("The eval-pr branch implements eval-spec.md.")
   */
  context(context: string): CaseBuilder<State> {
    return this.#with({ context })
  }

  /**
   * Adds a fixture. Fixtures are set up in order and torn down in reverse order.
   *
   * @example
   * c.fixture(directory(new URL("./repo", import.meta.url)))
   */
  fixture(fixture: Fixture): CaseBuilder<State> {
    return this.#with({ fixtures: [...this.#state.fixtures, fixture] })
  }

  /**
   * Adds a grader. The trial passes only if every grader passes.
   *
   * @example
   * c.expect(regex("says-hello", /hello/i))
   */
  expect(grader: Grader): CaseBuilder<"with-expectation"> {
    return new CaseBuilder<"with-expectation">({ ...this.#state, graders: [...this.#state.graders, grader] })
  }

  /**
   * Maximum duration of the agent run (default `"10m"`). Past it, the trial is `other`.
   *
   * @example
   * c.timeout("15m")
   */
  timeout(duration: Duration): CaseBuilder<State> {
    return this.#with({ timeoutMs: parseDuration(duration) })
  }

  /**
   * Reports the case as `skipped` without running it. A skipped case needs no expectation.
   *
   * @example
   * c.skip("waiting for the fixture repo to be public")
   */
  skip(reason = "skipped"): CaseBuilder<"with-expectation"> {
    return new CaseBuilder<"with-expectation">({ ...this.#state, skipReason: reason })
  }

  /** @internal Unvalidated state; the suite validates it. */
  toDefinition(): CaseDefinition {
    return this.#state
  }

  #with(patch: Partial<CaseDefinition>): CaseBuilder<State> {
    return new CaseBuilder<State>({ ...this.#state, ...patch })
  }
}

/** @internal */
export const emptyCase = (id: string): CaseBuilder<"without-expectation"> =>
  new CaseBuilder<"without-expectation">({ id, context: "", fixtures: [], graders: [], timeoutMs: parseDuration(DEFAULT_TIMEOUT) })
