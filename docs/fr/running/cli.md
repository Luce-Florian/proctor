# CLI

```sh
npx proctor run examples/hello.eval.ts --agent fake
npx proctor run path/to/review.eval.ts --agent claude-code --case <case-id> --repeat 3 -j 3 --report markdown,html
npx proctor report results/<suite>/<runId>.ctrf.json --format html
npx proctor list path/to/review.eval.ts
```

## `proctor run <file | theme>`

Exécute un `*.eval.ts`, ou un thème au [format du banc bash historique](../legacy/loader.md) (un répertoire avec `cases/` et `variants/`). Écrit `<out>/<suite>/<runId>.ctrf.json` et, à côté, les fichiers de `--report`.

| Option | Effet |
|---|---|
| `--repeat <n>` | essais par cas × variante (1 par défaut) |
| `-j, --concurrency <n>` | essais en parallèle (1 par défaut) ; le rapport garde l'ordre de la matrice |
| `--case <id>` / `--variant <name>` | filtre la matrice ; répétable ou séparé par des virgules (`--case a,b`), avant ou après `<file>` |
| `--agent <id>` | `claude-code` ou `fake` |
| `--sandbox <id>` | `srt` par défaut (isolation `full`) ; `local-temp` sur demande (isolation `degraded`, avec un avertissement) ; `fake` par défaut avec `--agent fake` |
| `--auth <profile>` | force le profil d'authentification ; par défaut : le premier identifiant trouvé dans l'environnement (seul `oauth` est validé) |
| `--plugin-root <dir>` | répertoire où chercher un nom nu de `.plugins("sdlc")` ; répétable, le premier qui contient `<dir>/sdlc` l'emporte |
| `--out <dir>` | répertoire des résultats (`results` par défaut) ; les transcripts `stream-json` vont dans `<out>/transcripts/` |
| `--judge-agent <id>` | l'agent qui juge, quel que soit `--agent` : `claude-code` par défaut, `fake` avec `--agent fake` ; son propre adaptateur et sa propre sandbox |
| `--judge-model <id>` | modèle par défaut du juge ; un `judge().model(...)` dans la suite l'emporte |
| `--baseline <variant>` | variante de référence de l'ablation (`baseline` par défaut) |
| `--report <formats>` | fichiers dérivés du CTRF : `markdown` (par défaut), `html` ; répétable ou séparé par des virgules |

## `proctor report <ctrf.json>`

```sh
proctor report <ctrf.json> [--format html] [-o <file>] [--baseline <variant>]
```

- Régénère un rapport à partir d'un CTRF. Sortie par défaut : `<runId>.summary.md`, ou `<runId>.report.html`, à côté du CTRF.
- `--baseline` recalcule l'ablation par rapport à une autre variante.
- Un CTRF dont les champs affichés ont le mauvais type est refusé.

## `proctor list <file>`

Liste les variantes et les cas sans rien exécuter.

## Interruption

| Signal | Effet |
|---|---|
| 1er `Ctrl-C` (ou `SIGTERM`) | les essais en cours s'arrêtent, les nettoyages et `afterAll` s'exécutent, le rapport partiel est écrit (essais `other`, code de sortie 2) |
| 2e `Ctrl-C` | les groupes de processus des agents sont tués, sortie `130` |

## Codes de sortie

| Code de sortie | Quand |
|---|---|
| `0` | tout est `passed` ou `skipped` |
| `1` | au moins un `failed` (échec de l'eval) |
| `2` | au moins un `other` (infra, timeout), un `afterAll` en échec, ou une erreur d'usage ; prime sur `1` |
