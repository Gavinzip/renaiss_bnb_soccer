import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function parseEnvFile(text) {
  const values = {}

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue

    const index = line.indexOf('=')
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    values[key] = value
  }

  return values
}

export function loadEnvFile(path, target = process.env) {
  if (!path || !existsSync(path)) return {}

  const values = parseEnvFile(readFileSync(path, 'utf8'))
  for (const [key, value] of Object.entries(values)) {
    if (target[key] === undefined) target[key] = value
  }
  return values
}

export function loadLocalEnvFiles(rootDir, fileNames = ['.env', '.env.local'], target = process.env) {
  for (const fileName of fileNames) {
    loadEnvFile(resolve(rootDir, fileName), target)
  }
}
