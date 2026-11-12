---
name: index-check
description: Says whether a table needs an index on a column, from what the pgsql MCP server reports about the table.
---

Arguments: a table, then a column.

1. Call the `get_object_details` tool of the `pgsql` MCP server with `object_name` set to the table.
2. Answer `yes` or `no` on the first line: `no` when an index already leads with the column, `yes` otherwise.
3. Then give the reason in one sentence, quoting the index you found, or saying that none leads with the column.

Never answer without calling the server first.
