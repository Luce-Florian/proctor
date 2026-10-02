import type { Permissions } from "../ports/agent.ts"
import type { CaseContext, TrialHook, VariantDefinition } from "../core/model.ts"

type VariantState = Omit<VariantDefinition, "prompt"> & { readonly prompt?: VariantDefinition["prompt"] }

/** Whether `.prompt()` was called. `suite().variant()` only accepts a `"with-prompt"` builder. */
export type PromptState = "without-prompt" | "with-prompt"

declare const promptState: unique symbol

/**
 * Describes one arm of the comparison. Obtained from `suite(...).variant(name, v => v...)`.
 * Every method returns a new builder: builders are immutable and can be shared.
 * Forgetting `.prompt()` is a type error: `VariantBuilder<"without-prompt">` is not assignable to `VariantBuilder<"with-prompt">`.
 */
export class VariantBuilder<State extends PromptState = PromptState> {
  /** Type-level only, absent at runtime. */
  declare readonly [promptState]: State
  readonly #state: VariantState

  /** @internal Use `suite(...).variant(name, v => ...)` instead. */
  constructor(state: VariantState) {
    this.#state = state
  }

  /**
   * Sets the prompt sent to the agent, as text or built from the case.
   *
   * @example
   * v.prompt(c => `/code-review medium eval-pr\n\n${c.context}`)
   */
  prompt(prompt: string | ((context: CaseContext) => string)): VariantBuilder<"with-prompt"> {
    return new VariantBuilder<"with-prompt">({ ...this.#state, prompt: typeof prompt === "string" ? () => prompt : prompt })
  }

  /**
   * Adds plugins the agent must load; nothing else is loaded.
   *
   * @example
   * v.plugins("sdlc")
   */
  plugins(...plugins: string[]): VariantBuilder<State> {
    return this.#with({ plugins: [...this.#state.plugins, ...plugins] })
  }

  /**
   * Adds MCP servers, keyed by name. Definitions are passed as-is to the agent adapter.
   *
   * @example
   * v.mcpServers({ docs: { command: "docs-mcp" } })
   */
  mcpServers(servers: Record<string, unknown>): VariantBuilder<State> {
    return this.#with({ mcpServers: { ...this.#state.mcpServers, ...servers } })
  }

  /**
   * Pins an exact model id. Prefer an id over an alias: aliases move over time.
   *
   * @example
   * v.model("claude-sonnet-5")
   */
  model(model: string): VariantBuilder<State> {
    return this.#with({ model })
  }

  /**
   * Grants more than the default `readonly` permissions.
   *
   * @example
   * v.permissions("workspace-write")
   */
  permissions(permissions: Permissions): VariantBuilder<State> {
    return this.#with({ permissions })
  }

  /**
   * Merges adapter-specific settings, opaque to the harness.
   *
   * @example
   * v.settings({ effort: "medium" })
   */
  settings(settings: Record<string, unknown>): VariantBuilder<State> {
    return this.#with({ settings: { ...this.#state.settings, ...settings } })
  }

  /**
   * Runs after fixtures are set up and before the agent, in the trial workspace.
   *
   * @example
   * v.beforeEach(async ({ workspace }) => installPlugin(workspace.home))
   */
  beforeEach(hook: TrialHook): VariantBuilder<State> {
    return this.#with({ beforeEach: [...this.#state.beforeEach, hook] })
  }

  /**
   * Runs after grading, before fixture teardown. Always runs once fixtures are set up, even if `beforeEach` threw.
   *
   * @example
   * v.afterEach(({ workspace }) => console.log(workspace.cwd))
   */
  afterEach(hook: TrialHook): VariantBuilder<State> {
    return this.#with({ afterEach: [...this.#state.afterEach, hook] })
  }

  /** @internal Unvalidated state; the suite validates it. */
  toDefinition(): VariantDefinition {
    return this.#state as VariantDefinition
  }

  #with(patch: Partial<VariantState>): VariantBuilder<State> {
    return new VariantBuilder<State>({ ...this.#state, ...patch })
  }
}

/** @internal */
export const emptyVariant = (name: string): VariantBuilder<"without-prompt"> =>
  new VariantBuilder<"without-prompt">({
    name,
    plugins: [],
    mcpServers: {},
    permissions: "readonly",
    settings: {},
    beforeEach: [],
    afterEach: [],
  })
