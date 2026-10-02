# proctor — working guide

Evaluation harness for coding agents (Claude Code today, OpenCode next): xUnit lifecycle, layered isolation, [CTRF](https://ctrf.io) reports.

- The package is self-contained: it imports nothing but Node and its declared dependencies.
- Tests never read files outside the package. A test that needs a sample brings it into `test/fixtures/`.

```text
cli ──> core ──> ports <── adapters (claude-code, opencode, local-temp, srt, docker)
                   ^
         graders, reporters, fixtures, loaders

shared (fs, text, ids): leaf, importable by every layer, imports none
```

The rule that carries everything else: `core/` and `ports/` know no agent, no sandbox, no concrete output format. Lint blocks the imports that would break it (`eslint/import-boundaries.js`), and the check is deterministic: it reads the import paths in the source, with no execution and no heuristic.

| Workaround | What closes it |
|---|---|
| a folder added under `src/` that nobody thought to forbid | each layer lists what it **may** import (`allow`): everything else is refused by default |
| an `// eslint-disable` on the rule | `test/architecture.test.ts` relints the whole tree with `allowInlineConfig: false`: the comment hides nothing in `npm test` |
| a computed `import(path)` that no static analysis follows | refused everywhere except `loaders/eval-ts.ts`, which loads the user's `*.eval.ts` |
| the rule disabled or misconfigured | `test/architecture.test.ts` checks that it refuses every forbidden case and accepts every allowed one |
| nobody runs the check | `npm run check` runs it; CI will make it mandatory |

## Boundaries

| Question | Rule | Why |
|---|---|---|
| What runs **outside** the agent's sandbox? | fixtures (`gitRepo`: `git` with the host env), `agent.prepare` (plugin install: sandbox env, no credential, open network), suite and variant hooks, graders | they need git credentials or the network, and the harness trusts them; nothing the agent writes runs there |
| Who may know a given agent? | `adapters/agents/<id>/`: yes | that is their job |
| | `loaders/legacy-json.ts`, a grader specific to one agent (`noToolNamed("…", "mcp__claude_ai_")`): allowed, named as such | they translate a format or check a surface of that agent |
| | `core/`, `ports/`: never | adding OpenCode must touch neither |
| Who defines the syntax of `.plugins(...)`? | the agent's adapter (`claude-code`: bare name + `--plugin-root`, absolute path, `plugin@marketplace`) | the core carries opaque strings |
| Who sees a credential? | the adapter alone, which masks it in everything it returns (`redact.ts`) | no transcript, grader or report may contain it |
| Where does a utility with no domain logic (path, text, identifier) live? | `src/shared/`, from its second copy on; it imports only Node and third-party dependencies, never a layer of the package (lint) | a leaf everyone can import creates no cycle; outside `core/`, a new adapter that adds one does not touch the core (Open/Closed test) |
| What does not belong in `src/shared/`? | anything that knows a port, the model or a format: a grader, a CTRF parser, a notion of trial (`trialLabel` stays in `core/`) | `shared/` would become a second core with no boundary; if it needs a type from the package, the utility belongs to that type's layer |
| What may `scripts/` import? | the whole package, adapters included (`rejudge.ts` instantiates `ClaudeCodeAdapter`) | they are manual campaign tools, like the CLI; nothing in `src/` imports them |
| Where to plug a new output? | a run event, as it happens: the `Reporter` port (`ports/reporter.ts`); a file derived from a CTRF: a `ReportFormat` in `cli/registry.ts`, plugged in as a `CtrfSink` | the first sees the run, the second reads only the CTRF, so it also works on an archived run (`proctor report`) |
| Where does a grader specific to a skill or a suite live? | `graders/` if options configure it, with the skill's defaults written in TSDoc (`yesNoContract`: words and filters of `check-if-need-humain-review`, overridable); what recognizes a suite's format: `loaders/` (`legacy-verdicts.ts`) | the grader stays reusable by another yes/no skill; another format is another contract, not one more option |
| How does a grader say "not applicable"? | `passed: true, criteria: []`: neither met nor missed anywhere (CTRF, aggregates as the share filled per trial, reports "—"), no score; a trial where no grade carries a criterion is `other` | an omitted criterion counted as missed or met skews the ablation; a success that checked nothing is not one |
| Where does a gate live? | on the grader that costs (`judge().when(predicate)`), not on `.expect()`; it targets what makes the criteria not applicable, not the expected verdict | a deterministic grader is free and returns its own verdict; a gate on the expected verdict would take the score away from a wrong answer |
| What goes into the judge's prompt? | the agent's answer and the diff, **untrusted data** between random-nonce delimiters, `<<<BEGIN nonce>>>` and `<<<END nonce>>>` (`judge-protocol.ts`) | the agent writes what the judge reads: an instruction slipped into its answer must not grade in the judge's place |

## Commands

```sh
npm run check     # format:check + lint + typecheck + test: green before any review
npm test          # vitest, no network or credential: unit and behavior projects
npm run test:unit # specs next to the sources; test:behavior for test/
npm run lint      # import boundaries + type-aware rules
npm run format    # Prettier
npx proctor run examples/hello.eval.ts --agent fake
```

## Language

| Where | Language |
|---|---|
| Code, identifiers, TSDoc, error messages | English |
| Everything the lib produces: console, markdown and HTML reports, CTRF | English |
| Judge prompt (`judge-protocol.ts`) | English |
| Default words and filters of `yesNoContract`, patterns of `legacy-verdicts.ts`, the legacy bash bench format (`cases/*.json` + `variants/`, verdicts `"oui"`/`"non"`, the `[leurre]` prefix) | French, kept literal: they are data of the legacy bench, still a supported loader, and of the evaluated skill, not outputs of the lib |
| `README.md`, docs, this file | English |
| Commit messages | English, Conventional Commits (see [commits and releases](#commits-and-releases)) |

## Commits and releases

Commits and PR titles follow [Conventional Commits](https://www.conventionalcommits.org): `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `chore`, `ci`, `build`.

release-please reads them to open the release PR, bump the version and write `CHANGELOG.md`. A wrong type means a wrong version or a missing changelog entry.

A breaking change is marked with `!` (`feat!: …`) or a `BREAKING CHANGE:` footer.

## Design principles

### One responsibility per module (SRP)

A file answers a single question. If a module's description contains "and", it probably needs to be split in two.

| Good split | Bad split |
|---|---|
| `lifecycle.ts` orders the hooks, `orchestrator.ts` walks the matrix | a `runner.ts` that does both, plus writing the report |
| `stream-parser.ts` translates the stream, `adapter.ts` builds the flags | a parser that also picks the auth profile |

The pragmatic limit: don't cut a 30-line module into three 10-line files. The cost of an indirection is paid on every read. Split when two reasons to change really coexist.

### Extend without modifying the core (Open/Closed)

Add an agent, a sandbox, a grader or a reporter by **adding a file** that implements a port, then registering it. No `switch` on an agent or sandbox name in `core/`.

```ts
// ✅ extension: a new file, the core stays unchanged
export const opencode = defineAgent({ id: "opencode", run: async (input, ws) => { /* ... */ } })

// ❌ modification: the core learns that an agent exists
if (agent === "opencode") { /* ... */ }
```

The conformance test: adding OpenCode produces no diff in `src/core/` or `src/ports/`. Any decision that would make this test impossible is a warning sign.

Don't anticipate extension points nothing asks for: a port exists only because at least two implementations are planned.

## API developer experience

The public API is what you write in a `*.eval.ts`. It must read as the description of the scenario and be discoverable through autocompletion.

```ts
import { suite, gitRepo, judge, limits } from "@fluce/proctor"

export default suite("review")
  .variant("baseline", v => v
    .prompt(c => `/code-review medium eval-pr\n\n${c.context}`))
  .variant("with-sdlc", v => v
    .plugins("sdlc")
    .prompt(c => `/sdlc:review eval-pr --spec eval-spec.md --effort medium\n\n${c.context}`))
  .case("list-beta-waitlist-registrations", c => c
    .fixture(gitRepo("git@github.com:org/repo.git").at("5fb0133").applyDiff("diffs/x.diff").overlay("overlays/x"))
    .expect(judge()
      .diff("diffs/x.diff")
      .criterion("date-filter-inverted", "Inverted date filter", { principal: true })
      .decoy("decoy-async-suffix", "Does not flag the Async suffix"))
    .expect(limits().maxCostUsd(3).maxDuration("10m")))
```

`test/claude-md.test.ts` compiles this example. `.plugins("sdlc")` is a bare name: it needs `--plugin-root <dir>` pointing at the folder that holds the `sdlc` plugin.

A `*.eval.ts` imports `@fluce/proctor` as an installed dependency, like any other package. Nothing resolves the import on its behalf: a project that runs evals declares `@fluce/proctor` in its own `package.json`.

What makes usage natural, and why:

| Choice | What it brings | What it costs |
|---|---|---|
| Fluent builder, each method returns a new immutable builder | reads like a sentence, autocompletion guides the next step | a bit more code in the lib than an object literal |
| Narrowing types (`criterion` exists only on `judge()`) | errors show up while writing, not at run time | generics to write with care |
| TSDoc with `@example` on every public method | the doc shows on hover in the editor, where it is needed | to maintain with the code |
| Explicit units (`maxDuration("10m")`, `maxCostUsd`) | no doubt between ms and s | a small parser |
| Safe defaults (`srt` sandbox, minimal permissions) | the simple case fits in three lines | advanced options must stay discoverable |
| Error messages that say what to do | `No credential: set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN` | none |

When an object literal is clearer, keep the object. Example: a bag of options with no order or dependency between fields. Fluent serves readability; it is not a dogma.

Internal ports (`AgentAdapter`, `Sandbox`…) stay plain interfaces. Fluent applies to the eval-writing API, not to the contracts between modules.

## Documentation

- Prefer visuals and examples over prose: file tree, Mermaid diagram, runnable code block, decision table.
- Every README starts with an example that works, then explains.
- One sentence per idea, no introductory paragraph.
- An example in the docs must compile. The examples in `examples/` are covered by the tests.

## Results and models

- `results/` stays ignored by git: a run is an artifact, not a source.
- Variants of real campaigns pin an exact model id, not an alias; the adapter writes the resolved model into the CTRF. The core imposes nothing: aliases and ids are specific to each agent.
- The judge too: a real campaign pins `judge().model(...)` or passes `--judge-model`. The legacy loader pins the model of the legacy bench's `judge.sh`. Without either, the run does not stop: the CLI warns and the CTRF writes `judgeModel: "unpinned (<resolved model>)"`, so that a non-comparable score is visible.

# Review

What a review checks on this package, on top of the [boundaries](#boundaries). `npm run check` chains format, lint, typecheck and tests: it must pass before asking for a review, and the review does not discuss what it already checks ([commands](#commands)).

## Strict typing

The compiler and the linter share the work. `tsconfig.json` refuses what is badly typed; ESLint in type-aware mode (`strictTypeChecked` + `stylisticTypeChecked`) refuses what is well typed but wrong, or typed by a lie.

| Option | What it catches |
|---|---|
| `strict` | implicit `any`, unhandled `null`, `catch (error)` as `unknown` |
| `noUncheckedIndexedAccess` | `list[0]` and `record[key]` can be `undefined` |
| `exactOptionalPropertyTypes` | `{ x?: string }` does not accept `{ x: undefined }`: absent and `undefined` are not the same |
| `noImplicitOverride`, `noFallthroughCasesInSwitch` | a method redefined without saying so, a `case` that falls into the next one |
| `verbatimModuleSyntax` | a type import without `type` |
| lint `no-unsafe-*` | an `any` coming in through `JSON.parse`, `import()` or a badly typed lib |
| lint `no-floating-promises`, `no-misused-promises` | a forgotten promise, an async callback where a synchronous return is expected |
| lint `no-unnecessary-condition` | a `?.` or a `??` on a value that cannot be absent: the type or the code lies |

Three rules are relaxed in `eslint.config.js`, each with its reason: a number in a template (`${ms}ms`), a short arrow that returns `void` (`() => void cleanup()`), an `async` without `await` that implements a promise-based port.

A cast (`as`) asserts to the compiler what it cannot check. It is allowed where nothing better exists, never to silence an error.

| Situation | Do | Don't |
|---|---|---|
| External data: `JSON.parse`, file, `stream-json` stream, `import()` | keep it `unknown`, then validate it (zod, already a dependency) or test it (`typeof`, `in`) | `JSON.parse(text) as CtrfReport` |
| Caught error | `asError(error)` (`core/errors.ts`) or `error instanceof Error` | `(error as Error).message` |
| Discriminated union | test the discriminant, or a guard `isToolUse(block): block is ToolUseBlock` | `event as HookEvent` |
| Keys of a typed object (`Object.keys(profiles)`) | a single cast, as close as possible, commented | the same cast repeated at every use |
| A value you "know" is present | a guard that throws an actionable error | `value!` (refused by the lint) |

An `eslint-disable-next-line` names its rule and has, right above it, a line that says why the rule is wrong here (example: `json-path.ts`, `JSON.stringify` returning `undefined` despite its type).

On the exported API, `readonly` on the fields and arrays of public interfaces: the lint cannot tell when a mutation would be a bug, the review can.

## Conventions the lint does not see

`eslint.config.js` already checks: kebab-case file names, `node:` prefix, `#private` members, named exports, explicit return types on the API, no nested ternary, imports of behavior tests. What follows takes judgment, hence a review.

| Choice | When | Example |
|---|---|---|
| Class | what has state or identity: adapter, sandbox, reporter, builder, error | `ClaudeCodeAdapter`, `SrtSandbox`, `CtrfReporter` |
| Lowercase factory returning a literal | a stateless grader or fixture | `regex()`, `jsonPath()`, `directory()` |
| Fluent builder | the eval-writing API: entry factory, immutable `#state`, `#with(patch)` | `suite()`, `judge()`, `gitRepo()` |
| `function` | a function of more than one expression | `runProcess`, `renderHtml` |
| `const f = (…) =>` | a one-expression one-liner | `trialLabel`, `extraOf` |
| Dedicated error class | the error is found by its type (`findCause`) or named in a report; it lives next to its domain, with `override readonly name` | `AgentRunError`, `GradeError`, `CredentialError` |
| Plain `Error` | everything else, with a message that says what to do | `` `minScore must be an integer from 1 to 5, got ${score}.` `` |
| Documented `SCREAMING_SNAKE` constant | a number or a domain bound, as soon as it means something beyond its line | `KILL_GRACE_MS`, `MAX_PROMPT_BYTES`, `JUDGE_SCORE` |
| Shared utility in `src/shared/` | from the second copy on, see [boundaries](#boundaries) | `isDirectory`, `realPath` (`fs.ts`), `clip` (`text.ts`), `timestampedId` (`ids.ts`) |
| `index.ts` barrel | only for a public entry point (`src/index.ts`, `src/testing/`, `src/ports/`); an internal module imports the file, never the barrel | — |

## Formatting

Prettier decides the form, ESLint the substance. `eslint-config-prettier` turns off the style rules that would contradict Prettier, so the two never fight.

| Setting | Value | Why |
|---|---|---|
| `semi` | `false` | the style of the existing code |
| `printWidth` | `140` | TSDoc and test tables fit on one line; at 80, builder chains break into a staircase |
| quotes, trailing commas, arrow parentheses | Prettier defaults (`"`, `all`, `always`) | already the style of the code |

A review remark on formatting is a sign that `npm run format` did not run, not a topic for discussion. `README.md`, `CLAUDE.md` and `test/fixtures/` are outside Prettier: Markdown tables and recorded fixtures keep their shape.

## Tests: unit next to the code, behavior apart

| | Unit | Behavior |
|---|---|---|
| Where | `src/<path>/<module>.spec.ts`, next to `<module>.ts` (same for `scripts/<script>.spec.ts`) | `test/*.test.ts` |
| What it pins | a module's contract: inputs, outputs, errors | the package as a user uses it: DSL, `runSuite`, CLI, doc examples |
| What it imports | its subject by relative path (`./duration.ts`), the doubles from `@fluce/proctor/testing` | `@fluce/proctor`, `@fluce/proctor/testing`, the CLI (`src/cli/main.ts`), the loaders (`src/loaders/index.ts`); a concrete adapter only to run it end to end (`srt.integration.test.ts`); the lint refuses the rest |
| Vitest project | `unit` | `behavior` |
| When it breaks | the module changed its contract | the wiring between modules changed: hook order, CTRF written by the CLI, exit code |

Where to put a new test: if it stays true when every other module is replaced by doubles, it is a spec. If it describes what the user sees at the end of the chain, it is a behavior test.

| Example | Type |
|---|---|
| `parseDuration("10m")` is 600,000 ms; `"10"` throws a message that says what to do | spec, `src/core/duration.spec.ts` |
| the parser replays a recorded `stream-json` stream and returns turns, cost and model | spec, `stream-parser.spec.ts` |
| an interrupted trial exits with 2 and still writes the report | behavior, `test/cli.test.ts` |
| hooks run in xUnit order, teardown included when `act` throws | behavior, `test/lifecycle.test.ts` |

What does not change from one type to the other:

- Shared support lives in `test/support/` and is imported through the `#test/*` subpath import (`package.json` `imports`): `import { tempDir, fixturePath } from "#test/helpers.ts"`. No `../../../test/` in a spec.
- Recorded fixtures stay in `test/fixtures/`, read through `fixturePath("stream-json", "say-ok.jsonl")`.
- A test reads only files of the package: its sources, `test/fixtures/`, or what it writes in a temp dir. Never a path outside the repository, never a sibling checkout.
- A spec under `src/core/` or `src/ports/` respects the same boundaries as the module: the `import-boundaries` lint and `test/architecture.test.ts` (no mention of an agent) cover it.
- Write the test first, with `FakeAgentAdapter` and `FakeSandbox`. No test calls a real LLM, and `test/support/setup.ts` cuts network and credentials for all of them.
- Real runs (isolation probe, parity) are documented manual campaigns, not `npm test` tests.
