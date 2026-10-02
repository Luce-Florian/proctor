# Getting started

## Install

```sh
npm i -D @fluce/proctor              # Node >= 22.12
npx proctor run <file> --agent <id>
```

- A `*.eval.ts` imports `@fluce/proctor` like any installed dependency: it lives in a project that installs the package.
- It must load as an ES module: under a `package.json` with `"type": "module"`, or named `*.eval.mts`. Elsewhere, tsx compiles it to CommonJS and Node refuses to load it (`Cannot require() ES Module … in a cycle`).
- Typecheck it with that project's `tsc`.

## A first run, without an LLM

The `fake` agent and sandbox run a suite end to end with no credential and no network. From a clone of this repo:

```console
$ npm ci
$ npx proctor run examples/hello.eval.ts --agent fake
Running hello: 2 trials (agent fake 0.0.0, sandbox fake, isolation none)
PASS  greets-world [baseline] #1 (3ms)
PASS  greets-world [polite] #1 (4ms)
2 trials: 2 passed, 0 failed, 0 other, 0 skipped
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.ctrf.json
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.summary.md
```

`examples/hello.eval.ts` is the suite shown on the [home page](./index.md).

## A first run against Claude Code

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…   # claude setup-token; never the keychain nor ~/.claude
npx proctor run suites/isolation-probe.eval.ts --agent claude-code            # srt sandbox by default
npx proctor run path/to/review.eval.ts --agent claude-code --case <case-id> --repeat 3 -j 3
```

- `suites/isolation-probe.eval.ts` checks that the sandbox holds: see [Isolation probe](./agents/claude-code/isolation-probe.md).
- The `srt` sandbox needs `rg` on macOS, and `bwrap`, `socat` and `rg` on Linux: see [Sandboxes](./sandboxes.md).

## Next

- [Suites, variants, cases](./writing-evals/index.md): the authoring API.
- [Graders](./writing-evals/graders.md): what checks an answer.
- [CLI](./running/cli.md): every flag and exit code.
