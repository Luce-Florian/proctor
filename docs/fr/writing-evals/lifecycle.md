# Cycle de vie

Les hooks suivent le modèle mise en place / démontage commun aux frameworks de test comme JUnit, pytest, Jest ou Vitest : ce qui est mis en place avant est démonté après, même quand une étape échoue.

## Hooks

| proctor | Déclaré sur | S'exécute | JUnit 5 | pytest | Jest, Vitest |
|---|---|---|---|---|---|
| `.beforeAll(fn)` | suite | une fois, avant le premier essai | `@BeforeAll` | fixture `scope="session"` | `beforeAll` |
| `.fixture(f)` | cas | par essai, mise en place avant l'agent, démontée après | — | fixture de fonction avec `yield` | — |
| `.beforeEach(fn)` | variante | par essai, après les fixtures et `agent.prepare` | `@BeforeEach` | fixture `autouse`, avant `yield` | `beforeEach` |
| act : `agent.run` | — | par essai, dans la sandbox | corps du test | corps du test | corps de `it` / `test` |
| assert : `.expect(grader)` | cas | par essai, après act | assertions | `assert` | `expect` |
| `.afterEach(fn)` | variante | par essai, après l'évaluation, même si `beforeEach` lève une erreur | `@AfterEach` | fixture `autouse`, après `yield` | `afterEach` |
| `.afterAll(fn)` | suite | une fois, après le dernier essai, même si `beforeAll` lève une erreur | `@AfterAll` | fixture `scope="session"`, après `yield` | `afterAll` |

```ts
import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { regex, suite } from "@fluce/proctor"

export default suite("lifecycle")
  .beforeAll(() => console.log("once, before the first trial"))
  .afterAll(() => console.log("once, after the last trial"))
  .variant("baseline", (v) =>
    v
      .prompt("Say hello")
      .beforeEach(({ workspace }) => appendFile(join(workspace.cwd, "NOTES.md"), "Be polite.\n"))
      .afterEach(({ caseId, variant, trial }) => console.log(`${caseId} [${variant}] #${trial} done`)),
  )
  .case("greets", (c) => c.expect(regex("says-hello", /hello/i)))
```

| Hook | Reçoit | Peut renvoyer |
|---|---|---|
| `beforeAll`, `afterAll` | rien | `void` ou une promesse |
| `beforeEach`, `afterEach` | `{ caseId, variant, trial, workspace }` : `trial` commence à 1, `workspace` porte `cwd`, `home`, `env` | `void` ou une promesse |

- Plusieurs hooks du même type s'exécutent dans l'ordre de déclaration, `afterEach` et `afterAll` compris.
- Un `beforeAll`, `beforeEach` ou `afterAll` qui lève une erreur saute les hooks du même type déclarés après lui ; chaque `afterEach` s'exécute, même si un autre a levé une erreur.
- Il n'y a pas de hook de cas : un cas met en place son état par une fixture, qui renvoie son propre démontage (voir [Fixtures](./fixtures.md)).
- Les hooks s'exécutent hors de la sandbox de l'agent : voir [ce qui s'exécute où](#ce-qui-s-execute-ou).

## Exécution

Une exécution encadre ses essais entre `beforeAll` et `afterAll`, appelés une fois chacun.

```mermaid
flowchart LR
    BA[beforeAll] --> T["essais<br/>-j à la fois"] --> AA["afterAll<br/>toujours"]
    BA -. lève .-> X["aucun essai ne démarre<br/>tous other, skipped à part"] --> AA
```

## Essai

Chaque essai se met en place, agit, vérifie, puis se démonte. Chaque étape réussie empile son annulation ; la pile se déroule après assert, ou à la première erreur levée.

```mermaid
flowchart LR
    subgraph up["mise en place, dans l'ordre"]
        direction TB
        SC[sandbox.create] --> FS["fixtures.setup"] --> AP["agent.prepare<br/>plugins"] --> BE[beforeEach] --> GP["grader.prepare<br/>instantanés"] --> ACT["act<br/>agent.run + timeout"] --> AS["assert<br/>évaluateurs"]
    end
    subgraph down["démontage, en sens inverse"]
        direction TB
        AE[afterEach] --> AU["annulation de agent.prepare"] --> FT["fixtures.teardown<br/>LIFO"] --> SD[sandbox.destroy]
    end
    up -- "après assert,<br/>ou à la première erreur" --> down
    down --> ST{{statut}}
```

## Ce qui s'exécute où

| Étape | S'exécute | Pourquoi |
|---|---|---|
| fixtures (`gitRepo` : `git` avec l'env de l'hôte), `agent.prepare` (installation de plugins : env de la sandbox, aucun identifiant, réseau ouvert), hooks de suite et de variante, évaluateurs | **hors** de la sandbox de l'agent | ils ont besoin des identifiants git ou du réseau, et le harnais leur fait confiance ; rien de ce qu'écrit l'agent ne s'y exécute |
| `agent.run` | dans la sandbox | l'agent évalué n'est pas fiable |

## Ordre et nettoyage

- `afterEach` s'exécute dès que les fixtures sont en place et l'agent préparé, même si `beforeEach` lève une erreur.
- `sandbox.create` reçoit `access` : ce que l'agent (`sandboxAccess`) et la suite (`.allowDomains`, `.allowRead`, `.allowWrite`) doivent laisser passer.
- Les évaluateurs reçoivent le juge de l'exécution (`RunOptions.judge` : son agent, sa sandbox, son modèle par défaut), jamais l'agent évalué.
- `grader.prepare(workspace)`, optionnel : c'est là que `fileChanged` prend son instantané.
- Un reporter qui lève une erreur dans `onTrialEnd` n'arrête pas l'exécution : l'erreur va dans `suiteErrors`.
- Un `afterAll` en échec ne change aucun essai : il va dans `suiteErrors`, écrit dans le `results.extra` du CTRF et en bas du résumé.

## Timeouts et interruption

- Au timeout, le signal passé à l'agent est annulé et l'essai devient `other` (`agent run failed: timed out after 1m: raise the case .timeout(...)…`).
- Le nettoyage attend que l'agent s'arrête, 5 s au plus (`ABORT_GRACE_MS`), pour ne pas démonter un espace de travail dans lequel il écrit encore.
- Une interruption (`runSuite({ signal })`, Ctrl-C dans la CLI) suit le même chemin : l'agent, `prepare` et le juge reçoivent le signal, l'essai en cours devient `other` après ses nettoyages, les suivants ne démarrent pas.
- Une exécution d'agent en échec garde son transcript : `AgentRunError.transcriptPath` remonte dans `TrialResult.transcriptPath` et dans le `extra.transcript` du CTRF.
- Chaque commande lancée a son propre groupe de processus : à l'annulation, SIGTERM puis SIGKILL après 2 s ; à la sortie normale, ce qu'elle a laissé en arrière-plan est tué.

## Statuts

La première condition remplie, de haut en bas, décide du statut.

```mermaid
flowchart TD
    S{".skip() ?"} -->|oui| SK[skipped]
    S -->|non| E{"une erreur ?"}
    E -->|"oui : beforeAll, une étape,<br/>un nettoyage, timeout, Ctrl-C"| O1[other]
    E -->|non| F{"un évaluateur<br/>a échoué, ou un<br/>principal manqué ?"}
    F -->|oui| FA[failed]
    F -->|non| C{"un critère<br/>évalué ?"}
    C -->|oui| P[passed]
    C -->|non| O2["other<br/>rien n'a été évalué"]
```

| Statut | Quand |
|---|---|
| `passed` | tous les évaluateurs réussissent |
| `failed` | un évaluateur renvoie `passed: false`, ou un critère `principal` est manqué même si l'évaluateur dit `passed` ; le message liste les critères manqués |
| `other` | erreur d'infra : sandbox, fixture, `prepare`, hook, agent, sonde d'init, évaluateur qui lève une erreur, nettoyage, timeout, interruption, `beforeAll` ; ou rien n'a été évalué |
| `skipped` | `.skip()` ; aucune sandbox créée |
