# Sandboxes

Each trial runs in its own sandbox. The CTRF and the summary header always say how isolated the run was.

```sh
npx proctor run path/to/review.eval.ts --agent claude-code                         # srt, isolation full
npx proctor run path/to/review.eval.ts --agent claude-code --sandbox local-temp    # isolation degraded, with a warning
```

| | `srt` (default) | `local-temp` |
|---|---|---|
| Isolation written in the report | `full` | `degraded`, plus a console warning |
| HOME, TMPDIR, `XDG_*` | temporary | temporary |
| Env | `PATH` without the entries under the host home, `LANG`, `LC_*`, `TERM`, `TZ`, `USER`, `LOGNAME` | same |
| Read | host home and temporary directories hidden, except the trial's workspace, home and TMPDIR, and the declared paths | the whole disk |
| Write | the trial's workspace, home and TMPDIR, `.allowWrite()` paths | the whole disk |
| Network | declared domains only | open |

`fake` (`src/testing/`) runs nothing: isolation `none`, the default with `--agent fake`.

## Checking the sandbox without a model

With a real sandbox, `--agent fake` runs one shell command through it, in the workspace, after the fixtures, the way an agent starts: the sandbox must start and the workspace must be writable. A dry run therefore checks the sandbox on the host, for example in a CI build, with no token and no cost.

```sh
npx proctor run examples/hello.eval.ts --agent fake --sandbox srt
```

When the check fails, the trial ends `other` with a message that starts with `The sandbox did not run a command in the workspace`, followed by the sandbox's own error. A suite with `judge()` also ends `other` under the fake judge, by design: a CI job tells the two apart by this message in the CTRF.

## The `srt` policy

The policy of a trial (`<trial root>/srt-settings.json`, outside the writable directories) denies broadly, then opens narrowly: in srt, `allowRead` wins over `denyRead`.

```text
host disk                                  what a trial sees under srt
├── ~  (host home)                         hidden: ~/.ssh, ~/.aws, ~/.claude…
├── /tmp, /var/folders, /Volumes           hidden
├── os.tmpdir()                            hidden: parent of every trial root
│   ├── ae-review-basel-a1b2c3/            this trial's root, not re-allowed itself
│   │   ├── srt-settings.json              hidden: the policy, read by srt outside the sandbox
│   │   ├── work/                          writable: cwd, the workspace
│   │   ├── home/                          writable: HOME, XDG_*, .claude/, .proctor/plugins/
│   │   └── tmp/                           writable: TMPDIR, CLAUDE_CODE_TMPDIR
│   └── ae-review-with--d4e5f6/            hidden: another trial (-j 2)
├── directory of the claude binary         readable (sandboxAccess)
├── .allowRead() / .allowWrite() paths     readable / writable
└── /usr, /opt, /etc…                      readable: binaries, libraries, certificates
```

| Rule | Paths | Why |
|---|---|---|
| `denyRead` | host home | `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.claude`… |
| `denyRead` | parent directory of the trial roots (`os.tmpdir()`, given path and real path) | a trial does not read another trial's root (`-j 2`) |
| `denyRead` | `/tmp`, `/private/tmp`, `/var/folders`, `/private/var/folders`, `/Volumes` (those that exist) | `/tmp/claude-<uid>` holds the outputs of the host's Claude sessions; mounted disks |
| `allowRead` | `<root>/work`, `<root>/home`, `<root>/tmp` | never the root itself: on Linux, srt binds a re-allowed directory back read-only after the writable binds, which would make the workspace read-only and stop bubblewrap at startup |
| `allowRead` | the `@anthropic-ai/sandbox-runtime` package | on Linux srt runs its seccomp filter from `vendor/seccomp`, inside the sandbox, and `node_modules` often sits under the hidden home |
| `allowRead` | directory of the agent binary, `.allowRead()`, `.allowWrite()` | what the agent and the suite declare |
| `allowWrite` | `<root>/work`, `<root>/home`, `<root>/tmp`, `.allowWrite()` | nothing else; srt adds stdio and `/tmp/claude`, unreadable here |
| `allowedDomains` | the model API for the profile, `.allowDomains()` | everything else is blocked by the srt proxy |
| env | `CLAUDE_CODE_TMPDIR=<root>/tmp` | srt gives the command `TMPDIR=$CLAUDE_CODE_TMPDIR`, otherwise `/tmp/claude`, shared and hidden |

- Domains come from the agent (`sandboxAccess`: the model API for the profile) and from the suite (`.allowDomains(...)`).

## Opening the sandbox from a suite

```ts
import { regex, suite } from "@fluce/proctor"

export default suite("dotnet")
  .allowDomains("api.nuget.org")
  .allowWrite("/tmp/.dotnet")
  .variant("baseline", (v) => v.permissions("full").prompt("Run dotnet test and report the result"))
  .case("tests-pass", (c) => c.expect(regex("passes", /passed/i)))
```

A private feed also requires a credential: out of scope.

## Requirements

- `srt` comes from the `@anthropic-ai/sandbox-runtime` dependency, not from a global install.
- It needs `rg` on macOS, and `bwrap`, `socat` and `rg` on Linux. Otherwise `create` fails and says what to install, or to pass `--sandbox local-temp`.
- `test/srt.integration.test.ts` runs the real `srt`, without an LLM or network: reading a fake home and another trial is denied, writing outside the workspace is denied, the workspace and `.allowWrite()` are writable. It is skipped, with a message, where srt does not run, except with `PROCTOR_REQUIRE_SRT=1`: CI sets it and installs `bubblewrap`, `socat` and `ripgrep`, so the policy is checked on Linux at every build.
