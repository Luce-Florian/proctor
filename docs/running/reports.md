# Reports and ablation

A run writes a single CTRF, then derives every report from it. `proctor report` regenerates them from an archived CTRF.

| Where | Content |
|---|---|
| `results.extra.aggregates.groups[]` | per case × variant: trials by status, criteria and decoys (**share met per trial**, in `[0, 1]`, mean ± standard deviation, shown as %), principal met, score (with its `n`), cost, duration, judge calls and cost; criteria, score, cost and duration averaged over graded trials (`passed`, `failed`) only; a trial's share has its own criteria as denominator, a closed gate takes no point away; principal met counted over the trials that have a principal (otherwise "—") |
| `results.extra.ablation[]` | Δ (variant − `--baseline`) of criteria (in share points), score, cost, pass rate; the pass-rate Δ is absent ("—") when one side has no graded trial, instead of a false ±100 pts |
| `<runId>.summary.md` | trials, aggregates, judge line, ablation |
| `<runId>.report.html` (`--report html`, or `proctor report <ctrf> --format html`) | standalone page: summary and status bar, variants and ablation card, criteria × trials map (principal, decoy), trials, raw CTRF tab; light and dark; the only request: Google Fonts, optional |

- Sample standard deviation (n − 1).
- Reports always recompute the aggregates from `tests[]` (`aggregatesOf`): a CTRF that predates the aggregates works, and an edited `results.extra` is never displayed as is.
- The fields of the CTRF are listed in the [CTRF reference](./ctrf.md).

## Rejudge

Judge an archived run again without rerunning the agent (`claude-code` transcripts). The archived baseline only counts the judge's criteria (`grader: "judge"`):

```sh
CLAUDE_CODE_OAUTH_TOKEN=… npm run rejudge -- results/<suite>/<runId>.ctrf.json path/to/suite.eval.ts --times 3 [--test "baseline] #1"]
```

`scripts/rejudge.ts` is a manual campaign tool, run from a clone of this repo.
