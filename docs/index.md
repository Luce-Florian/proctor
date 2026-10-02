---
layout: home

hero:
  name: proctor
  text: Evaluate coding agents
  tagline: Write suites in TypeScript, run every trial in its own sandbox, grade with deterministic checks or an LLM judge, and get CTRF reports.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Write an eval
      link: /writing-evals/
    - theme: alt
      text: GitHub
      link: https://github.com/Luce-Florian/proctor

features:
  - title: xUnit lifecycle
    details: beforeAll, beforeEach, act, assert, afterEach, afterAll. Cleanup always runs for what was set up.
    link: /writing-evals/lifecycle
  - title: One sandbox per trial
    details: srt by default. Temporary HOME, host home hidden, network limited to declared domains.
    link: /sandboxes
  - title: Deterministic graders and an LLM judge
    details: Regex, JSON path, files, tool calls, yes/no contracts. A judge with stable ids and bounded scores for the rest.
    link: /writing-evals/graders
  - title: CTRF reports and ablation
    details: One CTRF per run, markdown and HTML reports, deltas of each variant against the baseline.
    link: /running/reports
---

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
$ npx proctor run examples/hello.eval.ts --agent fake
Running hello: 2 trials (agent fake 0.0.0, sandbox fake, isolation none)
PASS  greets-world [baseline] #1 (3ms)
PASS  greets-world [polite] #1 (4ms)
2 trials: 2 passed, 0 failed, 0 other, 0 skipped
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.ctrf.json
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.summary.md
```

The core knows no agent: Claude Code is an adapter today, OpenCode is next.

| I want to | Read |
|---|---|
| write my first suite | [Getting started](./getting-started.md), then [Suites, variants, cases](./writing-evals/index.md) |
| grade an answer | [Graders](./writing-evals/graders.md), [LLM judge](./writing-evals/judge.md) |
| run a campaign against Claude Code | [CLI](./running/cli.md), [Claude Code](./agents/claude-code/index.md) |
| read the results | [Reports and ablation](./running/reports.md), [CTRF reference](./running/ctrf.md) |
| add an agent, a sandbox or a grader | [Architecture](./contributing/architecture.md), [Extending](./contributing/extending.md) |
