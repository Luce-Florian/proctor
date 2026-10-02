# Extending

Add an agent, a sandbox, a grader or a reporter by **adding a file** that implements a port, then registering it. No `switch` on an agent or sandbox name in `core/`.

| Add | Where | Register |
|---|---|---|
| an agent | `src/adapters/agents/<id>/`, which implements `AgentAdapter` (and if needed `prepare`, `sandboxAccess`, `details`) | one line in `agents` in `src/cli/registry.ts`; the factory receives `--auth`, `--out` and the env |
| a sandbox | `src/adapters/sandboxes/<id>/`, which implements `Sandbox`, with its `isolation` level and if needed `Workspace.wrap` | one line in `sandboxes`; `srt` stays the default, `defaultSandboxes` holds the exceptions |
| an auth profile | an entry in the agent's profiles, e.g. `CLAUDE_AUTH_PROFILES` in `claude-code/credentials.ts` | nothing: the factory passes its profiles to `resolveCredential` |
| a grader, a fixture | a function that returns a `Grader` (with `prepare(workspace)` if it compares to the state before the agent) / a `Fixture` | nothing: pass it to `.expect()` / `.fixture()` |
| a suite format | a `SuiteLoader` in `src/loaders/` | the `loaders` array in `src/loaders/index.ts` |
| a reporter | a `Reporter` class | the `reporters` list in `src/cli/run.ts` |
| a report format (`--report`, `--format`) | `write(report, path)` and `path(ctrfFile)` in `src/reporters/<format>.ts` | one line in `reportFormats` in `src/cli/registry.ts` |
| a file derived from the CTRF, outside the CLI | a `CtrfSink` `(report, ctrfFile) => written path`, like `markdownSummary`, `htmlReport` | `sinks` of the `CtrfReporter` |

- A grader specific to one agent is allowed, named as such: `noToolNamed("…", "mcp__claude_ai_")`.
- A new output fed by run events is a `Reporter` (`src/ports/reporter.ts`). A file derived from a CTRF is a `ReportFormat`: it also works on an archived run (`proctor report`).
- The conformance test: adding OpenCode produces no diff in `src/core/` or `src/ports/`.

See [Architecture](./architecture.md) for the layers and their import boundaries.
