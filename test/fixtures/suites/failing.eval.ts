import { regex, suite } from "@fluce/proctor"

// The fake agent echoes the prompt, which never says goodbye.
export default suite("failing")
  .variant("baseline", (v) => v.prompt("Say hello"))
  .case("says-goodbye", (c) => c.expect(regex("says-goodbye", /goodbye/i)))
