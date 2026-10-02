# Campagnes de validation

De vraies exécutions qui valident le harnais contre un vrai agent : isolation, parité avec le banc bash historique, stabilité du juge. Ce sont des campagnes manuelles, pas des tests de `npm test` : elles exigent un identifiant, le réseau, et elles coûtent de l'argent.

| Campagne | Ce qu'elle valide |
|---|---|
| [2026-09-30 : isolation et parité](./2026-09-30-isolation-parity.md) | la sonde d'isolation sous `srt` et `local-temp` ; la parité avec le banc bash sur un thème de code review et des thèmes historiques |
| [2026-09-30 : juge](./2026-09-30-judge.md) | la stabilité de `judge()` sur 3 rejugements, les thèmes oui/non sans juge, le rapport HTML |
| [2026-10-02 : thème porté](./2026-10-02-ported-theme.md) | un thème porté en `*.eval.ts` comparé au loader historique |

## Lancer une campagne

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…                       # claude setup-token
npm run fingerprint:claude-home -- --save before.json
npx proctor run suites/isolation-probe.eval.ts --agent claude-code
npx proctor run path/to/review.eval.ts --agent claude-code --repeat 3 -j 3 --report markdown,html
npm run fingerprint:claude-home -- --compare before.json
```

- Épinglez un id de modèle exact pour chaque variante et pour le juge : voir [Épingler les modèles](../writing-evals/index.md#epingler-les-modeles).
- Vérifiez que `~/.claude` n'a pas changé : voir [Empreinte de `~/.claude`](../agents/claude-code/isolation-probe.md#empreinte-de-claude).
- `results/` reste ignoré par git : une exécution est un artefact, pas une source.

## Ajouter une campagne

Ajoutez une page `campaigns/<date>-<topic>.md` avec la date, la version de la CLI, le profil d'authentification, la sandbox, les modèles, les commandes et les résultats. Ajoutez sa traduction française dans `fr/campaigns/<date>-<topic>.md` : `test/docs.test.ts` l'exige. Ajoutez les deux au tableau ci-dessus, et à `sections` dans `docs/.vitepress/config.mts` avec un titre dans chaque langue.
