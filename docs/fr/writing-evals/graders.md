# Évaluateurs

Déterministes partout où c'est possible, un juge LLM pour le reste.

```ts
import { answerShape, fileUnchanged, judge, limits, suite, toolUsed, verdictEquals, verdictIs, yesNoContract } from "@fluce/proctor"

export default suite("check")
  .variant("baseline", (v) => v.prompt("/sdlc:check-if-need-humain-review …"))
  .case("migration", (c) =>
    c
      .expect(verdictEquals("verdict", "yes"))                          // 1. the verdict, principal
      .expect(answerShape("format", yesNoContract()))                   // 2. "oui", then one line per pattern (zod)
      .expect(judge()                                                   // 3. the meaning of the lines
        .model("claude-sonnet-5")
        .criterion("ddl", "A line identifies a DDL migration", { principal: true }))
      .expect(toolUsed("reads-diff", { tool: "Read", input: /eval-pr\.diff/ }))
      .expect(fileUnchanged("readonly", /^src\//))
      .expect(limits().maxCostUsd(3).maxDuration("10m")),
  )
  .case("split-controller", (c) =>
    c
      .expect(verdictEquals("verdict", ["no", "yes"]))                  // both verdicts are valid
      .expect(answerShape("format", yesNoContract()))
      .expect(judge()                                                   // only "oui" has lines to judge
        .model("claude-sonnet-5")
        .criterion("routes", "No line claims that the routes change", { principal: true })
        .when(verdictIs("yes"))),
  )
  .case("review", (c) =>
    c.expect(
      judge()
        .model("claude-sonnet-5")
        .diff(new URL("./diffs/x.diff", import.meta.url))
        .criterion("date-filter-inverted", "Flags the inverted date filter", { principal: true })
        .decoy("async-suffix", "No finding objects to the Async suffix"),
    ),
  )
```

## Référence

| Évaluateur | Réussit quand | Lit |
|---|---|---|
| `regex(id, /pattern/)` | le texte final correspond | `finalText` |
| `jsonPath(id, "$.a[0].b", expected, { file? })` | la valeur au chemin est égale, correspond à une regex ou satisfait un prédicat ; pas de JSON = critère manqué | `finalText` ou un fichier de l'espace de travail (liens symboliques et chemins hors de l'espace de travail refusés) |
| `fileChanged(id, path \| /pattern/)`, `fileUnchanged(...)` | au moins un / aucun fichier correspondant ajouté, modifié ou supprimé | instantané sha256 pris juste avant l'agent (`grader.prepare`), `.git/` exclu ; **aucun `git` n'est lancé** : un dépôt écrit par l'agent pourrait exécuter ses hooks ou ses filtres sur l'hôte |
| `toolUsed(id, { tool, input? }, { min?, max? })` | entre `min` (1 par défaut) et `max` appels correspondants | `toolCalls` |
| `toolCallsFail(id, { tool, input }, { evidence? })` | l'agent a tenté l'appel correspondant et chaque tentative a échoué ; ne pas le tenter échoue aussi ; avec `evidence`, chaque échec doit aussi dire pourquoi (un fichier absent n'est pas une lecture refusée) | `toolCalls` |
| `toolCallsSucceed(id, { tool, input })` | l'agent a tenté l'appel correspondant et chaque tentative a réussi : le contrôle positif qui distingue un blocage de la sandbox d'un outil qui ne fonctionne pas | `toolCalls` |
| `toolOutputsExclude(id, { tool, input }, /pattern/)` | l'agent a lancé l'appel correspondant et aucune de ses sorties ne correspond, par exemple aucun identifiant dans ce qu'a affiché `env` | `toolCalls` |
| `noToolNamed(id, prefix)` | aucun outil dont le nom commence par `prefix` n'a été appelé, ni nommé dans le texte final, par exemple `"mcp__claude_ai_"` ; `escapeRegExp` fait correspondre un chemin littéral dans un `input` | `toolCalls`, `finalText` |
| `transcriptExcludes(id, /pattern/)` | aucune ligne du transcript brut ne correspond, par exemple un identifiant ou le masque ; pas de transcript = échec | le transcript |
| `verdictEquals(id, "yes" \| ["no", "yes"], { words? })` | la première ligne de la réponse est **exactement** le mot attendu : voir [Réponses oui/non](./yes-no-answers.md) | `finalText` |
| `answerShape(id, contract)` | `contract.parse(text)` satisfait `contract.schema` (zod) ; sinon `why` liste les problèmes zod, `path: message` ; un `parse` qui lève une erreur = critère manqué | `finalText` |
| `yesNoContract({ words?, verdicts?, maxReasonLength? })` | contrat pour `answerShape` : voir [Réponses oui/non](./yes-no-answers.md) | — |
| `limits().maxCostUsd(3).maxDuration("10m")` | coût et durée **de l'agent évalué** sous les plafonds ; coût non remonté = critère manqué | `costUsd`, `durationMs` |
| `judge()` | score ≥ `.minScore()` (3 par défaut) et principal atteint ; avec `.when(predicate)`, seulement si le prédicat est vrai sur l'exécution de l'agent : voir [Juge LLM](./judge.md) | la réponse de l'agent juge |

- Les évaluateurs d'appels d'outils et de transcript ne donnent que des comptes dans leur `why`, jamais la sortie d'un outil ni une ligne : un identifiant n'atteint jamais un rapport par leur biais.
- `judge()` et `limits()` sans critère ni plafond ne sont pas des évaluateurs : `.expect(judge())` ne compile pas.
- Un verdict porte `text` (le critère tel que l'auteur l'a écrit) : les rapports l'affichent à côté de l'id.

## Statuts

Voir l'arbre de décision dans [Cycle de vie](./lifecycle.md#statuts).

## Non applicable

Un évaluateur dit « non applicable » avec `passed: true, criteria: []`.

- Ses critères sont absents de l'essai (CTRF, agrégats) : ni atteints ni manqués. Le rapport HTML affiche « — » (non évalué).
- Un essai dont tous les évaluateurs ont laissé leurs critères de côté est `other` (« Nothing was graded ») : un succès qui n'a rien contrôlé n'en est pas un. Gardez un critère principal hors de toute garde, par exemple `verdictEquals`.
