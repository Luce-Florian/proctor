# Limitations connues

- Profil `api-key` : à tester plus tard.
- Le jeton reste dans l'env du processus `claude` lui-même. La CLI le retire de ses sous-processus, mais un sous-processus qui lirait l'env de son parent (`/proc/<pid>/environ` sous Linux) le verrait. Sous srt, le réseau limite l'exfiltration aux domaines Anthropic ; le masque protège les rapports, pas la sandbox.
- Les réglages gérés de l'hôte (`managed-settings.json`, `managed-mcp.json`, politique MDM) restent chargés : `--setting-sources` ne les couvre pas. La sonde repère un serveur MCP, un plugin ou un hook `SessionStart` qu'ils ajoutent, pas une permission ni un autre hook.
- Sous srt, l'agent n'atteint que les domaines Anthropic, et n'écrit que dans l'essai. Une suite ouvre un registre avec `.allowDomains(...)` et un répertoire avec `.allowWrite(...)` ; un flux privé exige aussi un identifiant, hors périmètre.
- Chaque `fileChanged` prend son propre instantané de l'espace de travail ; le juge relit son diff à chaque essai. Négligeable aux tailles actuelles.
- Un thème historique dont l'outil écrit hors de l'essai ou restaure des paquets depuis un registre n'a pas de parité sous srt : `dotnet` écrit dans `/tmp/.dotnet` et restaure depuis NuGet, ce que le format historique ne peut pas déclarer. [Portez un tel thème](./legacy/porting.md) en `*.eval.ts`, avec `.allowWrite("/tmp/.dotnet")` et `.allowDomains(...)`.
- Une fixture (`git clone`) ne reçoit pas le signal d'interruption : Ctrl-C l'arrête via le groupe de processus du terminal, un `SIGTERM` envoyé au seul harnais la laisse finir.
- Chaque essai reclone le dépôt et réinstalle les plugins de marketplace : correct mais lent, un cache par `(url, commit)` viendra plus tard.
- Un `*.eval.ts` doit être un module ES : voir [Démarrer](./getting-started.md#installation).
