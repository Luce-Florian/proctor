import { directory, regex, suite } from "@fluce/proctor"

export default suite("hello")
  .variant("baseline", (v) => v.prompt((c) => `Say hello to ${c.context}`))
  .variant("polite", (v) => v.prompt((c) => `Say hello politely to ${c.context}`))
  .case("greets-world", (c) =>
    c
      .description("The agent greets the world")
      .context("world")
      .fixture(directory(new URL("./hello", import.meta.url)))
      .expect(regex("says-hello", /hello/i))
      .expect(regex("names-world", /world/i))
      .timeout("1m"),
  )
