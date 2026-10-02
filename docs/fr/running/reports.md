# Rapports et ablation

Une exécution écrit un seul CTRF, puis en dérive chaque rapport. `proctor report` les régénère à partir d'un CTRF archivé.

| Où | Contenu |
|---|---|
| `results.extra.aggregates.groups[]` | par cas × variante : essais par statut, critères et leurres (**part atteinte par essai**, dans `[0, 1]`, moyenne ± écart type, affichée en %), principal atteint, score (avec son `n`), coût, durée, appels et coût du juge ; critères, score, coût et durée moyennés sur les seuls essais évalués (`passed`, `failed`) ; la part d'un essai a ses propres critères pour dénominateur, une garde fermée n'enlève aucun point ; principal atteint compté sur les essais qui ont un principal (sinon « — ») |
| `results.extra.ablation[]` | Δ (variante − `--baseline`) des critères (en points de part), du score, du coût, du taux de réussite ; le Δ de taux de réussite est absent (« — ») quand un côté n'a aucun essai évalué, au lieu d'un faux ±100 pts |
| `<runId>.summary.md` | essais, agrégats, ligne du juge, ablation |
| `<runId>.report.html` (`--report html`, ou `proctor report <ctrf> --format html`) | page autonome : résumé et barre de statut, variantes et carte d'ablation, carte critères × essais (principal, leurre), essais, onglet CTRF brut ; clair et sombre ; seule requête : Google Fonts, optionnelle |

- Écart type d'échantillon (n − 1).
- Les rapports recalculent toujours les agrégats à partir de `tests[]` (`aggregatesOf`) : un CTRF antérieur aux agrégats fonctionne, et un `results.extra` modifié n'est jamais affiché tel quel.
- Les champs du CTRF sont listés dans la [Référence CTRF](./ctrf.md).

## Rejuger

Rejugez une exécution archivée sans relancer l'agent (transcripts `claude-code`). La baseline archivée ne compte que les critères du juge (`grader: "judge"`) :

```sh
CLAUDE_CODE_OAUTH_TOKEN=… npm run rejudge -- results/<suite>/<runId>.ctrf.json path/to/suite.eval.ts --times 3 [--test "baseline] #1"]
```

`scripts/rejudge.ts` est un outil de campagne manuel, lancé depuis un clone de ce dépôt.
