# Porter un thème en `*.eval.ts`

| Banc bash | `*.eval.ts` |
|---|---|
| `cases/<id>.json` | `.case(id, ...)` ; `description` et `context` (la phrase partagée par les variantes) |
| `prompt`, un objet par variante | le `.prompt((c) => …)` de chaque variante, qui ne change que la ligne d'invocation |
| l'`effort` du cas | une table `EFFORT` dans le fichier, lue par les prompts : `CaseContext` ne porte que `id` et `context` |
| `repo`, `diff_file`, `diff_apply`, `overlay_dir` | `gitRepo(url).at(sha).applyDiff(url).overlay(url)`, chemins en `new URL(…, import.meta.url)` |
| `expected.criteria`, `[principal]`, `[leurre]` | `judge().criterion(id, text, { principal })`, `.decoy(id, text)` : des ids descriptifs au lieu de `c01`… |
| `variants/*/settings.json` `{"model": …}` | `.model(id)` : le `--settings` redondant disparaît |
| `variants/*/plugins` | `.plugins(<absolute path>)`, résolu depuis le fichier : aucun `--plugin-root` à passer |

```ts
import { fileURLToPath } from "node:url"
import { gitRepo, judge, suite } from "@fluce/proctor"

const EFFORT: Record<string, string> = { "list-beta-waitlist-registrations": "medium" }
const plugin = fileURLToPath(new URL("../marketplace/plugins/sdlc", import.meta.url))

export default suite("review")
  .variant("baseline", (v) => v.model("claude-sonnet-5").prompt((c) => `/code-review ${EFFORT[c.id] ?? "medium"} eval-pr\n\n${c.context}`))
  .variant("with-sdlc", (v) =>
    v
      .model("claude-sonnet-5")
      .plugins(plugin)
      .prompt((c) => `/sdlc:review eval-pr --effort ${EFFORT[c.id] ?? "medium"}\n\n${c.context}`),
  )
  .case("list-beta-waitlist-registrations", (c) =>
    c
      .context("Review the pull request.")
      .fixture(gitRepo("git@github.com:org/repo.git").at("5fb0133").applyDiff(new URL("./diffs/x.diff", import.meta.url)))
      .expect(
        judge()
          .model("claude-sonnet-5")
          .diff(new URL("./diffs/x.diff", import.meta.url))
          .criterion("date-filter-inverted", "Flags the inverted date filter", { principal: true })
          .decoy("async-suffix", "No finding objects to the Async suffix"),
      ),
  )
```

- La parité se vérifie hors ligne : chargez les deux définitions (loader historique, `*.eval.ts`) et comparez-les. Sur le premier thème porté, un thème de code review, elles ont donné des prompts identiques à l'octet près, les mêmes textes de critères dans le même ordre, les mêmes principal et leurres, la même fixture, le même modèle, les mêmes permissions et le même timeout.
- Le fichier porté importe `@fluce/proctor` comme toute dépendance installée : voir [Démarrer](../getting-started.md#installation).
- Une exécution d'un thème porté : [2026-10-02 : thème porté](../campaigns/2026-10-02-ported-theme.md).
