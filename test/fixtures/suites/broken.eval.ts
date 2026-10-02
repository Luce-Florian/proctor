import { directory, regex, suite } from "@fluce/proctor"

// The fixture directory does not exist: an infrastructure error, not an evaluation failure.
export default suite("broken")
  .variant("baseline", (v) => v.prompt("Say hello"))
  .case("missing-fixture", (c) =>
    c.fixture(directory(new URL("./does-not-exist", import.meta.url))).expect(regex("says-hello", /hello/i)),
  )
