# Réponses oui/non

Trois niveaux évaluent une skill qui répond oui ou non : le verdict, la forme, puis le sens des lignes de raison.

```text
oui                            ← verdict, principal : verdictEquals(id, "yes" | ["no", "yes"])         gratuit
- Migration DDL sur outbox     ┐ forme : answerShape(id, yesNoContract()) : une raison par ligne,      gratuit
- Suppression de users.email   ┘ ni titre, ni confiance, ni recommandation, ≤ 500 caractères chacune
                                 sens des lignes : judge().criterion(...), gardé par                   un appel au juge
                                 .when(verdictIs("yes")) quand "non" est aussi valide
```

Voir les cas `migration` et `split-controller` dans [Évaluateurs](./graders.md) pour un exemple complet.

## `verdictEquals`

- Réussit quand la première ligne de la réponse (blancs autour, BOM et CRLF mis à part) est **exactement** le mot attendu : `oui`/`non` par défaut, sensible à la casse.
- `**Non.**`, `NON` ou un verdict en ligne 3 ne sont pas un verdict.
- Son critère est **principal**. Il ne contrôle que le verdict, pas la forme.

## `yesNoContract`

`yesNoContract()` lit la réponse comme `{ verdict, reasons }` (1re ligne, lignes suivantes), puis la valide avec zod :

| Réponse | `met` | `why` |
|---|---|---|
| `non` | ✓ | `"non" alone` |
| `oui\n- Migration DDL sur outbox` | ✓ | `"oui" then 1 reason line(s)` |
| `non\nStyle only.` | ✗ | `reasons: "non" must stand alone` |
| `oui` | ✗ | `reasons: "oui" must be followed by one line per reason` |
| `**Oui**\n- …`, `review: oui` | ✗ | `verdict: the first line must be "non" or "oui" alone` |
| `oui\n## Détails\n\nConfiance : haute` | ✗ | `reasons[0]: heading "## Détails"; reasons[1]: blank line ""; reasons[2]: confidence level …` |
| une ligne de plus de 500 caractères | ✗ | `reasons[0]: paragraph of 612 characters, at most 500 per reason line` |

- Titre : une ligne qui commence par `#` suivi d'un blanc (`#1234 migration` est une raison) ou qui finit par `:`.
- Confiance : une ligne qui **commence** par `confiance`/`niveau de confiance`/`confidence`, puces et `**` mis à part (`confiance: haute`, `- Confiance « moyenne »…`).
- Recommandation : une ligne qui commence par `Recommandation :` ou `Je/Nous recommande…`, `I/We recommend…`.
- Un mot au milieu d'une ligne ne compte pas : `- abaisse le seuil de confiance…`, `Tiers de confiance : …`, `Règle de recommandation de paiement modifiée` sont des raisons.

## Options

- Les valeurs par défaut sont propres à `/sdlc:check-if-need-humain-review` (mots et filtres en français, 500 caractères). Une autre skill oui/non surcharge `words` et `maxReasonLength` ; un autre format écrit son propre contrat.
- 500 caractères (`MAX_REASON_LENGTH`) : 9 lignes de raison sur 10 des exécutions bash enregistrées sont en dessous. Au-delà, la ligne explique ou enchaîne plusieurs patterns.
- `verdicts: ["no"]` restreint les verdicts bien formés : il signifie « la sortie est strictement `non` ».
- Un autre format = un autre contrat `{ parse, schema, describe? }`, sans toucher à `answerShape`.

## Conditionner le juge

- Un juge dont la garde `.when()` est fermée ne coûte aucun appel. Il renvoie une note réussie **sans critères** : voir [Non applicable](./graders.md#non-applicable). L'essai n'a alors pas de score : les agrégats disent sur combien d'essais évalués le score est moyenné (`0.75 ± 0.10 (2/4)`).
- Posez une garde sur ce qui rend les critères sans objet, pas sur le verdict attendu. Sur un cas qui attend `oui`, `.when(verdictIs("yes"))` laisserait un `non` erroné sans score. D'où `split-controller` dans [Évaluateurs](./graders.md), où `non` est valide.
- `verdictIs("yes")` suit la même règle stricte que `verdictEquals`. Toute fonction `(result) => boolean` fonctionne aussi.
