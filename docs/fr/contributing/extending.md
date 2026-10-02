# Extension

Ajoutez un agent, une sandbox, un évaluateur ou un reporter en **ajoutant un fichier** qui implémente un port, puis en l'enregistrant. Aucun `switch` sur un nom d'agent ou de sandbox dans `core/`.

| Ajouter | Où | Enregistrer |
|---|---|---|
| un agent | `src/adapters/agents/<id>/`, qui implémente `AgentAdapter` (et si besoin `prepare`, `sandboxAccess`, `details`) | une ligne dans `agents` de `src/cli/registry.ts` ; la factory reçoit `--auth`, `--out` et l'env |
| une sandbox | `src/adapters/sandboxes/<id>/`, qui implémente `Sandbox`, avec son niveau d'`isolation` et si besoin `Workspace.wrap` | une ligne dans `sandboxes` ; `srt` reste la valeur par défaut, `defaultSandboxes` porte les exceptions |
| un profil d'authentification | une entrée dans les profils de l'agent, par exemple `CLAUDE_AUTH_PROFILES` dans `claude-code/credentials.ts` | rien : la factory passe ses profils à `resolveCredential` |
| un évaluateur, une fixture | une fonction qui renvoie un `Grader` (avec `prepare(workspace)` s'il compare à l'état d'avant l'agent) / une `Fixture` | rien : passez-le à `.expect()` / `.fixture()` |
| un format de suite | un `SuiteLoader` dans `src/loaders/` | le tableau `loaders` de `src/loaders/index.ts` |
| un reporter | une classe `Reporter` | la liste `reporters` de `src/cli/run.ts` |
| un format de rapport (`--report`, `--format`) | `write(report, path)` et `path(ctrfFile)` dans `src/reporters/<format>.ts` | une ligne dans `reportFormats` de `src/cli/registry.ts` |
| un fichier dérivé du CTRF, hors de la CLI | un `CtrfSink` `(report, ctrfFile) => written path`, comme `markdownSummary`, `htmlReport` | les `sinks` du `CtrfReporter` |

- Un évaluateur propre à un agent est permis, nommé comme tel : `noToolNamed("…", "mcp__claude_ai_")`.
- Une nouvelle sortie alimentée par les événements de l'exécution est un `Reporter` (`src/ports/reporter.ts`). Un fichier dérivé d'un CTRF est un `ReportFormat` : il fonctionne aussi sur une exécution archivée (`proctor report`).
- Le test de conformité : ajouter OpenCode ne produit aucun diff dans `src/core/` ni dans `src/ports/`.

Voir [Architecture](./architecture.md) pour les couches et leurs frontières d'import.
