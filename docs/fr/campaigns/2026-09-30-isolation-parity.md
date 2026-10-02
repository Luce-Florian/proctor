# 2026-09-30 : isolation et parité

Exécutée le 2026-09-30 : CLI `2.1.280`, profil `oauth`, sandbox `srt` sauf mention contraire, modèle `claude-sonnet-5`. En plus de la sonde d'isolation de ce dépôt, la campagne a exécuté des thèmes d'un banc privé au format bash historique.

```sh
export CLAUDE_CODE_OAUTH_TOKEN=…                       # claude setup-token
npm run fingerprint:claude-home -- --save before.json
npx proctor run suites/isolation-probe.eval.ts --agent claude-code
npx proctor run suites/isolation-probe.eval.ts --agent claude-code --sandbox local-temp   # must fail: isolation degraded
npx proctor run <review-theme> --agent claude-code --case <case-id> --repeat 3 -j 3
npx proctor run <legacy-theme> --agent claude-code -j 2
npm run fingerprint:claude-home -- --compare before.json
```

## Sonde d'isolation

| Sandbox | Statut | Critères non atteints | Coût |
|---|---|---|---|
| `srt` | `passed` | aucun : `~/.claude`, `~/.ssh` et le témoin du répertoire temporaire refusés (`Operation not permitted`), `curl` bloqué (`CONNECT tunnel failed, response 403`), aucun jeton dans `env` ni dans le transcript, aucun MCP ni plugin chargé | $0.11 |
| `local-temp` | `failed`, isolation `degraded` | `claude-config-unreadable`, `claude-settings-unreadable`, `ssh-unreadable`, `host-tmp-unreadable`, `network-blocked` | $0.12 |

Relancée après une review de l'isolation, avec une politique srt et une sonde durcies. La première relance a échoué sous srt sur `cat ~/.claude/CLAUDE.md` : le fichier était absent sur cette machine, et `No such file` ne prouve pas un refus, d'où `ls -la ~/.claude`. Empreinte de `~/.claude` inchangée, aucune clé Anthropic dans les résultats.

La première tentative sous srt a révélé deux problèmes, corrigés depuis : l'outil Bash ne démarrait pas (d'où `CLAUDE_CODE_TMPDIR` et le témoin `workspace-writable`), et le modèle refusait le `ls ~/.ssh` d'un prompt trop laconique.

## Parité avec le banc bash : un thème de code review, un cas, `--repeat 3`

| Variante | Critères par essai | Moyenne | Principal | Leurres | Coût moyen | Banc bash |
|---|---|---|---|---|---|---|
| baseline | 11, 10, 8 | 9.7 / 12 | 3 / 3 | 2 / 2 | $0.32 | 9 / 12, $0.30 (+7 %) |
| avec le plugin de review | 11, 12, 11 | 11.3 / 12 | 3 / 3 | 2 / 2 | $1.24 | 11 à 12 / 12, moyenne $1.47 sur 7 exécutions (−16 %) |

Les trois critères d'acceptation de la parité tiennent : baseline entre 8 et 10 en moyenne, la variante avec plugin ≥ 11 avec le principal dans les 3 essais, des coûts à ±30 % près.

## Thèmes historiques (un sous-ensemble, pour le budget)

| Thème, cas | Variantes | Harnais | Bash | Lecture |
|---|---|---|---|---|
| un thème de plugin, un cas | baseline / avec le plugin | score 4 / 5 | 4 / 5 | parité ; le plugin est installé depuis sa marketplace dans le home de la sandbox |
| un thème oui/non, un cas qui attend `non` | baseline / avec deux plugins | 5 / 2 | 2 / 5 | inversé sur une seule exécution : un critère de forme instable, une seule relance ne prouve rien |
| un thème qui lance `dotnet test` | les deux | score 1 | 2 / 5 | pas de parité sous srt : `dotnet` écrit dans `/tmp/.dotnet/shm` (refusé) et la restauration NuGet sort du réseau autorisé |
| un thème qui lance `dotnet build` | les deux | `other` | — | chemins de socket srt tronqués à 104 octets (`EADDRINUSE`) ; corrigé depuis avec une racine d'essai courte, vérifié hors campagne |

Coût total de cette campagne : environ $8.8, juge compris.

L'empreinte de `~/.claude` (`settings.json`, `plugins/`, `known_marketplaces.json`) est identique avant et après toutes les campagnes.
