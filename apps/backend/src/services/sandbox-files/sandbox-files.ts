/**
 * sandbox-files service
 *
 * Exposes the sandbox filesystem for a given mission so the frontend can
 * browse and read files — effectively powering the in-browser IDE.
 *
 * Supported operations (via Feathers custom methods mapped to `find` / `get`):
 *
 *  find({ query: { missionId, path? } })
 *    → returns the file tree (or a subtree if `path` is provided)
 *
 *  get('<missionId>', { query: { path } })
 *    → returns the content of a single file
 */

import { NotFound, BadRequest, GeneralError } from '@feathersjs/errors'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import archiver from 'archiver'
import type { Application, HookContext } from '../../declarations'
import { requireAuth, applyProjectScope } from '../js'
import { isSameOrInside, parseMaybeJson, resolveBackendRoot } from '../../utils'

/* ── Types ─────────────────────────────────────────────────────────── */

export interface FileTreeEntry {
  name: string
  path: string          // relative to repo root
  type: 'file' | 'directory'
  size?: number
  children?: FileTreeEntry[]
}

export interface FileContentResult {
  path: string
  content: string
  size: number
  binary: boolean
}

/* ── Helpers ───────────────────────────────────────────────────────── */

const resolveAbsoluteSandboxRoot = (rawPath: string) => {
  const trimmed = String(rawPath || '').trim()
  if (!trimmed) return path.join(os.homedir(), '.openjules', 'sandboxes')
  if (path.isAbsolute(trimmed)) return trimmed
  return path.join(resolveBackendRoot(), trimmed)
}

/**
 * Locate any sandbox directory for the given missionId inside `root`.
 * Returns the first match (there should normally be exactly one).
 */
const findSandboxDir = async (root: string, missionId: number): Promise<string | null> => {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const prefix = `sandbox-${missionId}-`
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith(prefix)) {
        return path.join(root, entry.name)
      }
    }
  } catch {
    // root may not exist yet
  }
  return null
}

/**
 * Resolve the repo path for a mission, trying the configured sandbox root
 * and the default root.
 */
const resolveRepoPath = async (app: Application, missionId: number, projectId?: number): Promise<string> => {
  const roots = new Set<string>()
  roots.add(resolveAbsoluteSandboxRoot(process.env.OPENJULES_SANDBOX_ROOT || ''))

  if (projectId) {
    try {
      const settingsRows = (await app.service('settings').find({
        query: { key: 'execution', projectId },
        paginate: false,
        provider: undefined
      } as any)) as any[]

      for (const row of settingsRows) {
        const value = parseMaybeJson(row?.value) as any
        if (value?.sandboxRoot) {
          roots.add(resolveAbsoluteSandboxRoot(String(value.sandboxRoot)))
        }
      }
    } catch {
      // ignore
    }
  }

  for (const root of roots) {
    const sandboxDir = await findSandboxDir(root, missionId)
    if (sandboxDir) {
      const repoPath = path.join(sandboxDir, 'repo')
      try {
        await fs.access(repoPath)
        return repoPath
      } catch {
        // repo dir doesn't exist, but sandbox does – return sandbox root
        return sandboxDir
      }
    }
  }

  throw new NotFound(`Sandbox not found for mission ${missionId}`)
}

/**
 * Walk a directory recursively and return a tree structure. 
 * Skips common uninteresting directories.
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  '.next', '.nuxt', 'dist', 'build', '.cache', 'coverage',
  '.tox', '.mypy_cache', '.pytest_cache', '.eggs',
  'target', // Rust / Java
])

const MAX_DEPTH = 15
const MAX_ENTRIES = 5000

const buildFileTree = async (
  rootDir: string,
  relativePath: string = '',
  depth: number = 0,
  counter: { count: number } = { count: 0 }
): Promise<FileTreeEntry[]> => {
  if (depth > MAX_DEPTH || counter.count > MAX_ENTRIES) return []

  const fullPath = relativePath ? path.join(rootDir, relativePath) : rootDir
  let entries: import('fs').Dirent[]

  try {
    entries = await fs.readdir(fullPath, { withFileTypes: true })
  } catch {
    return []
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1
    const bDir = b.isDirectory() ? 0 : 1
    if (aDir !== bDir) return aDir - bDir
    return a.name.localeCompare(b.name)
  })

  const result: FileTreeEntry[] = []

  for (const entry of entries) {
    if (counter.count > MAX_ENTRIES) break

    const entryRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue

      counter.count++
      const children = await buildFileTree(rootDir, entryRelPath, depth + 1, counter)
      result.push({
        name: entry.name,
        path: entryRelPath,
        type: 'directory',
        children
      })
    } else if (entry.isFile()) {
      counter.count++
      let size = 0
      try {
        const stat = await fs.stat(path.join(fullPath, entry.name))
        size = stat.size
      } catch { /* ignore */ }

      result.push({
        name: entry.name,
        path: entryRelPath,
        type: 'file',
        size
      })
    }
  }

  return result
}

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib', '.o', '.a',
  '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
  '.sqlite', '.db', '.pyc', '.class', '.wasm'
])

const isBinaryFile = (filePath: string) => {
  const ext = path.extname(filePath).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB

/* ── Service class ─────────────────────────────────────────────────── */

class SandboxFilesService {
  app!: Application

  setup(app: Application) {
    this.app = app
  }

  /**
   * find({ query: { missionId, path? } })
   * Returns the file tree for the sandbox.
   */
  async find(params: any) {
    const missionId = Number(params?.query?.missionId)
    if (!missionId || !Number.isFinite(missionId)) {
      throw new BadRequest('missionId is required')
    }

    // Verify mission exists and belongs to user's project
    const mission = await this.app.service('missions').get(missionId, {
      provider: undefined,
      user: params.user
    } as any) as any

    const repoPath = await resolveRepoPath(this.app, missionId, mission.projectId)
    const subPath = String(params?.query?.path || '').trim()

    if (subPath) {
      const targetPath = path.resolve(repoPath, subPath)
      if (!isSameOrInside(targetPath, repoPath)) {
        throw new BadRequest('Invalid path — traversal not allowed')
      }
      return buildFileTree(repoPath, subPath)
    }

    return buildFileTree(repoPath)
  }

  /**
   * get(missionId, { query: { path } })
   * Returns the content of a specific file.
   */
  async get(id: any, params: any) {
    const missionId = Number(id)
    if (!missionId || !Number.isFinite(missionId)) {
      throw new BadRequest('missionId (id) is required')
    }

    const filePath = String(params?.query?.path || '').trim()
    if (!filePath) {
      throw new BadRequest('query.path is required to read a file')
    }

    // Verify mission exists and belongs to user's project
    const mission = await this.app.service('missions').get(missionId, {
      provider: undefined,
      user: params.user
    } as any) as any

    const repoPath = await resolveRepoPath(this.app, missionId, mission.projectId)
    const absolutePath = path.resolve(repoPath, filePath)

    if (!isSameOrInside(absolutePath, repoPath)) {
      throw new BadRequest('Invalid path — traversal not allowed')
    }

    // Check file exists
    try {
      await fs.access(absolutePath)
    } catch {
      throw new NotFound(`File not found: ${filePath}`)
    }

    const stat = await fs.stat(absolutePath)

    if (stat.isDirectory()) {
      throw new BadRequest('Path is a directory. Use find() to list directories.')
    }

    if (stat.size > MAX_FILE_SIZE) {
      return {
        path: filePath,
        content: '',
        size: stat.size,
        binary: true,
        error: `File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB.`
      }
    }

    if (isBinaryFile(filePath)) {
      return {
        path: filePath,
        content: '',
        size: stat.size,
        binary: true
      } as FileContentResult
    }

    try {
      const content = await fs.readFile(absolutePath, 'utf-8')
      return {
        path: filePath,
        content,
        size: stat.size,
        binary: false
      } as FileContentResult
    } catch (err: any) {
      throw new GeneralError(`Failed to read file: ${err.message}`)
    }
  }

  /**
   * update(missionId, data: { path, content })
   * Writes content to a file in the sandbox.
   */
  async update(id: any, data: any, params: any) {
    const missionId = Number(id)
    if (!missionId || !Number.isFinite(missionId)) {
      throw new BadRequest('missionId (id) is required')
    }

    const filePath = String(data?.path || '').trim()
    const content = data?.content
    if (!filePath) {
      throw new BadRequest('path is required')
    }
    if (typeof content !== 'string') {
      throw new BadRequest('content must be a string')
    }

    const mission = await this.app.service('missions').get(missionId, {
      provider: undefined,
      user: params.user
    } as any) as any

    const repoPath = await resolveRepoPath(this.app, missionId, mission.projectId)
    const absolutePath = path.resolve(repoPath, filePath)

    if (!isSameOrInside(absolutePath, repoPath)) {
      throw new BadRequest('Invalid path — traversal not allowed')
    }

    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content, 'utf-8')

    return { path: filePath, saved: true }
  }
}

/* ── ZIP download directories to skip ──────────────────────────────── */

const ZIP_SKIP_DIRS = new Set([
  'node_modules', '.git', '__pycache__', '.venv', 'venv',
  '.next', '.nuxt', 'dist', 'build', '.cache', 'coverage',
  '.tox', '.mypy_cache', '.pytest_cache', '.eggs',
  'target', '.idea', '.vscode',
  'vendor', 'bower_components',
])

/* ── Registration ──────────────────────────────────────────────────── */

export const sandboxFiles = (app: Application) => {
  app.use('sandbox-files', new SandboxFilesService())

  app.service('sandbox-files').hooks({
    before: {
      all: [requireAuth, applyProjectScope]
    }
  })

  // ── Raw Koa route for ZIP download ──────────────────────────────
  // GET /sandbox-files/download/:missionId?token=<jwt>
  const koaApp = (app as any)

  koaApp.use(async (ctx: any, next: any) => {
    const match = ctx.path.match(/^\/sandbox-files\/download\/(\d+)$/)
    if (!match || ctx.method !== 'GET') return next()

    const missionId = Number(match[1])

    // Authenticate via query param token or Authorization header
    const token = ctx.query.token || ctx.headers.authorization?.replace('Bearer ', '')
    if (!token) {
      ctx.status = 401
      ctx.body = { error: 'Authentication required' }
      return
    }

    try {
      const authService = app.service('authentication') as any
      const authResult = await authService.verifyAccessToken(token)
      const user = await app.service('users').get(authResult.sub)

      // Fetch mission to verify ownership
      const mission = await app.service('missions').get(missionId, {
        provider: undefined,
        user
      } as any) as any

      const repoPath = await resolveRepoPath(app, missionId, mission.projectId)

      // Create ZIP stream
      const archive = archiver('zip', { zlib: { level: 6 } })

      const folderName = `mission-${missionId}`
      ctx.set('Content-Type', 'application/zip')
      ctx.set('Content-Disposition', `attachment; filename="${folderName}.zip"`)
      ctx.body = archive

      // Add the repo directory, excluding unwanted folders
      archive.glob('**/*', {
        cwd: repoPath,
        dot: true,
        ignore: [...ZIP_SKIP_DIRS].flatMap(dir => [`${dir}/**`, `**/${dir}/**`])
      }, { prefix: folderName + '/' })

      await archive.finalize()
    } catch (err: any) {
      if (err.code === 404 || err.type === 'NotFound') {
        ctx.status = 404
        ctx.body = { error: 'Sandbox not found' }
      } else if (err.code === 401 || err.name === 'NotAuthenticated') {
        ctx.status = 401
        ctx.body = { error: 'Invalid token' }
      } else {
        ctx.status = 500
        ctx.body = { error: err.message || 'Internal server error' }
      }
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    'sandbox-files': SandboxFilesService
  }
}
