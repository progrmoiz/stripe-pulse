import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { CONFIG_DIR_NAME, CREDENTIALS_FILENAME } from './constants.js'

export interface Profile {
  api_key: string
  name?: string
}

export interface Credentials {
  active_profile: string
  profiles: Record<string, Profile>
}

export interface GlobalOpts {
  apiKey?: string
  profile?: string
  json?: boolean
  quiet?: boolean
  from?: string
  to?: string
  format?: 'json' | 'csv' | 'markdown'
  verbose?: boolean
  chart?: boolean
  compare?: boolean
}

/**
 * Returns the config directory path.
 * Respects XDG_CONFIG_HOME on Linux, APPDATA on Windows.
 */
export function getConfigDir(): string {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, CONFIG_DIR_NAME)
  }
  const xdg = process.env.XDG_CONFIG_HOME
  if (xdg) {
    return path.join(xdg, CONFIG_DIR_NAME)
  }
  return path.join(os.homedir(), '.config', CONFIG_DIR_NAME)
}

/**
 * Returns the full path to the credentials file.
 */
export function getCredentialsPath(): string {
  return path.join(getConfigDir(), CREDENTIALS_FILENAME)
}

/**
 * Reads and parses the credentials file.
 * Returns null if the file does not exist or cannot be parsed.
 */
export function readCredentials(): Credentials | null {
  const credPath = getCredentialsPath()
  try {
    const raw = fs.readFileSync(credPath, 'utf-8')
    return JSON.parse(raw) as Credentials
  } catch {
    return null
  }
}

/**
 * Writes credentials to disk.
 * Creates directory with 0o700, file with 0o600.
 */
export function writeCredentials(creds: Credentials): void {
  const configDir = getConfigDir()
  const credPath = getCredentialsPath()

  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 })
  fs.writeFileSync(credPath, JSON.stringify(creds, null, 2), { encoding: 'utf-8', mode: 0o600 })
  // Enforce permissions on existing files (chmod after write)
  fs.chmodSync(credPath, 0o600)
  fs.chmodSync(configDir, 0o700)
}

/**
 * Resolves the active profile name.
 * Priority: opts.profile > STRIPE_PULSE_PROFILE env > active_profile in file > "default"
 */
function resolveProfileName(opts: GlobalOpts): string {
  if (opts.profile) return opts.profile
  if (process.env.STRIPE_PULSE_PROFILE) return process.env.STRIPE_PULSE_PROFILE
  const creds = readCredentials()
  if (creds?.active_profile) return creds.active_profile
  return 'default'
}

/**
 * Resolves the active Profile object.
 * Returns null if no profile found.
 */
export function resolveProfile(opts: GlobalOpts): Profile | null {
  const name = resolveProfileName(opts)
  const creds = readCredentials()
  return creds?.profiles[name] ?? null
}

/**
 * Resolves the API key to use.
 * Auth chain: --api-key flag > STRIPE_API_KEY env > config file (active profile)
 */
export function resolveApiKey(opts: GlobalOpts): string | null {
  if (opts.apiKey) return opts.apiKey
  if (process.env.STRIPE_API_KEY) return process.env.STRIPE_API_KEY
  const profile = resolveProfile(opts)
  return profile?.api_key ?? null
}

/**
 * Returns the active profile name from the credentials file.
 */
export function getActiveProfile(): string {
  const creds = readCredentials()
  return creds?.active_profile ?? 'default'
}

/**
 * Updates the active_profile field in the credentials file.
 */
export function setActiveProfile(name: string): void {
  const creds = readCredentials() ?? { active_profile: name, profiles: {} }
  creds.active_profile = name
  writeCredentials(creds)
}

/**
 * Adds or updates a profile in the credentials file.
 */
export function addProfile(name: string, profile: Profile): void {
  const creds = readCredentials() ?? { active_profile: name, profiles: {} }
  creds.profiles[name] = profile
  writeCredentials(creds)
}

/**
 * Removes a profile from the credentials file.
 * Throws if the profile does not exist.
 */
export function removeProfile(name: string): void {
  const creds = readCredentials()
  if (!creds) throw new Error(`No credentials file found`)
  if (!creds.profiles[name]) throw new Error(`Profile "${name}" not found`)
  delete creds.profiles[name]
  // If active profile was removed, switch to first remaining or "default"
  if (creds.active_profile === name) {
    const remaining = Object.keys(creds.profiles)
    creds.active_profile = remaining[0] ?? 'default'
  }
  writeCredentials(creds)
}

/**
 * Returns all profile names with a boolean indicating which is active.
 */
export function listProfiles(): Array<{ name: string; active: boolean }> {
  const creds = readCredentials()
  if (!creds) return []
  const active = creds.active_profile
  return Object.keys(creds.profiles).map((name) => ({
    name,
    active: name === active,
  }))
}

/**
 * Masks an API key for display: shows first 6 + last 4 characters.
 * e.g. sk_abc...wxyz
 */
export function maskApiKey(key: string): string {
  if (key.length <= 10) return '***'
  return `${key.slice(0, 6)}...${key.slice(-4)}`
}

/**
 * Returns a human-readable description of where the API key came from.
 */
export function getKeySource(opts: GlobalOpts): string {
  if (opts.apiKey) return '--api-key flag'
  if (process.env.STRIPE_API_KEY) return 'STRIPE_API_KEY env'
  return 'credentials file'
}
