# Loader historique

`proctor run <theme-dir>` lit un thème au format du banc bash historique sans le modifier :

```sh
npx proctor run <legacy-theme> --agent claude-code -j 2
```

| Banc bash | Harnais |
|---|---|
| `cases/*.json` : `repo`, `diff_file`, `diff_apply`, `overlay_dir` | fixture `gitRepo(...)` |
| `prompt`, une chaîne ou un objet par variante | le prompt de la variante ; clé absente : essai `other` |
| `expected.criteria` d'un cas oui/non | `verdictEquals`, `answerShape`, juge sur `oui` : voir [thèmes oui/non](#themes-oui-non-en-trois-niveaux) |
| `expected.criteria` des autres cas | `judge()` avec le modèle `claude-sonnet-5`, ids `c01`…, `[principal]` et `[leurre]` détectés, `diff_file` donné au juge |
| `variants/*/settings.json` | réglages, `__REPO_ROOT__` (deux niveaux au-dessus du répertoire du thème) résolu, modèle épinglé depuis `settings.model` ; sous srt, un répertoire référencé devient lisible tel quel, un script via son répertoire, jamais un parent (au niveau de la suite) |
| `variants/*/plugins` | plugins sous forme de répertoire `<repo>/marketplace/plugins/<name>`, résolus en chemins absolus au chargement |
| `initialize.sh` : `claude plugin marketplace add` + `install` | plugins de marketplace installés dans le home de la sandbox |
| `cleanup.sh` : `uninstall`, `marketplace remove` | rien : le home de la sandbox est jeté |
| toute autre ligne de ces scripts | refusée au chargement, avec le conseil de porter la variante en `*.eval.ts` |
| `--permission-mode bypassPermissions` | permissions `full` |
| pas de timeout | `30m` |

## Thèmes oui/non en trois niveaux

Le loader historique reconnaît le contrat oui/non d'un cas à ses critères, sans modifier les fichiers du thème (`src/loaders/legacy-verdicts.ts`). Les textes de critères ci-dessous sont le format de données historique, reconnu littéralement :

| Critère historique | Rôle | Évalué par |
|---|---|---|
| `Rend le verdict "non"…` | verdict, **principal** | `verdictEquals(id, verdict)` |
| `La sortie est strictement "non"…`, `La sortie est "oui" suivi uniquement d'une ligne par pattern…`, `Aucun texte hors du contrat…` | forme | `answerShape(id, yesNoContract({ verdicts }))`, avec les verdicts que le cas accepte |
| `S'il répond "non", la sortie est … ; s'il répond "oui" …, la sortie est …` | forme, les deux verdicts acceptés | idem |
| `Une des lignes identifie une migration…`, `S'il répond "oui", aucune ligne ne prétend…` | sens des lignes de raison | `judge()` `claude-sonnet-5`, le diff du cas, critère **principal**, `.minScore(1)` ; `.when(verdictIs("yes"))` seulement si `non` est aussi accepté |

| Cas | Évaluateurs | Appels au juge |
|---|---|---|
| un cas qui attend `non` (verdict + forme) | `c01`, `c02` | 0 |
| un cas qui attend `oui` | `c01`, `c02`, `judge` (`c03`) | 1, quelle que soit la réponse : un `non` erroné est jugé (`c03` manqué), comme dans le banc bash |
| un cas qui accepte les deux verdicts | `verdict` (ajouté, principal), `c01`, `c03`, `judge` (`c02`) | 1 si l'agent répond `oui`, 0 sur `non` |

- Les ids historiques `c01`… et les textes sont conservés. Le runtime du juge est créé une fois par exécution, dès qu'un cas de l'exécution a un juge (même si aucune réponse ne l'appelle : son identifiant est alors exigé et `environment.judge` rapporté). L'**appel** au juge, lui, n'a lieu que si sa garde est ouverte.
- Réussi = tous les critères évalués atteints : chaque critère sémantique est principal et le score ne compte pas (`minScore(1)`), donc `oui\nxyz` échoue sur `c03`, comme dans le banc bash, qui jugeait tout.
- Garde fermée (un `non` valide sur un cas qui accepte les deux) : `c02` est absent de l'essai, ni atteint ni manqué. Les agrégats rapportent la part des critères atteints par essai, donc un `non` parfait (3 critères) et un `oui` parfait (4) comptent tous deux pour 100 %.
- Différences voulues avec le `judge.sh` historique, qui évaluait tout avec le juge : les comptes de critères diffèrent, pas le verdict passed/failed. Sur un cas qui accepte les deux verdicts, `c01` et `c03` sont deux `answerShape` identiques (deux critères de forme historiques) : un défaut de forme compte deux fois. Sous `non`, `c02`, « tenu » par vacuité par le banc bash, est omis.
- Un cas sans critère de verdict reconnu garde le juge pour tous ses critères.

Un thème historique dont l'outil écrit hors de l'essai ou restaure des paquets depuis un registre n'a pas de parité sous srt : voir [Limitations connues](../limitations.md), et [portez-le](./porting.md).
