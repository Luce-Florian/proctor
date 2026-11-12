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
- Le test de conformité : ajouter OpenCode ne produit aucun diff dans `src/core/`, `src/ports/` ni `src/adapters/mcp-stub/`.

## Les stubs MCP dans un nouvel agent

La façon dont un stub répond vit dans `src/ports/mcp-stub-rules.mjs` ; le programme du stub, sa configuration et son journal d'appels vivent dans `src/adapters/mcp-stub/`. Aucun ne connaît d'agent. Un adaptateur d'agent qui exécute `AgentRunInput.mcpStubs` ne fait que remplir ce tableau.

| Obligation | Comment |
|---|---|
| Déclarer chaque stub comme un serveur MCP stdio | `materializeStubs(input.mcpStubs, workspace)` dans `prepare`, puis chaque entrée `{ name, command, args }` dans la configuration MCP propre à l'agent |
| Ne charger que les serveurs déclarés | l'option propre à l'agent |
| Laisser tout niveau de permission appeler un stub sans approbation | la liste d'autorisations propre à l'agent : un stub n'a aucun effet de bord |
| Exécuter le stub dans la sandbox de l'essai | laisser l'agent le lancer ; `sandboxAccess(input)` ajoute `STUB_RUNTIME_DIR` à `readablePaths` quand `input.mcpStubs` n'est pas vide |
| Faire échouer un essai dont un stub n'a pas servi, marquer les appels auxquels un stub a répondu (`ToolCall.mcp`) | après l'exécution, `collectStubCalls(entries, workspace, toolCalls, parseToolName)`, où `parseToolName` lit `(stub, outil)` d'après le nommage propre à l'agent des outils MCP |

Voir [Architecture](./architecture.md) pour les couches et leurs frontières d'import.
