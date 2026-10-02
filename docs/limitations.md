# Known limitations

- `api-key` profile: to be tested later.
- The token stays in the env of the `claude` process itself. The CLI strips it from its subprocesses, but a subprocess that read its parent's env (`/proc/<pid>/environ` on Linux) would see it. Under srt, the network limits exfiltration to Anthropic domains; the mask protects the reports, not the sandbox.
- The host's managed settings (`managed-settings.json`, `managed-mcp.json`, MDM policy) stay loaded: `--setting-sources` does not cover them. The probe spots an MCP server, a plugin or a `SessionStart` hook they add, not a permission or another hook.
- Under srt, the agent only reaches Anthropic domains, and only writes inside the trial. A suite opens a registry with `.allowDomains(...)` and a directory with `.allowWrite(...)`; a private feed also requires a credential, out of scope.
- Each `fileChanged` takes its own snapshot of the workspace; the judge reads its diff again on each trial. Negligible at current sizes.
- A legacy theme whose tool writes outside the trial or restores packages from a registry has no parity under srt: `dotnet` writes to `/tmp/.dotnet` and restores from NuGet, which the legacy format cannot declare. [Port such a theme](./legacy/porting.md) to `*.eval.ts`, with `.allowWrite("/tmp/.dotnet")` and `.allowDomains(...)`.
- A fixture (`git clone`) does not receive the interruption signal: Ctrl-C stops it through the terminal's process group, a `SIGTERM` sent to the harness alone lets it finish.
- Each trial clones the repo again and reinstalls the marketplace plugins: correct but slow, a cache per `(url, commit)` will come later.
- A `*.eval.ts` must be an ES module: see [Getting started](./getting-started.md#install).
