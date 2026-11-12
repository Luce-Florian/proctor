# Claude Code : plugins

```ts
import { regex, suite } from "@fluce/proctor"

export default suite("plugins")
  .variant("baseline", (v) => v.prompt("/code-review medium eval-pr"))
  .variant("by-name", (v) => v.plugins("sdlc").prompt("/sdlc:review eval-pr"))
  .variant("by-path", (v) => v.plugins("/absolute/path/to/sdlc").prompt("/sdlc:review eval-pr"))
  .variant("from-marketplace", (v) => v.plugins("caveman@JuliusBrussee/caveman").prompt("/code-review medium eval-pr"))
  .case("smoke", (c) => c.expect(regex("answers", /\S/)))
```

L'adaptateur définit la syntaxe de `.plugins(...)` : le cœur transporte des chaînes opaques.

| Référence dans `.plugins(...)` | Ce que fait `prepare`, hors de la sandbox de l'agent |
|---|---|
| `/absolute/path/to/plugin` | le copie dans `<sandbox home>/.proctor/plugins/`, puis `--plugin-dir` sur la copie |
| un nom nu, par exemple `sdlc` | le premier `<--plugin-root>/sdlc` ; sans racine ou s'il est introuvable, une erreur qui dit où il a cherché |
| `<plugin>@<marketplace source>`, par exemple `caveman@JuliusBrussee/caveman` | `claude plugin marketplace add` et `install --scope user` dans le `CLAUDE_CONFIG_DIR` de la sandbox, sans identifiant |

- Rien n'est écrit dans `~/.claude` : c'est ce qui remplace les `initialize.sh` et `cleanup.sh` du banc historique.
- `prepare` est une capacité optionnelle du port `AgentAdapter` : le cœur l'appelle après les fixtures, sans savoir ce qu'est un plugin.
- `pluginSha` (sha256 des fichiers des plugins sous forme de répertoire et des ids installés) va dans le CTRF de chaque essai.
- Chaque essai réinstalle les plugins de marketplace : correct mais lent, voir [Limitations connues](../../limitations.md).

## Serveurs MCP d'un plugin

`--strict-mcp-config` ne démarre jamais les serveurs MCP qu'un plugin déclare, dans son `.mcp.json` ou dans les `mcpServers` de son `plugin.json`, en ligne ou comme chemin(s) de tels fichiers (vérifié sur `2.1.286`).

| Plugins chargés qui déclarent un serveur du nom du stub | Nom du stub MCP dans la session | Ses outils |
|---|---|---|
| aucun | `pgsql` | `mcp__pgsql__<tool>` |
| un, `dbtools` | `plugin:dbtools:pgsql` | `mcp__plugin_dbtools_pgsql__<tool>`, les noms qu'attendent les skills du plugin |
| deux | — | l'exécution s'arrête : `mcpStub "pgsql": plugins "dbtools" and "dba" both declare this server; load only one` |
