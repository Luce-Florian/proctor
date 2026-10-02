# CLI

```sh
npx proctor run examples/hello.eval.ts --agent fake
npx proctor run path/to/review.eval.ts --agent claude-code --case <case-id> --repeat 3 -j 3 --report markdown,html
npx proctor report results/<suite>/<runId>.ctrf.json --format html
npx proctor list path/to/review.eval.ts
```

## `proctor run <file | theme>`

Runs a `*.eval.ts`, or a theme in the [legacy bash bench format](../legacy/loader.md) (a directory with `cases/` and `variants/`). Writes `<out>/<suite>/<runId>.ctrf.json` and, next to it, the `--report` files.

| Option | Effect |
|---|---|
| `--repeat <n>` | trials per case × variant (default 1) |
| `-j, --concurrency <n>` | trials in parallel (default 1); the report keeps the matrix order |
| `--case <id>` / `--variant <name>` | filters the matrix; repeatable or comma-separated (`--case a,b`), before or after `<file>` |
| `--agent <id>` | `claude-code` or `fake` |
| `--sandbox <id>` | `srt` by default (isolation `full`); `local-temp` on request (isolation `degraded`, with a warning); `fake` by default with `--agent fake` |
| `--auth <profile>` | forces the auth profile; default: the first credential found in the environment (only `oauth` is validated) |
| `--plugin-root <dir>` | directory searched for a bare name in `.plugins("sdlc")`; repeatable, the first one that contains `<dir>/sdlc` wins |
| `--out <dir>` | results directory (default `results`); `stream-json` transcripts go to `<out>/transcripts/` |
| `--judge-agent <id>` | the agent that judges, whatever `--agent` is: `claude-code` by default, `fake` with `--agent fake`; its own adapter and its own sandbox |
| `--judge-model <id>` | default model of the judge; a `judge().model(...)` in the suite wins |
| `--baseline <variant>` | reference variant of the ablation (default `baseline`) |
| `--report <formats>` | files derived from the CTRF: `markdown` (default), `html`; repeatable or comma-separated |

## `proctor report <ctrf.json>`

```sh
proctor report <ctrf.json> [--format html] [-o <file>] [--baseline <variant>]
```

- Regenerates a report from a CTRF. Default output: `<runId>.summary.md`, or `<runId>.report.html`, next to the CTRF.
- `--baseline` recomputes the ablation against another variant.
- A CTRF whose displayed fields have the wrong type is rejected.

## `proctor list <file>`

Lists variants and cases without running anything.

## Interruption

| Signal | Effect |
|---|---|
| 1st `Ctrl-C` (or `SIGTERM`) | running trials stop, cleanups and `afterAll` run, the partial report is written (trials `other`, exit code 2) |
| 2nd `Ctrl-C` | the agents' process groups are killed, exit `130` |

## Exit codes

| Exit code | When |
|---|---|
| `0` | everything is `passed` or `skipped` |
| `1` | at least one `failed` (eval failure) |
| `2` | at least one `other` (infra, timeout), a failed `afterAll`, or a usage error; takes precedence over `1` |
