# Claude Code: auth

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…   # claude setup-token
```

| Profile | Variable | Status |
|---|---|---|
| `oauth` | `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) | validated |
| `api-key` | `ANTHROPIC_API_KEY` | to be tested later: `--auth api-key` exits with 2 and a message |

- Without a credential: `No credential for claude-code: run \`claude setup-token\` and export the token as CLAUDE_CODE_OAUTH_TOKEN (profile oauth).`, exit code 2.
- The credential goes through a single variable, added by the adapter: the sandbox env never contains the host's credentials.
- Profile and variable go into `results.environment.extra.agent.details`, never the value.
- A rejected credential prints `claude refused the credential CLAUDE_CODE_OAUTH_TOKEN (profile oauth): … Fix: run \`claude setup-token\`…`, not the CLI's `/login` advice.

## Where the token could leak

| Where | What prevents it |
|---|---|
| env of Bash, hooks, stdio MCP servers | CLI `2.1.280` strips it on its own, checked live (`env`, `SessionStart` and `PreToolUse` hooks, MCP); the probe checks it again (`credential-not-in-env`) |
| transcript, `toolCalls[].output`, final text, judge prompt, CTRF, summary | each line of the stream is masked (`[redacted by proctor]`) **before** it is written or parsed: the credential value and any Anthropic key (`src/adapters/redact.ts`) |
| a grader's `why` | tool-call graders only give counts, never a tool's output |

`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` is **not** set. On `2.1.280` it forces the permission mode to `default` (checked via `system/init.permissionMode`), which breaks `full` and `workspace-write`, hence the probe and the whole legacy loader. Keeping it would require an `--allowedTools` list per profile, which would change the measured behavior.

The token still stays in the env of the `claude` process itself: see [Known limitations](../../limitations.md).
