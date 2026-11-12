import { fileURLToPath } from "node:url"
import { mcpCalled, mcpError, mcpStub, regex, suite } from "@fluce/proctor"

// Campaign suite: a real agent against an MCP stub, see docs/campaigns.
const MODEL = "claude-sonnet-5"

// A local plugin whose .mcp.json declares a pgsql server: the stub replaces it, under the plugin's server name.
const DBTOOLS = fileURLToPath(new URL("./plugins/dbtools", import.meta.url))

const pgsql = mcpStub("pgsql").tool("get_object_details", (t) =>
  t
    .description("Columns, nullability, constraints and indexes of a table.")
    .inputSchema({ type: "object", properties: { object_name: { type: "string" } }, required: ["object_name"] })
    .otherwise(mcpError("relation does not exist")),
)

const ORDERS = /^(public\.)?orders$/
const QUESTION =
  "Does the table orders need an index on customer_id? Check the database first. Answer yes or no on the first line, then why."

const readsOrders = mcpCalled("reads-orders", pgsql, { tool: "get_object_details", input: { object_name: ORDERS } })
const allAnticipated = mcpCalled("all-anticipated", pgsql, { answeredBy: "fallback" }, { min: 0, max: 0 })

export default suite("mcp-stub")
  .variant("with-pgsql", (v) => v.model(MODEL).mcpStub(pgsql).prompt(QUESTION))
  .variant("without-server", (v) => v.model(MODEL).prompt(QUESTION))
  .variant("plugin-server", (v) => v.model(MODEL).plugins(DBTOOLS).mcpStub(pgsql).prompt("/dbtools:index-check orders customer_id"))
  .case("index-exists", (c) =>
    c
      .description("The server reports an index leading with customer_id: no index needed")
      .mcpStub(pgsql, (s) =>
        s
          .on("get_object_details", { object_name: ORDERS })
          .returns({ table: "public.orders", indexes: ["orders_pkey (id)", "orders_customer_id_idx (customer_id)"] }),
      )
      .expect(readsOrders)
      .expect(allAnticipated)
      .expect(regex("answers-no", /^\W*no\b/i)),
  )
  .case("index-missing", (c) =>
    c
      .description("The server reports no index on customer_id: an index is needed")
      .mcpStub(pgsql, (s) =>
        s.on("get_object_details", { object_name: ORDERS }).returns({ table: "public.orders", indexes: ["orders_pkey (id)"] }),
      )
      .expect(readsOrders)
      .expect(allAnticipated)
      .expect(regex("answers-yes", /^\W*yes\b/i)),
  )
