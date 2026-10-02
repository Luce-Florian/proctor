import { describe, expect, it } from "vitest"
import { SuiteDefinitionError } from "../core/model.ts"
import { regex } from "../graders/regex.ts"
import { suite } from "./suite.ts"

const hello = regex("says-hello", /hello/i)

describe("suite builder", () => {
  it("builds a definition with safe defaults", () => {
    const definition = suite("demo")
      .variant("baseline", (v) => v.prompt((c) => `Say hello to ${c.context}`))
      .case("greets", (c) => c.context("world").expect(hello))
      .toDefinition()

    const [variant] = definition.variants
    const [testCase] = definition.cases
    expect(variant?.permissions).toBe("readonly")
    expect(variant?.plugins).toEqual([])
    expect(variant?.prompt({ id: "greets", context: "world" })).toBe("Say hello to world")
    expect(testCase?.timeoutMs).toBe(600_000)
    expect(testCase?.graders).toEqual([hello])
  })

  it("is immutable: each call returns a new builder", () => {
    const base = suite("demo").variant("baseline", (v) => v.prompt("hi"))
    const withCase = base.case("greets", (c) => c.expect(hello))

    expect(withCase).not.toBe(base)
    expect(() => base.toDefinition()).toThrow(/Suite has no case/)
    expect(withCase.toDefinition().cases).toHaveLength(1)
  })

  it("keeps variant options", () => {
    const [variant] = suite("demo")
      .variant("with-plugin", (v) =>
        v
          .prompt("hi")
          .plugins("sdlc", "rtk")
          .model("model-x")
          .permissions("workspace-write")
          .settings({ effort: "medium" })
          .mcpServers({ docs: { url: "http://localhost" } }),
      )
      .case("greets", (c) => c.expect(hello))
      .toDefinition().variants

    expect(variant).toMatchObject({
      plugins: ["sdlc", "rtk"],
      model: "model-x",
      permissions: "workspace-write",
      settings: { effort: "medium" },
      mcpServers: { docs: { url: "http://localhost" } },
    })
  })

  it("rejects a variant without prompt and a case without expectation, at compile time and at load time", () => {
    const build = () =>
      suite("demo")
        // @ts-expect-error a variant needs .prompt(...)
        .variant("baseline", (v) => v.plugins("sdlc"))
        // @ts-expect-error a case needs .expect(...) or .skip(...)
        .case("no-expectation", (c) => c.context("world"))
        .toDefinition()

    expect(build).toThrow(SuiteDefinitionError)
    expect(build).toThrow(/variant "baseline" > prompt: Variant has no prompt: add \.prompt/)
    expect(build).toThrow(/case "no-expectation" > graders: Case has no expectation: add \.expect/)
  })

  it("rejects duplicate names", () => {
    const build = () =>
      suite("demo")
        .variant("baseline", (v) => v.prompt("a"))
        .variant("baseline", (v) => v.prompt("b"))
        .case("greets", (c) => c.expect(hello))
        .toDefinition()

    expect(build).toThrow(/Variant names must be unique: "baseline" is declared more than once; rename the duplicates/)
  })

  it("lets .prompt() and .expect() come anywhere in the chain", () => {
    const definition = suite("demo")
      .variant("baseline", (v) => v.prompt("hi").plugins("sdlc"))
      .case("greets", (c) => c.expect(hello).context("world").timeout("1m"))
      .toDefinition()

    expect(definition.cases[0]?.context).toBe("world")
  })

  it("lets a skipped case omit expectations", () => {
    const [testCase] = suite("demo")
      .variant("baseline", (v) => v.prompt("hi"))
      .case("later", (c) => c.skip("not ready"))
      .toDefinition().cases

    expect(testCase?.skipReason).toBe("not ready")
  })
})
