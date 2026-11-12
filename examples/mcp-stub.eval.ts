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
