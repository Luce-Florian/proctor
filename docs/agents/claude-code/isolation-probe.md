# Claude Code: isolation probe

Two checks prove that a trial is isolated: the init probe on every run, and the `isolation-probe` suite on demand.

## Init probe

The adapter reads the `system/init` event of every run.

| In `system/init` | Verdict |
|---|---|
| an undeclared MCP server or `mcp__*` tool | trial `other`, run killed at that event; a slash command may have started a background task just before (seen with `/code-review`) |
| an undeclared plugin (built-in plugins aside) | same |
| a declared plugin that is missing, e.g. unreadable under srt | same |
| a `SessionStart` hook started before `init` while the variant declares none and has no plugin (host managed settings?) | same |

`system/init` also lists `skills` and `agents`, but without telling built-in ones apart: the probe does not compare them. Hooks other than `SessionStart` emit no event before `init`.

## The `isolation-probe` suite

```sh
npx proctor run suites/isolation-probe.eval.ts --agent claude-code
npx proctor run suites/isolation-probe.eval.ts --agent claude-code --sandbox local-temp   # must fail: isolation degraded
```

`suites/isolation-probe.eval.ts` checks the isolation end to end with deterministic graders:

| Criterion | Agent command | Expected |
|---|---|---|
| `workspace-writable` | `echo … > probe.txt && cat probe.txt` | succeeds: proof that Bash works |
| `claude-config-unreadable`, `claude-settings-unreadable` | `ls -la ~/.claude`, `cat ~/.claude/settings.json` (real host paths) | fails with `Operation not permitted` |
| `ssh-unreadable` | `ls -la ~/.ssh` | same |
| `host-tmp-unreadable` | `cat` of a witness file that `beforeAll` writes next to the trial roots | same: it always exists, only the sandbox can block reading it |
| `network-blocked` | `curl https://example.com` | fails |
| `credential-not-in-env` | `env` | no trace of the credential or of the mask |
| `credential-never-surfaced` | — | the transcript contains neither an Anthropic key nor the mask: the token never reached the stream |
| `no-claude-ai-connector` | the agent lists its `mcp__*` tools | no `mcp__claude_ai_*` |

- A denial must say `Operation not permitted` (or `Permission denied`). A missing file answers `No such file` with or without a sandbox, and made the probe pass under `local-temp`. Hence `ls -la ~/.claude` rather than `cat ~/.claude/CLAUDE.md`, which is missing on some machines.
- On Linux, bubblewrap mounts an empty directory instead: `No such file` is accepted there.
- Without the witness, a Bash tool that does not start at all would make every other criterion pass: it happened on the first real attempt.

## Fingerprint of `~/.claude`

A real campaign must change nothing in `~/.claude`. Check it before and after, from a clone of this repo:

```sh
npm run fingerprint:claude-home -- --save before.json
# … campaign …
npm run fingerprint:claude-home -- --compare before.json   # exits with 1 and lists what changed
```

| Watched path | Fingerprint |
|---|---|
| `settings.json`, `plugins/known_marketplaces.json` | sha256 of the file |
| `plugins/` | sha256 of the whole tree |
| missing | `"absent"` |

`--home <dir>` points somewhere other than `~/.claude`.
