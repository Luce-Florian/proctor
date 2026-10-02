# proctor

[![CI](https://github.com/Luce-Florian/proctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Luce-Florian/proctor/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@fluce/proctor)](https://www.npmjs.com/package/@fluce/proctor)
[![Docs](https://img.shields.io/badge/docs-luce--florian.github.io%2Fproctor-blue)](https://luce-florian.github.io/proctor/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Evaluate coding agents and the plugins, skills and tools you give them: write suites in TypeScript, run every trial in its own sandbox, grade with deterministic checks or an LLM judge, and get [CTRF](https://ctrf.io) reports.

**Documentation: [luce-florian.github.io/proctor](https://luce-florian.github.io/proctor/)** ([français](https://luce-florian.github.io/proctor/fr/))

## Example

```ts
// examples/hello.eval.ts
import { directory, regex, suite } from "@fluce/proctor"

export default suite("hello")
  .variant("baseline", (v) => v.prompt((c) => `Say hello to ${c.context}`))
  .variant("polite", (v) => v.prompt((c) => `Say hello politely to ${c.context}`))
  .case("greets-world", (c) =>
    c
      .description("The agent greets the world")
      .context("world")
      .fixture(directory(new URL("./hello", import.meta.url)))
      .expect(regex("says-hello", /hello/i))
      .expect(regex("names-world", /world/i))
      .timeout("1m"),
  )
```

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

The example runs from a clone of this repo, hence `npm ci`.

## Install

```sh
npm i -D @fluce/proctor              # Node >= 22.12
npx proctor run <file> --agent <id>
```

A `*.eval.ts` must load as an ES module: under a `package.json` with `"type": "module"`, or named `*.eval.mts`.

## Run against Claude Code

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…   # claude setup-token
npx proctor run suites/isolation-probe.eval.ts --agent claude-code            # srt sandbox by default
npx proctor run path/to/review.eval.ts --agent claude-code --repeat 3 -j 3 --report markdown,html
```

## What you get

| Feature | Docs |
|---|---|
| Fluent, typed authoring API: suites, variants, cases, fixtures | [Writing evals](https://luce-florian.github.io/proctor/writing-evals/) |
| Deterministic graders, yes/no contracts, an LLM judge with stable ids and bounded scores | [Graders](https://luce-florian.github.io/proctor/writing-evals/graders), [LLM judge](https://luce-florian.github.io/proctor/writing-evals/judge) |
| xUnit lifecycle: cleanup always runs, interruptions write a partial report | [Lifecycle](https://luce-florian.github.io/proctor/writing-evals/lifecycle) |
| One sandbox per trial (`srt`), credential masked everywhere, isolation probe | [Sandboxes](https://luce-florian.github.io/proctor/sandboxes), [Claude Code](https://luce-florian.github.io/proctor/agents/claude-code/) |
| CTRF, markdown and HTML reports, ablation against a baseline | [Reports](https://luce-florian.github.io/proctor/running/reports), [CLI](https://luce-florian.github.io/proctor/running/cli) |
| Loader for the legacy bash bench format | [Legacy loader](https://luce-florian.github.io/proctor/legacy/loader) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The architecture and the conventions are in [CLAUDE.md](CLAUDE.md) and on the [architecture page](https://luce-florian.github.io/proctor/contributing/architecture).

## License

[MIT](LICENSE)
