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
