/**
 * Shared utilities for OpenJules backend.
 * Centralises helpers that were previously duplicated across modules.
 */

import { existsSync, readFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'

/* -------------------------------------------------------------------------- */
/*  JSON helpers                                                              */
/* -------------------------------------------------------------------------- */

export const parseMaybeJson = (value: unknown): unknown => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export const serializeMaybeJson = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

/* -------------------------------------------------------------------------- */
/*  Path / filesystem helpers                                                 */
/* -------------------------------------------------------------------------- */

export const resolveBackendRoot = (): string => {
  const explicit = process.env.OPENJULES_BACKEND_ROOT
  if (explicit && explicit.trim()) return explicit.trim()

  let cursor = process.cwd()
  for (let depth = 0; depth < 8; depth += 1) {
    const packagePath = path.join(cursor, 'package.json')
    if (existsSync(packagePath)) {
      try {
        const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { name?: string }
        if (parsed?.name === '@openjules/backend') return cursor
      } catch {
        /* ignore */
      }
    }

    const nestedBackend = path.join(cursor, 'apps', 'backend')
    const nestedPackage = path.join(nestedBackend, 'package.json')
    if (existsSync(nestedPackage)) {
      try {
        const parsed = JSON.parse(readFileSync(nestedPackage, 'utf8')) as { name?: string }
        if (parsed?.name === '@openjules/backend') return nestedBackend
      } catch {
        /* ignore */
      }
    }

    const parent = path.dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }

  return process.cwd()
}

export const isSameOrInside = (targetPath: string, parentPath: string): boolean => {
  const target = path.resolve(targetPath)
  const parent = path.resolve(parentPath)
  const relative = path.relative(parent, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export const shellEscape = (input: string): string => `'${input.replace(/'/g, `'"'"'`)}'`

/* -------------------------------------------------------------------------- */
/*  Conversion helpers                                                        */
/* -------------------------------------------------------------------------- */

export const toBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return fallback
  const normalised = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalised)) return true
  if (['false', '0', 'no', 'off'].includes(normalised)) return false
  return fallback
}

export const normalizeConcurrency = (value: unknown): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return Math.floor(parsed)
}

/* -------------------------------------------------------------------------- */
/*  Async control                                                             */
/* -------------------------------------------------------------------------- */

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> => {
  const { maxRetries = 3, baseDelayMs = 1000, label = 'operation' } = options
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn()
    } catch (error: any) {
      lastError = error
      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(2, attempt)
        await sleep(delay)
      }
    }
  }

  throw lastError
}

/* -------------------------------------------------------------------------- */
/*  String / formatting helpers                                               */
/* -------------------------------------------------------------------------- */

export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '…'
}

export const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}
