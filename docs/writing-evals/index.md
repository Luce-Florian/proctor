# Suites, variants, cases

A suite is a matrix: each case runs once per variant, `--repeat` times.

```ts
import { gitRepo, judge, limits, suite } from "@fluce/proctor"

export default suite("review")
  .variant("baseline", (v) => v.prompt((c) => `/code-review medium eval-pr\n\n${c.context}`))
  .variant("with-sdlc", (v) =>
    v.plugins("sdlc").prompt((c) => `/sdlc:review eval-pr --spec eval-spec.md --effort medium\n\n${c.context}`),
  )
  .case("list-beta-waitlist-registrations", (c) =>
    c
      .fixture(
        gitRepo("git@github.com:org/repo.git")
          .at("5fb0133")
          .applyDiff(new URL("./diffs/x.diff", import.meta.url))
          .overlay(new URL("./overlays/x", import.meta.url)),
      )
      .expect(
        judge()
          .model("claude-sonnet-5")
          .diff(new URL("./diffs/x.diff", import.meta.url))
          .criterion("date-filter-inverted", "Inverted date filter", { principal: true })
          .decoy("decoy-async-suffix", "Does not flag the Async suffix"),
      )
      .expect(limits().maxCostUsd(3).maxDuration("10m")),
  )
```

`.plugins("sdlc")` is a bare name: it needs `--plugin-root <dir>` pointing at the folder that holds the `sdlc` plugin (see [Claude Code: plugins](../agents/claude-code/plugins.md)).

## Builders

| Builder | Methods |
|---|---|
| `suite(name)` | `.variant(name, v => …)`, `.case(id, c => …)`, `.beforeAll(fn)`, `.afterAll(fn)`, `.allowDomains(...)`, `.allowRead(...)`, `.allowWrite(...)`, `.toDefinition()` |
| variant `v` | `.prompt(text \| c => …)`, `.plugins(...)`, `.mcpServers({…})`, `.model(id)`, `.permissions(p)`, `.settings({…})`, `.beforeEach(fn)`, `.afterEach(fn)` |
| case `c` | `.description(t)`, `.context(t)`, `.fixture(f)`, `.expect(grader)`, `.timeout("10m")`, `.skip(reason)` |

- Each method returns a new builder: a partial builder can be shared between suites.
- Types narrow: a variant without `.prompt()` or a case with neither `.expect()` nor `.skip()` does not compile (`VariantBuilder<"without-prompt">` is not assignable to `VariantBuilder<"with-prompt">`). Zod validation at load time remains the safety net for suites written in JS.
- Safe defaults: permissions `readonly`, timeout `10m`.
- An invalid definition throws a `SuiteDefinitionError` that lists every problem and says what to add, e.g. `case "x" > graders: Case has no expectation: add .expect(...)`.

## Building blocks

| Building block | Available |
|---|---|
| Fixtures | `directory(url, { into? })`, `gitRepo(url)`: see [Fixtures](./fixtures.md) |
| Graders | deterministic and judge: see [Graders](./graders.md) |
| Agents | `claude-code`, `fake` (`src/testing/`) |
| Sandboxes | `srt`, `local-temp`, `fake`: see [Sandboxes](../sandboxes.md) |

## Pinning models

- A variant of a real campaign pins an exact model id with `.model(id)`, not an alias. The adapter writes the resolved model into the CTRF.
- The judge too: pin `judge().model(...)` or pass `--judge-model`. Without either, the run does not stop: the CLI warns and the CTRF writes `judgeModel: "unpinned (<resolved model>)"`, so a non-comparable score is visible.
