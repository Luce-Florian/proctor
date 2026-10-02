# Lifecycle

A run wraps its trials between `beforeAll` and `afterAll`, each called once.

```mermaid
flowchart LR
    BA[beforeAll] --> T["trials<br/>-j at a time"] --> AA["afterAll<br/>always"]
    BA -. throws .-> X["no trial starts<br/>all other, skipped aside"] --> AA
```

Each trial follows the xUnit order. Each step that succeeds stacks its undo; the stack unwinds after assert, or at the first throw.

```mermaid
flowchart LR
    subgraph up["set up, in order"]
        direction TB
        SC[sandbox.create] --> FS["fixtures.setup"] --> AP["agent.prepare<br/>plugins"] --> BE[beforeEach] --> GP["grader.prepare<br/>snapshots"] --> ACT["act<br/>agent.run + timeout"] --> AS["assert<br/>graders"]
    end
    subgraph down["tear down, in reverse"]
        direction TB
        AE[afterEach] --> AU["undo of agent.prepare"] --> FT["fixtures.teardown<br/>LIFO"] --> SD[sandbox.destroy]
    end
    up -- "after assert,<br/>or at the first throw" --> down
    down --> ST{{status}}
```

## What runs where

| Step | Runs | Why |
|---|---|---|
| fixtures (`gitRepo`: `git` with the host env), `agent.prepare` (plugin install: sandbox env, no credential, open network), suite and variant hooks, graders | **outside** the agent's sandbox | they need git credentials or the network, and the harness trusts them; nothing the agent writes runs there |
| `agent.run` | inside the sandbox | the evaluated agent is untrusted |

## Order and cleanup

- `afterEach` runs as soon as the fixtures are set up and the agent prepared, even if `beforeEach` throws.
- `sandbox.create` receives `access`: what the agent (`sandboxAccess`) and the suite (`.allowDomains`, `.allowRead`, `.allowWrite`) must let through.
- Graders receive the run's judge (`RunOptions.judge`: its agent, its sandbox, its default model), never the evaluated agent.
- `grader.prepare(workspace)`, optional: `fileChanged` takes its snapshot there.
- A reporter that throws in `onTrialEnd` does not stop the run: the error goes into `suiteErrors`.
- A failed `afterAll` changes no trial: it goes into `suiteErrors`, written to the CTRF's `results.extra` and at the bottom of the summary.

## Timeouts and interruption

- On timeout, the signal passed to the agent is aborted and the trial becomes `other` (`agent run failed: timed out after 1m: raise the case .timeout(...)…`).
- Cleanup waits for the agent to stop, 5 s at most (`ABORT_GRACE_MS`), so as not to tear down a workspace it is still writing to.
- An interruption (`runSuite({ signal })`, Ctrl-C in the CLI) follows the same path: the agent, `prepare` and the judge receive the signal, the running trial becomes `other` after its cleanups, the next ones do not start.
- A failed agent run keeps its transcript: `AgentRunError.transcriptPath` goes up into `TrialResult.transcriptPath` and the CTRF's `extra.transcript`.
- Each launched command has its own process group: on abort, SIGTERM then SIGKILL after 2 s; on normal exit, whatever it left in the background is killed.

## Statuses

The first condition met, top down, decides the status.

```mermaid
flowchart TD
    S{".skip()?"} -->|yes| SK[skipped]
    S -->|no| E{"an error?"}
    E -->|"yes: beforeAll, a step,<br/>a cleanup, timeout, Ctrl-C"| O1[other]
    E -->|no| F{"a grader failed,<br/>or a principal<br/>missed?"}
    F -->|yes| FA[failed]
    F -->|no| C{"a criterion<br/>graded?"}
    C -->|yes| P[passed]
    C -->|no| O2["other<br/>nothing was graded"]
```

| Status | When |
|---|---|
| `passed` | all graders pass |
| `failed` | a grader returns `passed: false`, or a `principal` criterion is missed even if the grader says `passed`; the message lists the missed criteria |
| `other` | infra error: sandbox, fixture, `prepare`, hook, agent, init probe, grader that throws, cleanup, timeout, interruption, `beforeAll`; or nothing was graded |
| `skipped` | `.skip()`; no sandbox created |
