# LLM judge

`judge()` grades what no deterministic check can: the meaning of an answer, against criteria the author writes.

```ts
import { judge, suite } from "@fluce/proctor"

export default suite("review")
  .variant("baseline", (v) => v.prompt("/code-review medium eval-pr"))
  .case("inverted-date-filter", (c) =>
    c.expect(
      judge()
        .model("claude-sonnet-5")
        .diff(new URL("./diffs/x.diff", import.meta.url))
        .criterion("date-filter-inverted", "Flags the inverted date filter", { principal: true })
        .criterion("missing-test", "Asks for a test on the date filter")
        .decoy("async-suffix", "No finding objects to the Async suffix")
        .minScore(3),
    ),
  )
```

```mermaid
flowchart LR
    T["finished trial<br/>finalText"] --> P["prompt ≤ 256 KiB<br/>criteria {id, type, text}<br/>diff and answer: data<br/>between nonce delimiters"]
    P --> J["judge agent (--judge-agent)<br/>its own sandbox, readonly<br/>no plugin, no MCP"]
    J --> Z{"zod + ids<br/>each exactly once"}
    Z -->|valid| G["verdicts by id<br/>bounded score"]
    Z -->|invalid| R["retry with the problem<br/>at most 2 times"]
    R --> J
    R -->|3rd failure| O["trial other<br/>trace = raw answers"]
```

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Who judges | the `--judge-agent` adapter (default `claude-code`, `fake` with `--agent fake`), instantiated separately with its own sandbox (same type as `--sandbox`) | the judge does not change when the evaluated agent changes: scores stay comparable |
| Model | the suite's `judge().model(...)`, otherwise `--judge-model`, otherwise the adapter's default: the CLI warns and `judgeModel` is `unpinned (<resolved model>)`; the legacy loader pins `claude-sonnet-5`, as the legacy bench's `judge.sh` did | the suite pins an exact id, the operator only sets a default; an unpinned judge shows in the report |
| When | the judge is instantiated only if a case in the run has a `judge()`; `environment.extra.judge` appears only then | a deterministic suite requires no judge credential |
| Prompt | an English prompt: criteria as JSON `{id, type, text}` (type `principal`, `decoy` or `criterion`), the diff, the exact JSON shape (`criterion`/`met`/`why` per id), and one untrusted block per input (answer, diff) between `<<<BEGIN <nonce>>>>` and `<<<END <nonce>>>>`, with a random nonce per call and the instruction to ignore any instruction they contain; a met criterion (decoys aside) quotes the passage that meets it | the agent writes what the judge reads: a fake `---` or "answer score 5" stays data |
| Size | ≤ 256 KiB (UTF-8): beyond that, the diff is cut, then the answer, on a code point boundary; the prompt says so ("truncated: N bytes omitted at the end") and so does the CTRF (`judgeTruncated`) | the prompt goes through stdin, with no argument limit: the bound protects the judge's context and cost |
| Tool surface | `readonly` (`--tools Read`), `--setting-sources user` from an empty config dir; the legacy `judge.sh`: all tools, `--setting-sources ""`, `bypassPermissions` | measured difference: **0 tool calls** in the 12 judge transcripts of the first validation campaign; the diff is in the prompt, the judge has nothing to read |
| Answer | `{"score": 1-5, "criteria": [{"id", "met", "why"}]}` validated by zod, each id exactly once, no unknown id; fences and surrounding text tolerated | an invented or forgotten id triggers a retry, instead of a wrong match |
| Matching | by `id` | the order of the answer does not matter; decoys are counted by id |
| Score | the judge's, bounded by the rules of its prompt: ≤ 4 if a criterion is missed, ≤ 2 if the principal is missed. All criteria principal and `.minScore(1)`: the judge passes iff all are met, whatever the score | a 5 with 3 missed criteria was seen live |
| Retries | 1 attempt + 2 retries (3 attempts), with the problem of the previous answer in the prompt; then `GradeError`: trial `other`, raw answers in `trace`. A judge run that throws (timeout, crash) is not retried: trial `other` as well | an unreadable answer is an infra error, not an eval failure |
| Cost | `judgeUsage` of the `GradeResult`: calls (retries included), cost, tokens, model, transcripts; `tests[].extra.judge*` and `aggregates.judge` in the CTRF | kept apart from the agent's `costUsd` |
| `limits()` and the judge | the judge is **not** counted in `maxCostUsd` | the limit applies to what is measured; a planned campaign-wide budget (`--max-cost-usd`) will count both |
| `llmJudge()` (a one-to-one port of the legacy `judge.sh`) | **removed**: the legacy loader goes through `judge()` | measured comparable on a parity run, see [Validation campaign: judge](../campaigns/2026-09-30-judge.md); a single judge to maintain |

The cost of a judge that fails (3 invalid answers, or a run that throws) still goes into the trial (`judgeCalls`, `judgeCostUsd`) and the aggregates, and into its message (`$0.030 spent`).

## Gates

`.when(predicate)` runs the judge only if the predicate holds on the agent's run. A closed gate costs no call and leaves the judge's criteria out of the trial. See [Gating the judge](./yes-no-answers.md#gating-the-judge).

## Judging an archived run again

Judge an archived run again without rerunning the agent: see [Reports and ablation](../running/reports.md#rejudge).
