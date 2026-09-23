import { existsSync, readFileSync } from 'node:fs'

/** Read an ignored local env file without importing its values into process.env. */
export function loadContractEnv(pathname) {
  if (!existsSync(pathname)) throw new Error(`Environment file not found: ${pathname}`)
  const entries = readFileSync(pathname, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const separator = line.indexOf('=')
      if (separator < 1) throw new Error(`Malformed environment line in ${pathname}`)
      const value = line.slice(separator + 1)
      return [line.slice(0, separator), value.replace(/^(['"])(.*)\1$/, '$2')]
    })
  return { ...Object.fromEntries(entries), ...process.env }
}
