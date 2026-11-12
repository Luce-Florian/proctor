# Claude Code: plugins

```ts
import { regex, suite } from "@fluce/proctor"

export default suite("plugins")
  .variant("baseline", (v) => v.prompt("/code-review medium eval-pr"))
  .variant("by-name", (v) => v.plugins("sdlc").prompt("/sdlc:review eval-pr"))
  .variant("by-path", (v) => v.plugins("/absolute/path/to/sdlc").prompt("/sdlc:review eval-pr"))
  .variant("from-marketplace", (v) => v.plugins("caveman@JuliusBrussee/caveman").prompt("/code-review medium eval-pr"))
  .case("smoke", (c) => c.expect(regex("answers", /\S/)))
```

The adapter defines the syntax of `.plugins(...)`: the core carries opaque strings.

| Reference in `.plugins(...)` | What `prepare` does, outside the agent's sandbox |
|---|---|
| `/absolute/path/to/plugin` | copies it into `<sandbox home>/.proctor/plugins/`, then `--plugin-dir` on the copy |
| a bare name, e.g. `sdlc` | the first `<--plugin-root>/sdlc`; without a root or if not found, an error that says where it looked |
| `<plugin>@<marketplace source>`, e.g. `caveman@JuliusBrussee/caveman` | `claude plugin marketplace add` and `install --scope user` in the sandbox's `CLAUDE_CONFIG_DIR`, without a credential |

- Nothing is written to `~/.claude`: this is what replaces the legacy bench's `initialize.sh` and `cleanup.sh`.
- `prepare` is an optional capability of the `AgentAdapter` port: the core calls it after the fixtures, without knowing what a plugin is.
- `pluginSha` (sha256 of the files of directory plugins and of installed ids) goes into the CTRF of each trial.
- Each trial reinstalls the marketplace plugins: correct but slow, see [Known limitations](../../limitations.md).

## MCP servers of a plugin

`--strict-mcp-config` never starts the MCP servers a plugin declares, in its `.mcp.json` or in the `mcpServers` of its `plugin.json`, inline or as the path(s) of such files (checked on `2.1.286`).

| Loaded plugins declaring a server of the stub's name | Name of the MCP stub in the session | Its tools |
|---|---|---|
| none | `pgsql` | `mcp__pgsql__<tool>` |
| one, `dbtools` | `plugin:dbtools:pgsql` | `mcp__plugin_dbtools_pgsql__<tool>`, the names the plugin's skills expect |
| two | — | the run stops: `mcpStub "pgsql": plugins "dbtools" and "dba" both declare this server; load only one` |
