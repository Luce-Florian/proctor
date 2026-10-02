# Sandboxes

Chaque essai s'exécute dans sa propre sandbox (bac à sable). Le CTRF et l'en-tête du résumé disent toujours à quel point l'exécution était isolée.

```sh
npx proctor run path/to/review.eval.ts --agent claude-code                         # srt, isolation full
npx proctor run path/to/review.eval.ts --agent claude-code --sandbox local-temp    # isolation degraded, with a warning
```

| | `srt` (par défaut) | `local-temp` |
|---|---|---|
| Isolation écrite dans le rapport | `full` | `degraded`, plus un avertissement dans la console |
| HOME, TMPDIR, `XDG_*` | temporaires | temporaires |
| Env | `PATH` sans les entrées sous le home de l'hôte, `LANG`, `LC_*`, `TERM`, `TZ`, `USER` | idem |
| Lecture | home de l'hôte et répertoires temporaires masqués, sauf la racine de l'essai et les chemins déclarés | tout le disque |
| Écriture | l'espace de travail, le home et le TMPDIR de l'essai, les chemins de `.allowWrite()` | tout le disque |
| Réseau | domaines déclarés uniquement | ouvert |

`fake` (`src/testing/`) n'exécute rien : isolation `none`, la valeur par défaut avec `--agent fake`.

## La politique `srt`

La politique d'un essai (`<trial root>/srt-settings.json`, hors des répertoires accessibles en écriture) refuse largement, puis ouvre étroitement : dans srt, `allowRead` l'emporte sur `denyRead`.

| Règle | Chemins | Pourquoi |
|---|---|---|
| `denyRead` | home de l'hôte | `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.claude`… |
| `denyRead` | répertoire parent des racines d'essai (`os.tmpdir()`, chemin donné et chemin réel) | un essai ne lit pas la racine d'un autre essai (`-j 2`) |
| `denyRead` | `/tmp`, `/private/tmp`, `/var/folders`, `/private/var/folders`, `/Volumes` (ceux qui existent) | `/tmp/claude-<uid>` contient les sorties des sessions Claude de l'hôte ; disques montés |
| `allowRead` | racine de l'essai | espace de travail, home, TMPDIR et fichier de politique |
| `allowRead` | répertoire du binaire de l'agent, `.allowRead()`, `.allowWrite()` | ce que déclarent l'agent et la suite |
| `allowWrite` | `<root>/work`, `<root>/home`, `<root>/tmp`, `.allowWrite()` | rien d'autre ; srt ajoute stdio et `/tmp/claude`, illisible ici |
| `allowedDomains` | l'API du modèle pour le profil, `.allowDomains()` | tout le reste est bloqué par le proxy srt |
| env | `CLAUDE_CODE_TMPDIR=<root>/tmp` | srt donne à la commande `TMPDIR=$CLAUDE_CODE_TMPDIR`, sinon `/tmp/claude`, partagé et masqué |

- Le reste du disque (`/usr`, `/opt`, `/etc`…) reste lisible : binaires, bibliothèques et certificats dont `claude`, `node` et les outils ont besoin.
- Les domaines viennent de l'agent (`sandboxAccess` : l'API du modèle pour le profil) et de la suite (`.allowDomains(...)`).

## Ouvrir la sandbox depuis une suite

```ts
import { regex, suite } from "@fluce/proctor"

export default suite("dotnet")
  .allowDomains("api.nuget.org")
  .allowWrite("/tmp/.dotnet")
  .variant("baseline", (v) => v.permissions("full").prompt("Run dotnet test and report the result"))
  .case("tests-pass", (c) => c.expect(regex("passes", /passed/i)))
```

Un flux privé exige aussi un identifiant : hors périmètre.

## Prérequis

- `srt` vient de la dépendance `@anthropic-ai/sandbox-runtime`, pas d'une installation globale.
- Il nécessite `rg` sur macOS, et `bwrap`, `socat` et `rg` sur Linux. Sinon `create` échoue et dit quoi installer, ou de passer `--sandbox local-temp`.
- `test/srt.integration.test.ts` exécute le vrai `srt`, sans LLM ni réseau : lire un faux home et un autre essai est refusé, écrire hors de l'espace de travail est refusé, l'espace de travail et `.allowWrite()` sont accessibles en écriture. Il est ignoré, avec un message, là où srt ne fonctionne pas.
