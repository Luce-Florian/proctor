import { judge, suite } from "@fluce/proctor"

export default suite("judged")
  .variant("baseline", (v) => v.prompt("Say hello"))
  .case("greets", (c) => c.expect(judge().criterion("says-hello", "Dit bonjour")))
