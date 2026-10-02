# Démarrer

## Installation

```sh
npm i -D @fluce/proctor              # Node >= 22.12
npx proctor run <file> --agent <id>
```

- Un `*.eval.ts` importe `@fluce/proctor` comme toute dépendance installée : il vit dans un projet qui installe le package.
- Il doit se charger comme module ES : sous un `package.json` avec `"type": "module"`, ou nommé `*.eval.mts`. Ailleurs, tsx le compile en CommonJS et Node refuse de le charger (`Cannot require() ES Module … in a cycle`).
- Vérifiez ses types avec le `tsc` de ce projet.

## Une première exécution, sans LLM

L'agent et la sandbox `fake` exécutent une suite de bout en bout, sans identifiant ni réseau. Depuis un clone de ce dépôt :

```console
$ npm ci
$ npx proctor run examples/hello.eval.ts --agent fake
Running hello: 2 trials (agent fake 0.0.0, sandbox fake, isolation none)
PASS  greets-world [baseline] #1 (3ms)
PASS  greets-world [polite] #1 (4ms)
2 trials: 2 passed, 0 failed, 0 other, 0 skipped
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.ctrf.json
Wrote results/hello/2026-09-30T16-57-05-888Z-a28a.summary.md
```

`examples/hello.eval.ts` est la suite montrée sur la [page d'accueil](./index.md).

## Une première exécution contre Claude Code

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…   # claude setup-token; never the keychain nor ~/.claude
npx proctor run suites/isolation-probe.eval.ts --agent claude-code            # srt sandbox by default
npx proctor run path/to/review.eval.ts --agent claude-code --case <case-id> --repeat 3 -j 3
```

- `suites/isolation-probe.eval.ts` vérifie que la sandbox (bac à sable) tient : voir [Sonde d'isolation](./agents/claude-code/isolation-probe.md).
- La sandbox `srt` nécessite `rg` sur macOS, et `bwrap`, `socat` et `rg` sur Linux : voir [Sandboxes](./sandboxes.md).

## Ensuite

- [Suites, variantes, cas](./writing-evals/index.md) : l'API d'écriture.
- [Évaluateurs](./writing-evals/graders.md) : ce qui contrôle une réponse.
- [CLI](./running/cli.md) : chaque option et chaque code de sortie.
