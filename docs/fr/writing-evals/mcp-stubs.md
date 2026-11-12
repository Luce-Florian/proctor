# Stubs MCP

Une skill qui lit un serveur MCP (une base de données, un outil de tickets) ne se mesure pas sur un diff seul : le serveur n'existe pas dans l'essai. Un stub MCP est un faux serveur, déclaré dans la suite, qui répond ce que le cas dit qu'il répondrait.

```ts
// examples/mcp-stub.eval.ts
import { mcpCalled, mcpError, mcpStub, regex, suite } from "@fluce/proctor"

/** The server as the agent sees it: copy descriptions and input schemas from the real server's tools/list. */
const pgsql = mcpStub("pgsql").tool("get_object_details", (t) =>
  t
    .description("Columns, nullability, constraints and indexes of a table.")
    .inputSchema({ type: "object", properties: { object_name: { type: "string" } }, required: ["object_name"] })
    .otherwise(mcpError("relation does not exist")),
)

const QUESTION = "Does the table orders need an index on customer_id? Answer yes or no, then why."

export default suite("mcp-stub")
  .variant("with-pgsql", (v) => v.mcpStub(pgsql).prompt(QUESTION))
  .variant("without-server", (v) => v.prompt(QUESTION))
  .case("index-exists", (c) =>
    c
      .description("The server reports an index on orders(customer_id)")
      .mcpStub(pgsql, (s) =>
        s
          .on("get_object_details", { object_name: /^(public\.)?orders$/ })
          .returns({ table: "public.orders", indexes: ["orders_pkey (id)", "orders_customer_id_idx (customer_id)"] }),
      )
      .expect(mcpCalled("reads-orders", pgsql, { tool: "get_object_details", input: { object_name: /^(public\.)?orders$/ } }))
      .expect(mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 }))
      .expect(regex("answers-yes-or-no", /\b(yes|no)\b/i)),
  )
```

```mermaid
sequenceDiagram
    participant H as harnais (hôte)
    participant A as agent, dans la sandbox
    participant M as node stub-server.mjs (pgsql)
    Note over H: prepare : programme du stub, ses règles et pgsql.json dans <home de l'essai>/.proctor/mcp/
    H->>A: exécution, pgsql déclaré comme serveur MCP stdio
    A->>M: lancement, initialize, tools/list
    A->>M: tools/call get_object_details {object_name: "orders"}
    M-->>A: première règle qui correspond, sinon un repli
    M->>M: ajoute l'appel et ce qui y a répondu à pgsql.jsonl
    A-->>H: appels d'outils, réponse finale
    Note over H: le journal prouve que le stub a servi ; chaque appel auquel il a répondu reçoit ToolCall.mcp
```

## Où vit chaque élément

| Quoi | Niveau | Règle |
|---|---|---|
| Outils, descriptions, schémas d'entrée | la valeur `mcpStub()` | un catalogue, partagé ; un cas ne peut pas ajouter d'outil |
| Réponses communes à tous les cas | la valeur `mcpStub()` : `t.returns(...)`, `t.on(...)` | par exemple `list_instances` répond toujours `prod` |
| Le serveur existe dans l'essai | variante : `v.mcpStub(pgsql)` | une variante sans lui s'exécute sans le serveur : deux variantes mesurent la skill avec et sans |
| Réponses d'un cas | cas : `c.mcpStub(pgsql, s => …)` | s'appliquent seulement dans les variantes qui déclarent `pgsql` |
| Repli | `t.otherwise(...)`, sinon `mcpStub().otherwise(...)` | intégré : une erreur d'outil, `No result for these arguments.` |

Un appel `(outil, entrée)` reçoit la première correspondance parmi :

1. les règles du cas pour cet outil, dans l'ordre de déclaration ;
2. les règles de la valeur `mcpStub()` pour cet outil, dans l'ordre de déclaration ;
3. le `otherwise` de l'outil, puis celui du serveur, puis le repli intégré.

## Faire correspondre une entrée

| `when` | Correspond à | Exemple |
|---|---|---|
| omis | toute entrée | `.on("list_instances")` |
| motif objet | chaque clé du motif est dans l'entrée et correspond, récursivement ; les clés en plus de l'entrée sont ignorées | `{ object_name: "orders" }` |
| `RegExp` comme valeur | un champ texte qu'elle trouve | `{ object_name: /^(public\.)?orders$/i }` |
| tableau comme valeur | même longueur, élément par élément | `{ columns: ["customer_id"] }` |
| `RegExp` comme `when` | le JSON de toute l'entrée | `.on("execute_sql", /reltuples/)` |

L'`input` de `mcpCalled` prend les mêmes motifs. Une fonction ne peut pas passer au processus du stub : les types la refusent, et la suite la refuse au chargement.

## Réponses

| Appel | L'agent reçoit |
|---|---|
| `.returns("text")` | le texte |
| `.returns({ … })`, un tableau, un nombre, un booléen | la valeur en texte JSON indenté |
| `.returns(mcpError("text"))` | le texte comme erreur d'outil (`isError: true`) |
| `.returnsInOrder(a, b, mcpError("c"))` | `a`, puis `b`, puis `c` pour tout appel correspondant suivant |

Une grosse réponse, un plan `EXPLAIN` par exemple, est lue par la suite elle-même : `.returns(await readFile(new URL("./plan.txt", import.meta.url), "utf8"))`.

## Évaluer les appels

| Besoin | Évaluateur |
|---|---|
| l'agent a appelé un outil | `mcpCalled("reads-orders", pgsql, { tool: "get_object_details" })` |
| … avec une entrée donnée | `{ tool, input: { object_name: /^(public\.)?orders$/ } }` |
| … un nombre de fois | `mcpCalled(…, { min, max })` |
| l'agent n'a rien demandé que le cas n'ait anticipé | `mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 })` |

- Dans une variante sans le stub, `mcpCalled` est non applicable : aucun critère, donc la variante sans le serveur est mesurée par les autres évaluateurs, pas mise en échec par construction.
- Le juge voit la réponse et le diff, jamais les appels d'outils : énoncez dans le critère ce que répond le stub (« `get_object_details` signale un index sur `orders(customer_id)` »).
- `toolUsed` fonctionne toujours sur les noms propres à l'agent, par exemple `mcp__pgsql__get_object_details` pour Claude Code.

## Exécution et rapports

| Où | Quoi |
|---|---|
| `proctor list` | `with-pgsql  mcp stubs: pgsql (1 tool)` |
| `--agent fake --sandbox srt` | lance chaque stub à travers la sandbox, gratuitement ; l'agent fake n'appelle aucun outil |
| CTRF | `mcpStubCalls`, `mcpStubFallbacks` par essai, jamais une entrée ni une réponse ([référence CTRF](../running/ctrf.md)) |
| résumé, HTML, console | une note sur chaque essai où un repli a répondu : le cas a peut-être besoin d'une règle |
| tests | `answerStub(input.mcpStubs, "pgsql", tool, input)` de `@fluce/proctor/testing` donne à un `FakeAgentAdapter` l'appel qu'un stub aurait produit |

Comment un agent exécute les stubs : [Claude Code](../agents/claude-code/index.md) (options), [Claude Code : plugins](../agents/claude-code/plugins.md#serveurs-mcp-d-un-plugin) (un stub remplace le serveur d'un plugin), [Extension](../contributing/extending.md#les-stubs-mcp-dans-un-nouvel-agent) (un autre agent).
