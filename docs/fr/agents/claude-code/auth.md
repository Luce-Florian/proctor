# Claude Code : authentification

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…   # claude setup-token
```

| Profil | Variable | Statut |
|---|---|---|
| `oauth` | `CLAUDE_CODE_OAUTH_TOKEN` (`claude setup-token`) | validé |
| `api-key` | `ANTHROPIC_API_KEY` | à tester plus tard : `--auth api-key` sort avec 2 et un message |

- Sans identifiant : `No credential for claude-code: run \`claude setup-token\` and export the token as CLAUDE_CODE_OAUTH_TOKEN (profile oauth).`, code de sortie 2.
- L'identifiant passe par une seule variable, ajoutée par l'adaptateur : l'env de la sandbox ne contient jamais les identifiants de l'hôte.
- Le profil et la variable vont dans `results.environment.extra.agent.details`, jamais la valeur.
- Un identifiant refusé affiche `claude refused the credential CLAUDE_CODE_OAUTH_TOKEN (profile oauth): … Fix: run \`claude setup-token\`…`, et non le conseil `/login` de la CLI.

## Où le jeton pourrait fuiter

| Où | Ce qui l'empêche |
|---|---|
| env de Bash, des hooks, des serveurs MCP stdio | la CLI `2.1.280` le retire d'elle-même, vérifié en conditions réelles (`env`, hooks `SessionStart` et `PreToolUse`, MCP) ; la sonde le revérifie (`credential-not-in-env`) |
| transcript, `toolCalls[].output`, texte final, prompt du juge, CTRF, résumé | chaque ligne du flux est masquée (`[redacted by proctor]`) **avant** d'être écrite ou analysée : la valeur de l'identifiant et toute clé Anthropic (`src/adapters/redact.ts`) |
| le `why` d'un évaluateur | les évaluateurs d'appels d'outils ne donnent que des comptes, jamais la sortie d'un outil |

`CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` n'est **pas** défini. Sur `2.1.280`, il force le mode de permission à `default` (vérifié via `system/init.permissionMode`), ce qui casse `full` et `workspace-write`, donc la sonde et tout le loader historique. Le garder exigerait une liste `--allowedTools` par profil, ce qui changerait le comportement mesuré.

Le jeton reste malgré tout dans l'env du processus `claude` lui-même : voir [Limitations connues](../../limitations.md).
