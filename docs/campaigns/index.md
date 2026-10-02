# Validation campaigns

Real runs that validate the harness against a real agent: isolation, parity with the legacy bash bench, judge stability. They are manual campaigns, not `npm test` tests: they need a credential, the network, and they cost money.

| Campaign | What it validates |
|---|---|
| [2026-09-30: isolation and parity](./2026-09-30-isolation-parity.md) | the isolation probe under `srt` and `local-temp`; parity with the bash bench on a code-review theme and legacy themes |
| [2026-09-30: judge](./2026-09-30-judge.md) | stability of `judge()` over 3 rejudges, yes/no themes without a judge, the HTML report |
| [2026-10-02: ported theme](./2026-10-02-ported-theme.md) | a theme ported to `*.eval.ts` against the legacy loader |

## Running a campaign

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…                       # claude setup-token
npm run fingerprint:claude-home -- --save before.json
npx proctor run suites/isolation-probe.eval.ts --agent claude-code
npx proctor run path/to/review.eval.ts --agent claude-code --repeat 3 -j 3 --report markdown,html
npm run fingerprint:claude-home -- --compare before.json
```

- Pin an exact model id for every variant and for the judge: see [Pinning models](../writing-evals/index.md#pinning-models).
- Check that `~/.claude` is unchanged: see [Fingerprint of `~/.claude`](../agents/claude-code/isolation-probe.md#fingerprint-of-claude).
- `results/` stays ignored by git: a run is an artifact, not a source.

## Adding a campaign

Add a page `campaigns/<date>-<topic>.md` with the date, the CLI version, the auth profile, the sandbox, the models, the commands and the results. Add it to the table above and to the sidebar in `docs/.vitepress/config.mts`, in English and in French.
