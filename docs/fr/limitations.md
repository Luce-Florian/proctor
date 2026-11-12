# Limitations connues

- Profil `api-key` : à tester plus tard.
- Le jeton reste dans l'env du processus `claude` lui-même. La CLI le retire de ses sous-processus, mais un sous-processus qui lirait l'env de son parent (`/proc/<pid>/environ` sous Linux) le verrait. Sous srt, le réseau limite l'exfiltration aux domaines Anthropic ; le masque protège les rapports, pas la sandbox.
- Les réglages gérés de l'hôte (`managed-settings.json`, `managed-mcp.json`, politique MDM) restent chargés : `--setting-sources` ne les couvre pas. La sonde repère un serveur MCP, un plugin ou un hook `SessionStart` qu'ils ajoutent, pas une permission ni un autre hook.
- Sous srt, l'agent n'atteint que les domaines Anthropic, et n'écrit que dans l'essai. Une suite ouvre un registre avec `.allowDomains(...)` et un répertoire avec `.allowWrite(...)` ; un flux privé exige aussi un identifiant, hors périmètre.
- Chaque `fileChanged` prend son propre instantané de l'espace de travail ; le juge relit son diff à chaque essai. Négligeable aux tailles actuelles.
- Un thème historique dont l'outil écrit hors de l'essai ou restaure des paquets depuis un registre n'a pas de parité sous srt : `dotnet` écrit dans `/tmp/.dotnet` et restaure depuis NuGet, ce que le format historique ne peut pas déclarer. [Portez un tel thème](./legacy/porting.md) en `*.eval.ts`, avec `.allowWrite("/tmp/.dotnet")` et `.allowDomains(...)`.
- Une fixture (`git clone`) ne reçoit pas le signal d'interruption : Ctrl-C l'arrête via le groupe de processus du terminal, un `SIGTERM` envoyé au seul harnais la laisse finir.
- Chaque essai reclone le dépôt et réinstalle les plugins de marketplace : correct mais lent, un cache par `(url, commit)` viendra plus tard.
- `--strict-mcp-config` écarte, sans le dire, les serveurs MCP que déclare un plugin chargé : une skill qui en a besoin s'exécute sans lui, sauf si la variante déclare un [stub MCP](./writing-evals/mcp-stubs.md) du même nom.
- Un stub MCP ne sert que des outils, en stdio : ni ressources, ni prompts, ni notifications, pas de transport HTTP, aucune entrée vérifiée contre le schéma.
- L'agent peut lire la configuration du stub, réponses comprises, dans le home de sa sandbox (`.proctor/mcp/`), et écrire le journal d'appels : le flux reste la source de vérité de ce qu'il a appelé. Un journal qu'il a changé en lien ou en fichier spécial, ou fait grossir au-delà de 4 Mio, finit l'essai en `other`.
- Un grand catalogue d'outils peut être différé par Claude Code derrière une recherche d'outils ; 15 outils ne l'ont pas été. À vérifier avec le vrai catalogue d'une suite.
- Un `*.eval.ts` doit être un module ES : voir [Démarrer](./getting-started.md#installation).
