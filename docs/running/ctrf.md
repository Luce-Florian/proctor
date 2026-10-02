# CTRF reference

Every run writes one [CTRF](https://ctrf.io) document: `<out>/<suite>/<runId>.ctrf.json`.

```text
<out>/<suite>/<runId>.ctrf.json
├── reportFormat "CTRF", specVersion "1.0.0", reportId, runId, timestamp, generatedBy
└── results
    ├── tool          {name "proctor", version}
    ├── summary       {tests, passed, failed, other, skipped, pending, suites, start, stop, duration}
    ├── environment   {reportName, commit, branchName, osPlatform, osRelease}
    │   └── extra     {agent {id, version, details}, sandbox {id}, isolation, judge?}
    ├── tests[]       one per trial, in matrix order
    │   ├── name "case [variant] #n", testId, executionId, suite [suite, case, variant]
    │   ├── status, duration, start, stop, message?, trace?, labels {case, variant, trial}
    │   └── extra     {criteria[], score, costUsd, model, pluginSha, tokens, turns,
    │                  agentDurationMs, transcript, judgeCalls, judgeCostUsd, judgeTokens,
    │                  judgeModel, judgeTranscripts, judgeTruncated}
    └── extra         {aggregates {baseline, groups[], judge}, ablation[], suiteErrors?}
```

| Decision | Choice | Why |
|---|---|---|
| Reference schema | [`ctrf.schema.json`@`66e823c`](https://github.com/ctrf-io/ctrf/blob/66e823ca2c9e1f54bf8b387adda0b7e0c7610538/schema/ctrf.schema.json), vendored as is in `test/fixtures/ctrf/` | every test validates the produced reports with ajv, without network |
| `specVersion` | `"1.0.0"` | SemVer string required by the schema, the value of the official examples |
| `tests[].suite` | array `[suite, case, variant]` | the schema defines it as the hierarchy, from the top to the direct parent, `minItems: 1` |
| `tests[].name` | `case [variant] #n` | readable in CTRF tools |
| `testId` / `executionId` | `suite/case/variant` / `…#n` | stable id of the logical test, unique id of the trial |
| `tests[].labels` | `case`, `variant`, `trial` | filterable in CTRF tools |
| `tests[].extra` | `criteria[id, met, why, principal, decoy, grader]`, `score`, `costUsd`, `model` (resolved by the agent), `pluginSha`, `tokens` (including cache), `turns`, `agentDurationMs`, `transcript` | criteria are identified by `id`, never by index |
| A single document per run | `CtrfReporter` builds the CTRF once, writes it, then passes it to its sinks (`<runId>.summary.md`) | the markdown comes exactly from the written JSON; two runs never overwrite each other |
| `results.extra.aggregates` | per case × variant: trials by status, criteria, decoys, principal, score, cost (mean ± standard deviation), duration, judge calls and cost; `judge`: run total | computed from the `tests` alone, so also on an archived CTRF |
| `results.extra.ablation` | per case and variant ≠ `--baseline`: Δ criteria, Δ score, Δ cost, Δ pass rate | the delta vs baseline of `claude plugin eval` |
| `tests[].extra.judge*` | `judgeCalls` (retries included), `judgeCostUsd`, `judgeTokens`, `judgeModel`, `judgeTranscripts`, `judgeTruncated` (`{diffBytes, answerBytes}` omitted from the prompt) | the judge's cost is never mixed with the agent's `costUsd` |
| `environment.extra.judge` | `{ id, version, details, sandbox, model? }` | the report says who judged |
| `results.extra.suiteErrors` | present only if `afterAll` failed | a suite error with no trial to carry it |
| `results.environment` | `reportName`, `commit`, `branchName` (omitted on a detached HEAD), `osPlatform`, `osRelease`, `extra.{agent: {id, version, details}, sandbox, isolation}` | the schema forbids free fields outside `extra`; `details` carries the auth profile |
| `environment.extra.isolation` | `none` (fake), `degraded`, `full`; repeated in the summary header | a report always says how isolated the run was |
