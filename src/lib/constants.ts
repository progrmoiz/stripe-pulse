declare const __CLI_VERSION__: string

export const VERSION = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev'

export const CLI_NAME = 'stripe-pulse'
export const CONFIG_DIR_NAME = 'stripe-pulse'
export const CREDENTIALS_FILENAME = 'credentials.json'
export const USER_AGENT = `stripe-pulse/${VERSION}`
