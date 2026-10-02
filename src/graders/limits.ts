import { parseDuration, type Duration } from "../core/duration.ts"
import type { CriterionVerdict, GradeContext, GradeResult, Grader } from "../ports/grader.ts"

interface LimitsState {
  readonly maxCostUsd?: number
  readonly maxDuration?: Duration
}

/** Settings shared by {@link LimitsBuilder} and {@link Limits}; each method returns a new, immutable grader. */
abstract class LimitsSettings {
  /** @internal */
  protected readonly state: LimitsState

  /** @internal Use {@link limits} instead. */
  constructor(state: LimitsState) {
    this.state = state
  }

  /**
   * Fails the trial when the agent under test cost more than `usd` dollars. The judge's cost is reported apart and not
   * counted. An agent that reports no cost fails the criterion: the limit cannot be checked.
   *
   * @example
   * limits().maxCostUsd(3)
   */
  maxCostUsd(usd: number): Limits {
    if (!Number.isFinite(usd) || usd <= 0) throw new Error(`maxCostUsd expects a positive number of dollars, got ${usd}.`)
    return new Limits({ ...this.state, maxCostUsd: usd })
  }

  /**
   * Fails the trial when the agent run took longer than `duration`. Unlike `.timeout()`, the run is not stopped:
   * the trial is graded `failed`, not `other`.
   *
   * @example
   * limits().maxDuration("10m")
   */
  maxDuration(duration: Duration): Limits {
    parseDuration(duration) // throws on an invalid duration, at definition time
    return new Limits({ ...this.state, maxDuration: duration })
  }
}

/** Limits without any limit yet: not a grader, so `.expect(limits())` does not compile. */
export class LimitsBuilder extends LimitsSettings {}

/** Checks the agent run against its budget. Deterministic: reads the cost and duration the agent reported. */
export class Limits extends LimitsSettings implements Grader {
  readonly id = "limits"

  /** @example await limits().maxCostUsd(3).grade(context) // { graderId: "limits", passed: true, criteria: [{ id: "max-cost-usd", ... }] } */
  async grade({ result }: GradeContext): Promise<GradeResult> {
    const { maxCostUsd, maxDuration } = this.state
    const criteria: CriterionVerdict[] = []
    if (maxCostUsd !== undefined) {
      const cost = result.costUsd
      const met = cost !== undefined && cost <= maxCostUsd
      const why =
        cost === undefined
          ? "the agent reported no cost, so the limit cannot be checked"
          : `$${cost.toFixed(3)} spent, limit $${maxCostUsd}`
      criteria.push({ id: "max-cost-usd", met, why })
    }
    if (maxDuration !== undefined) {
      const met = result.durationMs <= parseDuration(maxDuration)
      criteria.push({ id: "max-duration", met, why: `${(result.durationMs / 1000).toFixed(1)}s, limit ${maxDuration}` })
    }
    return { graderId: this.id, passed: criteria.every((c) => c.met), criteria }
  }
}

/**
 * Starts a budget for the agent under test. Add at least one limit: before that, it is not a grader.
 *
 * @example
 * c.expect(limits().maxCostUsd(3).maxDuration("10m"))
 */
export function limits(): LimitsBuilder {
  return new LimitsBuilder({})
}
