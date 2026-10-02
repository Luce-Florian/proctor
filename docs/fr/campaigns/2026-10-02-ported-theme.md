# 2026-10-02 : un thème porté en `*.eval.ts`

Exécutée le 2026-10-02 : CLI `2.1.280`, profil `oauth`, sandbox `srt`, agent et juge `claude-sonnet-5`, plugin de review épinglé à un commit fixe.

```sh
npx proctor run path/to/review.eval.ts --agent claude-code --repeat 3 -j 3 --report markdown,html
```

| Variante | Critères par essai | Moyenne | Loader historique (exécution de parité) | Différence | Principal | Leurres | Coût moyen |
|---|---|---|---|---|---|---|---|
| baseline | 10, 10, 10 | 10.0 / 12 | 9.7 / 12 | +0.3 | 3 / 3 | 2 / 2 | $0.30 (exécution de parité : $0.32) |
| avec le plugin de review | 12, 12, 12 | 12.0 / 12 | 11.3 / 12 | +0.7 | 3 / 3 | 2 / 2 | $1.32 (exécution de parité : $1.24) |

- Critère d'acceptation tenu pour ce thème : moins d'un critère d'écart en moyenne avec le loader historique, dans chaque variante.
- baseline manque `dtos-in-controller-file` dans les 3 essais ; aussi `findings-on-diff-files-only` (#1, #2) et `query-mediator-injected` (#3). Sous le loader historique, il manquait déjà `c04` (le même critère sur les DTO) dans les 3 essais.
- La variante avec plugin atteint tout dans les 3 essais. Le critère `query-mediator-injected` (`c03`), manqué 2 fois sur 3 dans l'exécution de parité, est trouvé cette fois : c'est de la variance dans la sélection de premier passage de la skill de review, pas un effet du portage, qui n'a changé ni prompt ni critère.
- Juge : 6 appels, 0 relance, $0.44. Ablation : +17 pts de critères, +0.25 de score, +$1.02.
