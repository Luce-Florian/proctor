# Porting a theme to `*.eval.ts`

| Bash bench | `*.eval.ts` |
|---|---|
| `cases/<id>.json` | `.case(id, ...)`; `description` and `context` (the sentence shared by the variants) |
| `prompt`, an object per variant | `.prompt((c) => …)` of each variant, which only changes the invocation line |
| the case's `effort` | an `EFFORT` table in the file, read by the prompts: `CaseContext` only carries `id` and `context` |
| `repo`, `diff_file`, `diff_apply`, `overlay_dir` | `gitRepo(url).at(sha).applyDiff(url).overlay(url)`, paths as `new URL(…, import.meta.url)` |
| `expected.criteria`, `[principal]`, `[leurre]` | `judge().criterion(id, text, { principal })`, `.decoy(id, text)`: descriptive ids instead of `c01`… |
| `variants/*/settings.json` `{"model": …}` | `.model(id)`: the redundant `--settings` goes away |
| `variants/*/plugins` | `.plugins(<absolute path>)`, resolved from the file: no `--plugin-root` to pass |

```ts
import { fileURLToPath } from "node:url"
import { gitRepo, judge, suite } from "@fluce/proctor"

const EFFORT: Record<string, string> = { "list-beta-waitlist-registrations": "medium" }
const plugin = fileURLToPath(new URL("../marketplace/plugins/sdlc", import.meta.url))

export default suite("review")
  .variant("baseline", (v) => v.model("claude-sonnet-5").prompt((c) => `/code-review ${EFFORT[c.id] ?? "medium"} eval-pr\n\n${c.context}`))
  .variant("with-sdlc", (v) =>
    v
      .model("claude-sonnet-5")
      .plugins(plugin)
      .prompt((c) => `/sdlc:review eval-pr --effort ${EFFORT[c.id] ?? "medium"}\n\n${c.context}`),
  )
  .case("list-beta-waitlist-registrations", (c) =>
    c
      .context("Review the pull request.")
      .fixture(gitRepo("git@github.com:org/repo.git").at("5fb0133").applyDiff(new URL("./diffs/x.diff", import.meta.url)))
      .expect(
        judge()
          .model("claude-sonnet-5")
          .diff(new URL("./diffs/x.diff", import.meta.url))
          .criterion("date-filter-inverted", "Flags the inverted date filter", { principal: true })
          .decoy("async-suffix", "No finding objects to the Async suffix"),
      ),
  )
```

- Parity can be checked offline: load both definitions (legacy loader, `*.eval.ts`) and compare them. On the first ported theme, a code-review theme, they gave byte-identical prompts, the same criteria texts in the same order, the same principal and decoys, the same fixture, model, permissions and timeout.
- The ported file imports `@fluce/proctor` like any installed dependency: see [Getting started](../getting-started.md#install).
- A run of a ported theme: [2026-10-02: ported theme](../campaigns/2026-10-02-ported-theme.md).
