# Référence CTRF

Chaque exécution écrit un document [CTRF](https://ctrf.io) : `<out>/<suite>/<runId>.ctrf.json`.

```text
<out>/<suite>/<runId>.ctrf.json
├── reportFormat "CTRF", specVersion "1.0.0", reportId, runId, timestamp, generatedBy
└── results
    ├── tool          {name "proctor", version}
    ├── summary       {tests, passed, failed, other, skipped, pending, suites, start, stop, duration}
    ├── environment   {reportName, commit, branchName, osPlatform, osRelease}
    │   └── extra     {agent {id, version, details}, sandbox {id}, isolation, judge?}
    ├── tests[]       un par essai, dans l'ordre de la matrice
    │   ├── name "case [variant] #n", testId, executionId, suite [suite, case, variant]
    │   ├── status, duration, start, stop, message?, trace?, labels {case, variant, trial}
    │   └── extra     {criteria[], score, costUsd, model, pluginSha, tokens, turns,
    │                  agentDurationMs, transcript, judgeCalls, judgeCostUsd, judgeTokens,
    │                  judgeModel, judgeTranscripts, judgeTruncated}
    └── extra         {aggregates {baseline, groups[], judge}, ablation[], suiteErrors?}
```

| Décision | Choix | Pourquoi |
|---|---|---|
| Schéma de référence | [`ctrf.schema.json`@`66e823c`](https://github.com/ctrf-io/ctrf/blob/66e823ca2c9e1f54bf8b387adda0b7e0c7610538/schema/ctrf.schema.json), vendoré tel quel dans `test/fixtures/ctrf/` | chaque test valide les rapports produits avec ajv, sans réseau |
| `specVersion` | `"1.0.0"` | chaîne SemVer exigée par le schéma, la valeur des exemples officiels |
| `tests[].suite` | tableau `[suite, case, variant]` | le schéma le définit comme la hiérarchie, du sommet au parent direct, `minItems: 1` |
| `tests[].name` | `case [variant] #n` | lisible dans les outils CTRF |
| `testId` / `executionId` | `suite/case/variant` / `…#n` | id stable du test logique, id unique de l'essai |
| `tests[].labels` | `case`, `variant`, `trial` | filtrables dans les outils CTRF |
| `tests[].extra` | `criteria[id, met, why, principal, decoy, grader]`, `score`, `costUsd`, `model` (résolu par l'agent), `pluginSha`, `tokens` (cache compris), `turns`, `agentDurationMs`, `transcript` | les critères sont identifiés par `id`, jamais par index |
| Un seul document par exécution | `CtrfReporter` construit le CTRF une fois, l'écrit, puis le passe à ses sinks (`<runId>.summary.md`) | le markdown provient exactement du JSON écrit ; deux exécutions ne s'écrasent jamais |
| `results.extra.aggregates` | par cas × variante : essais par statut, critères, leurres, principal, score, coût (moyenne ± écart type), durée, appels et coût du juge ; `judge` : total de l'exécution | calculé à partir des seuls `tests`, donc aussi sur un CTRF archivé |
| `results.extra.ablation` | par cas et variante ≠ `--baseline` : Δ critères, Δ score, Δ coût, Δ taux de réussite | l'écart par rapport à la baseline de `claude plugin eval` |
| `tests[].extra.judge*` | `judgeCalls` (relances comprises), `judgeCostUsd`, `judgeTokens`, `judgeModel`, `judgeTranscripts`, `judgeTruncated` (`{diffBytes, answerBytes}` omis du prompt) | le coût du juge n'est jamais mêlé au `costUsd` de l'agent |
| `environment.extra.judge` | `{ id, version, details, sandbox, model? }` | le rapport dit qui a jugé |
| `results.extra.suiteErrors` | présent seulement si `afterAll` a échoué | une erreur de suite sans essai pour la porter |
| `results.environment` | `reportName`, `commit`, `branchName` (omis sur un HEAD détaché), `osPlatform`, `osRelease`, `extra.{agent: {id, version, details}, sandbox, isolation}` | le schéma interdit les champs libres hors de `extra` ; `details` porte le profil d'authentification |
| `environment.extra.isolation` | `none` (fake), `degraded`, `full` ; repris dans l'en-tête du résumé | un rapport dit toujours à quel point l'exécution était isolée |
