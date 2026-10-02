# 2026-09-30: isolation and parity

Run on 2026-09-30: CLI `2.1.280`, profile `oauth`, sandbox `srt` unless noted, model `claude-sonnet-5`. Besides this repo's isolation probe, they ran themes of a private bench in the legacy bash format.

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…                       # claude setup-token
npm run fingerprint:claude-home -- --save before.json
npx proctor run suites/isolation-probe.eval.ts --agent claude-code
npx proctor run suites/isolation-probe.eval.ts --agent claude-code --sandbox local-temp   # must fail: isolation degraded
npx proctor run <review-theme> --agent claude-code --case <case-id> --repeat 3 -j 3
npx proctor run <legacy-theme> --agent claude-code -j 2
npm run fingerprint:claude-home -- --compare before.json
```

## Isolation probe

| Sandbox | Status | Criteria not met | Cost |
|---|---|---|---|
| `srt` | `passed` | none: `~/.claude`, `~/.ssh` and the temporary directory witness denied (`Operation not permitted`), `curl` blocked (`CONNECT tunnel failed, response 403`), no token in `env` or in the transcript, no MCP or plugin loaded | $0.11 |
| `local-temp` | `failed`, isolation `degraded` | `claude-config-unreadable`, `claude-settings-unreadable`, `ssh-unreadable`, `host-tmp-unreadable`, `network-blocked` | $0.12 |

Rerun after a review of the isolation, with a hardened srt policy and probe. The first rerun failed under srt on `cat ~/.claude/CLAUDE.md`: the file was missing on that machine, and `No such file` is no proof of a denial, hence `ls -la ~/.claude`. Fingerprint of `~/.claude` unchanged, no Anthropic key in the results.

The first attempt under srt revealed two problems, fixed since: the Bash tool did not start (hence `CLAUDE_CODE_TMPDIR` and the `workspace-writable` witness), and the model refused the `ls ~/.ssh` of a prompt that was too terse.

## Parity with the bash bench: a code-review theme, one case, `--repeat 3`

| Variant | Criteria per trial | Mean | Principal | Decoys | Mean cost | Bash bench |
|---|---|---|---|---|---|---|
| baseline | 11, 10, 8 | 9.7 / 12 | 3 / 3 | 2 / 2 | $0.32 | 9 / 12, $0.30 (+7%) |
| with the review plugin | 11, 12, 11 | 11.3 / 12 | 3 / 3 | 2 / 2 | $1.24 | 11 to 12 / 12, mean $1.47 over 7 runs (−16%) |

The three parity acceptance criteria hold: baseline between 8 and 10 on average, the plugin variant ≥ 11 with the principal in all 3 trials, costs within ±30%.

## Legacy themes (a subset, for budget)

| Theme, case | Variants | Harness | Bash | Reading |
|---|---|---|---|---|
| a plugin theme, one case | baseline / with the plugin | score 4 / 5 | 4 / 5 | parity; the plugin is installed from its marketplace into the sandbox home |
| a yes/no theme, a case that expects `non` | baseline / with two plugins | 5 / 2 | 2 / 5 | inverted on a single run: an unstable shape criterion, a single rerun proves nothing |
| a theme that runs `dotnet test` | both | score 1 | 2 / 5 | no parity under srt: `dotnet` writes to `/tmp/.dotnet/shm` (denied) and the NuGet restore leaves the allowed network |
| a theme that runs `dotnet build` | both | `other` | — | srt socket paths truncated at 104 bytes (`EADDRINUSE`); fixed since with a short trial root, checked outside the campaign |

Total cost of the campaigns: about $8.8, judge included.

The fingerprint of `~/.claude` (`settings.json`, `plugins/`, `known_marketplaces.json`) is identical before and after all campaigns.
