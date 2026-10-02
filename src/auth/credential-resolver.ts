/** One way an agent authenticates: the environment variable carrying its credential. */
export interface CredentialProfile {
  /** Environment variable carrying the credential. */
  readonly variable: string
  /** What to do when it is missing, e.g. "set API_KEY". */
  readonly howTo: string
  /** Set while a profile is known but not validated yet: selecting it fails with this reason. */
  readonly unavailable?: string
}

/** A credential to hand to the agent process, never written to a report. */
export interface Credential<Profile extends string = string> {
  readonly profile: Profile
  /** Name of the environment variable to set in the agent process. */
  readonly variable: string
  readonly value: string
}

/** Raised when no usable credential is found; the CLI exits 2 with its message. */
export class CredentialError extends Error {
  override readonly name = "CredentialError"
}

/**
 * Picks the credential of the first available profile whose variable is set; `forced` (`--auth`) requires that one.
 * Never reads a keychain or a config directory: a credential only comes from the environment.
 * Each agent adapter declares its own `profiles`, tried in order.
 *
 * @example
 * resolveCredential("my-agent", { token: { variable: "MY_TOKEN", howTo: "set MY_TOKEN" } }, { MY_TOKEN: "t" }).profile // "token"
 */
export function resolveCredential<Profile extends string>(
  agent: string,
  profiles: Readonly<Record<Profile, CredentialProfile>>,
  env: Readonly<Record<string, string | undefined>>,
  forced?: string,
): Credential<Profile> {
  // Object.keys widens to string[]: the keys of `profiles` are its profiles by construction.
  const names = Object.keys(profiles) as Profile[]
  const isProfile = (name: string): name is Profile => names.some((p) => p === name)
  if (forced !== undefined && !isProfile(forced)) {
    throw new CredentialError(`Unknown --auth "${forced}" for ${agent}. Use one of: ${names.join(", ")}.`)
  }
  const chosen = forced
  if (chosen !== undefined && profiles[chosen].unavailable) throw new CredentialError(`--auth ${chosen}: ${profiles[chosen].unavailable}.`)
  const available = names.filter((p) => !profiles[p].unavailable)
  for (const profile of chosen === undefined ? available : [chosen]) {
    const { variable } = profiles[profile]
    const value = env[variable]?.trim()
    if (value) return { profile, variable, value }
  }
  if (chosen !== undefined) throw new CredentialError(`--auth ${chosen} needs ${profiles[chosen].variable}: ${profiles[chosen].howTo}.`)
  const howTo = available.map((p) => `${profiles[p].howTo} (profile ${p})`).join(", or ")
  throw new CredentialError(`No credential for ${agent}: ${howTo}.`)
}
