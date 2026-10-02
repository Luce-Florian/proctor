# Suites, variantes, cas

Une suite est une matrice : chaque cas s'exécute une fois par variante, `--repeat` fois.

```ts
import { gitRepo, judge, limits, suite } from "@fluce/proctor"

export default suite("review")
  .variant("baseline", (v) => v.prompt((c) => `/code-review medium eval-pr\n\n${c.context}`))
  .variant("with-sdlc", (v) =>
    v.plugins("sdlc").prompt((c) => `/sdlc:review eval-pr --spec eval-spec.md --effort medium\n\n${c.context}`),
  )
  .case("list-beta-waitlist-registrations", (c) =>
    c
      .fixture(
        gitRepo("git@github.com:org/repo.git")
          .at("5fb0133")
          .applyDiff(new URL("./diffs/x.diff", import.meta.url))
          .overlay(new URL("./overlays/x", import.meta.url)),
      )
      .expect(
        judge()
          .model("claude-sonnet-5")
          .diff(new URL("./diffs/x.diff", import.meta.url))
          .criterion("date-filter-inverted", "Inverted date filter", { principal: true })
          .decoy("decoy-async-suffix", "Does not flag the Async suffix"),
      )
      .expect(limits().maxCostUsd(3).maxDuration("10m")),
  )
```

`.plugins("sdlc")` est un nom nu : il nécessite `--plugin-root <dir>` pointant vers le dossier qui contient le plugin `sdlc` (voir [Claude Code : plugins](../agents/claude-code/plugins.md)).

## Builders

| Builder | Méthodes |
|---|---|
| `suite(name)` | `.variant(name, v => …)`, `.case(id, c => …)`, `.beforeAll(fn)`, `.afterAll(fn)`, `.allowDomains(...)`, `.allowRead(...)`, `.allowWrite(...)`, `.toDefinition()` |
| variante `v` | `.prompt(text \| c => …)`, `.plugins(...)`, `.mcpServers({…})`, `.model(id)`, `.permissions(p)`, `.settings({…})`, `.beforeEach(fn)`, `.afterEach(fn)` |
| cas `c` | `.description(t)`, `.context(t)`, `.fixture(f)`, `.expect(grader)`, `.timeout("10m")`, `.skip(reason)` |

- Chaque méthode renvoie un nouveau builder : un builder partiel peut être partagé entre suites.
- Les types se restreignent : une variante sans `.prompt()` ou un cas sans `.expect()` ni `.skip()` ne compile pas (`VariantBuilder<"without-prompt">` n'est pas assignable à `VariantBuilder<"with-prompt">`). La validation zod au chargement reste le filet de sécurité pour les suites écrites en JS.
- Valeurs par défaut sûres : permissions `readonly`, timeout `10m`.
- Une définition invalide lève une `SuiteDefinitionError` qui liste chaque problème et dit quoi ajouter, par exemple `case "x" > graders: Case has no expectation: add .expect(...)`.

## Briques

| Brique | Disponible |
|---|---|
| Fixtures | `directory(url, { into? })`, `gitRepo(url)` : voir [Fixtures](./fixtures.md) |
| Évaluateurs | déterministes et juge : voir [Évaluateurs](./graders.md) |
| Agents | `claude-code`, `fake` (`src/testing/`) |
| Sandboxes | `srt`, `local-temp`, `fake` : voir [Sandboxes](../sandboxes.md) |

## Épingler les modèles

- Une variante d'une vraie campagne épingle un id de modèle exact avec `.model(id)`, pas un alias. L'adaptateur écrit le modèle résolu dans le CTRF.
- Le juge aussi : épinglez `judge().model(...)` ou passez `--judge-model`. Sans l'un ni l'autre, l'exécution ne s'arrête pas : la CLI avertit et le CTRF écrit `judgeModel: "unpinned (<resolved model>)"`, pour qu'un score non comparable soit visible.
