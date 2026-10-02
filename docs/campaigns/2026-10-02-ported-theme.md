# 2026-10-02: a theme ported to `*.eval.ts`

Run on 2026-10-02: CLI `2.1.280`, profile `oauth`, sandbox `srt`, agent and judge `claude-sonnet-5`, review plugin pinned at a fixed commit.

```sh
npx proctor run path/to/review.eval.ts --agent claude-code --repeat 3 -j 3 --report markdown,html
```

| Variant | Criteria per trial | Mean | Legacy loader (parity run) | Difference | Principal | Decoys | Mean cost |
|---|---|---|---|---|---|---|---|
| baseline | 10, 10, 10 | 10.0 / 12 | 9.7 / 12 | +0.3 | 3 / 3 | 2 / 2 | $0.30 (parity run: $0.32) |
| with the review plugin | 12, 12, 12 | 12.0 / 12 | 11.3 / 12 | +0.7 | 3 / 3 | 2 / 2 | $1.32 (parity run: $1.24) |

- Acceptance criterion held for this theme: less than one criterion of difference on average with the legacy loader, in each variant.
- baseline misses `dtos-in-controller-file` in all 3 trials; also `findings-on-diff-files-only` (#1, #2) and `query-mediator-injected` (#3). Under the legacy loader, it already missed `c04` (the same DTO criterion) in all 3 trials.
- The plugin variant meets everything in all 3 trials. The `query-mediator-injected` criterion (`c03`), missed 2 times out of 3 in the parity run, is found this time: it is variance in the review skill's first-pass selection, not an effect of the port, which changed neither prompt nor criterion.
- Judge: 6 calls, 0 retries, $0.44. Ablation: +17 pts of criteria, +0.25 score, +$1.02.
