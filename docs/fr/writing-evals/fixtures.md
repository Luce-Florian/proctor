# Fixtures

Une fixture prépare l'espace de travail avant que l'agent s'exécute. Les fixtures s'exécutent sur l'hôte, hors de la sandbox de l'agent, dans l'ordre de déclaration ; leur teardown s'exécute dans l'ordre inverse (LIFO).

| Fixture | Effet |
|---|---|
| `directory(url, { into? })` | copie le contenu d'un répertoire dans l'espace de travail, ou dans son sous-répertoire `into` ; le teardown ne supprime que ce que la copie a créé |
| `gitRepo(url).ref(b).at(sha).diff(f)` ou `.applyDiff(f)`, `.overlay(dir)` | clone un dépôt et prépare une pull request à relire : voir ci-dessous |

## `gitRepo`

Un portage du `run.sh` du banc historique.

| Étape | Effet |
|---|---|
| clone | `git clone --depth 1 --branch <ref>` dans l'espace de travail, par le harnais avec les identifiants git de l'hôte, hors de la sandbox de l'agent |
| `.at(sha)` | `fetch` puis `checkout` du commit exact |
| `.diff(f)` | copié en `eval-pr.diff`, non appliqué |
| `.overlay(dir)` | copié à la racine et commité sur la base ; `origin/<ref>` épinglé, refspec de fetch neutralisée |
| `.applyDiff(f)` | un commit sur la branche `eval-pr`, puis `eval-pr.diff` supprimé |
| toujours | `eval-pr.diff`, `eval-spec.md`, `.claude/settings.local.json` dans `.git/info/exclude` ; commits sans signature ni hooks |

- Les chemins sont des `new URL(…, import.meta.url)` : ils se résolvent depuis le fichier `*.eval.ts`, pas depuis le répertoire courant.
- Une fixture (`git clone`) ne reçoit pas le signal d'interruption : voir [Limitations connues](../limitations.md).
