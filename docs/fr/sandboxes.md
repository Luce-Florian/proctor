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
| Env | `PATH` sans les entrées sous le home de l'hôte, `LANG`, `LC_*`, `TERM`, `TZ`, `USER`, `LOGNAME` | idem |
| Lecture | home de l'hôte et répertoires temporaires masqués, sauf l'espace de travail, le home et le TMPDIR de l'essai, et les chemins déclarés | tout le disque |
| Écriture | l'espace de travail, le home et le TMPDIR de l'essai, les chemins de `.allowWrite()` | tout le disque |
| Réseau | domaines déclarés uniquement | ouvert |

`fake` (`src/testing/`) n'exécute rien : isolation `none`, la valeur par défaut avec `--agent fake`.

## Vérifier la sandbox sans modèle

Avec une vraie sandbox, `--agent fake` y lance une commande shell, dans l'espace de travail, après les fixtures, comme le ferait un agent au démarrage : la sandbox doit démarrer et l'espace de travail doit être modifiable. Un dry run vérifie donc la sandbox de l'hôte, par exemple au build d'une CI, sans token et sans coût.

```sh
npx proctor run examples/hello.eval.ts --agent fake --sandbox srt
```

Quand la vérification échoue, l'essai finit en `other` avec un message qui commence par `The sandbox did not run a command in the workspace`, suivi de l'erreur de la sandbox elle-même. Une suite avec `judge()` finit aussi en `other` sous le juge fake, par construction : un job de CI distingue les deux par ce message dans le CTRF.

## La politique `srt`

La politique d'un essai (`<trial root>/srt-settings.json`, hors des répertoires accessibles en écriture) refuse largement, puis ouvre étroitement : dans srt, `allowRead` l'emporte sur `denyRead`.

```text
disque de l'hôte                           ce qu'un essai voit sous srt
├── ~  (home de l'hôte)                    masqué : ~/.ssh, ~/.aws, ~/.claude…
├── /tmp, /var/folders, /Volumes           masqué
├── os.tmpdir()                            masqué : parent de toutes les racines d'essai
│   ├── ae-review-basel-a1b2c3/            la racine de cet essai, pas rouverte elle-même
│   │   ├── srt-settings.json              masqué : la politique, lue par srt hors du sandbox
│   │   ├── work/                          modifiable : cwd, l'espace de travail
│   │   ├── home/                          modifiable : HOME, XDG_*, .claude/, .proctor/plugins/, .proctor/mcp/
│   │   └── tmp/                           modifiable : TMPDIR, CLAUDE_CODE_TMPDIR
│   └── ae-review-with--d4e5f6/            masqué : un autre essai (-j 2)
├── répertoire du binaire claude           lisible (sandboxAccess)
├── répertoire de node                     lisible (sandboxAccess) dans un essai avec stubs MCP : il les exécute
├── chemins .allowRead() / .allowWrite()   lisible / modifiable
└── /usr, /opt, /etc…                      lisible : binaires, bibliothèques, certificats
```

| Règle | Chemins | Pourquoi |
|---|---|---|
| `denyRead` | home de l'hôte | `~/.ssh`, `~/.aws`, `~/.config/gh`, `~/.claude`… |
| `denyRead` | répertoire parent des racines d'essai (`os.tmpdir()`, chemin donné et chemin réel) | un essai ne lit pas la racine d'un autre essai (`-j 2`) |
| `denyRead` | `/tmp`, `/private/tmp`, `/var/folders`, `/private/var/folders`, `/Volumes` (ceux qui existent) | `/tmp/claude-<uid>` contient les sorties des sessions Claude de l'hôte ; disques montés |
| `allowRead` | `<root>/work`, `<root>/home`, `<root>/tmp` | jamais la racine elle-même : sous Linux, srt remonte en lecture seule un répertoire rouvert après les binds en écriture, ce qui rendrait l'espace de travail non modifiable et bloquerait bubblewrap au démarrage |
| `allowRead` | le paquet `@anthropic-ai/sandbox-runtime` | sous Linux, srt lance son filtre seccomp depuis `vendor/seccomp`, dans le sandbox, et `node_modules` est souvent sous le home masqué |
| `allowRead` | répertoire du binaire de l'agent, répertoire de `node` (essais avec stubs MCP seulement), `.allowRead()`, `.allowWrite()` | ce que déclarent l'agent et la suite ; un `node` installé par nvm, fnm ou volta est sous le home masqué |
| `allowWrite` | `<root>/work`, `<root>/home`, `<root>/tmp`, `.allowWrite()` | rien d'autre ; srt ajoute stdio et `/tmp/claude`, illisible ici |
| `allowedDomains` | l'API du modèle pour le profil, `.allowDomains()` | tout le reste est bloqué par le proxy srt |
| env | `CLAUDE_CODE_TMPDIR=<root>/tmp` | srt donne à la commande `TMPDIR=$CLAUDE_CODE_TMPDIR`, sinon `/tmp/claude`, partagé et masqué |

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
- Il refuse Windows natif : lancez proctor dans WSL2, voir [Windows (WSL2)](./windows.md).
- `test/srt.integration.test.ts` exécute le vrai `srt`, sans LLM ni réseau : lire un faux home et un autre essai est refusé, écrire hors de l'espace de travail est refusé, l'espace de travail et `.allowWrite()` sont accessibles en écriture. Il est ignoré, avec un message, là où srt ne fonctionne pas, sauf avec `PROCTOR_REQUIRE_SRT=1` : la CI le pose et installe `bubblewrap`, `socat` et `ripgrep`, donc la politique est vérifiée sous Linux à chaque build.
