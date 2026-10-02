---
layout: home

hero:
  name: proctor
  text: Évaluer les agents de code
  tagline: Écrivez vos suites en TypeScript, exécutez chaque essai dans sa propre sandbox, évaluez par des contrôles déterministes ou un juge LLM, et obtenez des rapports CTRF.
  actions:
    - theme: brand
      text: Démarrer
      link: /fr/getting-started
    - theme: alt
      text: Écrire une eval
      link: /fr/writing-evals/
    - theme: alt
      text: GitHub
      link: https://github.com/Luce-Florian/proctor

features:
  - title: Cycle de vie xUnit
    details: beforeAll, beforeEach, act, assert, afterEach, afterAll. Le nettoyage s'exécute toujours pour ce qui a été mis en place.
    link: /fr/writing-evals/lifecycle
  - title: Une sandbox par essai
    details: srt par défaut. HOME temporaire, home de l'hôte masqué, réseau limité aux domaines déclarés.
    link: /fr/sandboxes
  - title: Évaluateurs déterministes et juge LLM
    details: Regex, chemin JSON, fichiers, appels d'outils, contrats oui/non. Un juge à ids stables et scores bornés pour le reste.
    link: /fr/writing-evals/graders
  - title: Rapports CTRF et ablation
    details: Un CTRF par exécution, rapports markdown et HTML, écarts de chaque variante par rapport à la baseline.
    link: /fr/running/reports
---

## Exemple

```ts
// examples/hello.eval.ts
import { directory, regex, suite } from "@fluce/proctor"

export default suite("hello")
  .variant("baseline", (v) => v.prompt((c) => `Say hello to ${c.context}`))
  .variant("polite", (v) => v.prompt((c) => `Say hello politely to ${c.context}`))
  .case("greets-world", (c) =>
    c
      .description("The agent greets the world")
      .context("world")
      .fixture(directory(new URL("./hello", import.meta.url)))
      .expect(regex("says-hello", /hello/i))
      .expect(regex("names-world", /world/i))
      .timeout("1m"),
  )
```

```console
$ npx proctor run examples/hello.eval.ts --agent fake
Running hello: 2 trials (agent fake 0.0.0, sandbox fake, isolation none)
PASS  greets-world [baseline] #1 (3ms)
PASS  greets-world [polite] #1 (4ms)
2 trials: 2 passed, 0 failed, 0 other, 0 skipped
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.ctrf.json
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.summary.md
```

Le cœur ne connaît aucun agent : Claude Code est aujourd'hui un adaptateur, OpenCode sera le suivant.

| Je veux | Lire |
|---|---|
| écrire ma première suite | [Démarrer](./getting-started.md), puis [Suites, variantes, cas](./writing-evals/index.md) |
| évaluer une réponse | [Évaluateurs](./writing-evals/graders.md), [Juge LLM](./writing-evals/judge.md) |
| lancer une campagne contre Claude Code | [CLI](./running/cli.md), [Claude Code](./agents/claude-code/index.md) |
| lire les résultats | [Rapports et ablation](./running/reports.md), [Référence CTRF](./running/ctrf.md) |
| ajouter un agent, une sandbox ou un évaluateur | [Architecture](./contributing/architecture.md), [Extension](./contributing/extending.md) |
