# Graders

Deterministic wherever possible, an LLM judge for the rest.

```ts
import { answerShape, fileUnchanged, judge, limits, suite, toolUsed, verdictEquals, verdictIs, yesNoContract } from "@fluce/proctor"

export default suite("check")
  .variant("baseline", (v) => v.prompt("/sdlc:check-if-need-humain-review …"))
  .case("migration", (c) =>
    c
      .expect(verdictEquals("verdict", "yes"))                          // 1. the verdict, principal
      .expect(answerShape("format", yesNoContract()))                   // 2. "oui", then one line per pattern (zod)
      .expect(judge()                                                   // 3. the meaning of the lines
        .model("claude-sonnet-5")
        .criterion("ddl", "A line identifies a DDL migration", { principal: true }))
      .expect(toolUsed("reads-diff", { tool: "Read", input: /eval-pr\.diff/ }))
      .expect(fileUnchanged("readonly", /^src\//))
      .expect(limits().maxCostUsd(3).maxDuration("10m")),
  )
  .case("split-controller", (c) =>
    c
      .expect(verdictEquals("verdict", ["no", "yes"]))                  // both verdicts are valid
      .expect(answerShape("format", yesNoContract()))
      .expect(judge()                                                   // only "oui" has lines to judge
        .model("claude-sonnet-5")
        .criterion("routes", "No line claims that the routes change", { principal: true })
        .when(verdictIs("yes"))),
  )
  .case("review", (c) =>
    c.expect(
      judge()
        .model("claude-sonnet-5")
        .diff(new URL("./diffs/x.diff", import.meta.url))
        .criterion("date-filter-inverted", "Flags the inverted date filter", { principal: true })
        .decoy("async-suffix", "No finding objects to the Async suffix"),
    ),
  )
```

## Reference

| Grader | Passes when | Reads |
|---|---|---|
| `regex(id, /pattern/)` | the final text matches | `finalText` |
| `jsonPath(id, "$.a[0].b", expected, { file? })` | the value at the path is equal, matches a regex or satisfies a predicate; no JSON = criterion missed | `finalText` or a workspace file (symbolic links and paths outside the workspace rejected) |
| `fileChanged(id, path \| /pattern/)`, `fileUnchanged(...)` | at least one / no matching file added, modified or deleted | sha256 snapshot taken just before the agent (`grader.prepare`), `.git/` excluded; **no `git` is run**: a repo written by the agent could run its hooks or filters on the host |
| `toolUsed(id, { tool, input? }, { min?, max? })` | between `min` (default 1) and `max` matching calls | `toolCalls` |
| `toolCallsFail(id, { tool, input }, { evidence? })` | the agent attempted the matching call and every attempt failed; not attempting it fails too; with `evidence`, every failure must also say why (a missing file is not a denied read) | `toolCalls` |
| `toolCallsSucceed(id, { tool, input })` | the agent attempted the matching call and every attempt succeeded: the positive control that tells a sandbox block from a tool that does not work | `toolCalls` |
| `toolOutputsExclude(id, { tool, input }, /pattern/)` | the agent ran the matching call and none of its outputs matches, e.g. no credential in what `env` printed | `toolCalls` |
| `noToolNamed(id, prefix)` | no tool whose name starts with `prefix` was called, nor named in the final text, e.g. `"mcp__claude_ai_"`; `escapeRegExp` matches a literal path in an `input` | `toolCalls`, `finalText` |
| `transcriptExcludes(id, /pattern/)` | no line of the raw transcript matches, e.g. a credential or the mask; no transcript fails | the transcript |
| `verdictEquals(id, "yes" \| ["no", "yes"], { words? })` | the first line of the answer is **exactly** the expected word: see [Yes/no answers](./yes-no-answers.md) | `finalText` |
| `answerShape(id, contract)` | `contract.parse(text)` satisfies `contract.schema` (zod); otherwise `why` lists the zod issues, `path: message`; a `parse` that throws = criterion missed | `finalText` |
| `yesNoContract({ words?, verdicts?, maxReasonLength? })` | contract for `answerShape`: see [Yes/no answers](./yes-no-answers.md) | — |
| `limits().maxCostUsd(3).maxDuration("10m")` | cost and duration **of the evaluated agent** under the caps; unreported cost = criterion missed | `costUsd`, `durationMs` |
| `judge()` | score ≥ `.minScore()` (default 3) and principal met; with `.when(predicate)`, only if the predicate holds on the agent's run: see [LLM judge](./judge.md) | the judge agent's answer |

- Tool-call and transcript graders only give counts in their `why`, never a tool's output or a line: a credential never reaches a report through them.
- `judge()` and `limits()` without a criterion or cap are not graders: `.expect(judge())` does not compile.
- A verdict carries `text` (the criterion as the author wrote it): reports show it next to the id.

## Statuses

| Status | When |
|---|---|
| `passed` | all graders pass |
| `failed` | a grader returns `passed: false`, or a `principal` criterion is missed even if the grader says `passed`; the message lists the missed criteria |
| `other` | infra error (see [Lifecycle](./lifecycle.md)), or nothing was graded: see below |
| `skipped` | `.skip()`; no sandbox created |

## Not applicable

A grader says "not applicable" with `passed: true, criteria: []`.

- Its criteria are absent from the trial (CTRF, aggregates): neither met nor missed. The HTML report shows "—" (not graded).
- A trial whose graders all left their criteria out is `other` ("Nothing was graded"): a success that checked nothing is not one. Keep a principal criterion outside any gate, e.g. `verdictEquals`.
