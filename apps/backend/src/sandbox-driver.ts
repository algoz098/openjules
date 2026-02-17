import type { Application } from './declarations'
import { createHash, randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import Docker from 'dockerode'
import {
  resolveBackendRoot,
  isSameOrInside,
  parseMaybeJson
} from './utils'

export type SandboxDriverName = 'docker'

export interface ExecutionResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface SandboxInstance {
  id: string
  workspacePath: string
  repoPath: string
  init(config: {}): Promise<void>
  command(cmd: string, workdir?: string, timeoutMs?: number): Promise<ExecutionResult>
  /**
   * Run a long-running command in the background. Resolves once `readyPattern`
   * is matched in stdout/stderr (the process keeps running). The sandbox tracks
   * the child so it is killed on `destroy()`.
   */
  backgroundCommand(cmd: string, readyPattern: string, workdir?: string, timeoutMs?: number): Promise<ExecutionResult>
  /** Kill all background child processes. Called automatically on teardown. */
  destroy(): Promise<void>
  streamLogs(onLog: (log: string) => void): void
  write_file(filePath: string, content: string): Promise<void>
  read_file(filePath: string): Promise<string>
  create_patch(): Promise<string>
}

export interface SandboxDriver {
  name: SandboxDriverName
  spawn(config: { missionId: number; projectId: number; jobId: number }): Promise<SandboxInstance>
  teardown(instanceId: string): Promise<void>
}

type ExecutionSettings = {
  sandboxRoot?: string
  persistSandbox?: boolean
  sandboxTtlHours?: number
  defaultStepTimeoutMs?: number
  maxRetries?: number
  docker?: {
    image?: string
    socketPath?: string
    cpuLimit?: number      // fractional CPUs e.g. 1.5
    memLimitMb?: number    // memory in MB
    pidsLimit?: number     // max PIDs
    networkMode?: string   // 'none' | 'bridge' | 'host'
  }
}

const resolveDefaultSandboxRoot = () => {
  // Use ~/.openjules/sandboxes/ instead of being inside the npm workspace tree.
  return path.join(os.homedir(), '.openjules', 'sandboxes')
}

const shouldPersistSandbox = () => {
  const flag = String(process.env.OPENJULES_SANDBOX_PERSIST || 'true').trim().toLowerCase()
  return flag !== 'false' && flag !== '0' && flag !== 'no'
}

const toAbsoluteSandboxPath = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return resolveDefaultSandboxRoot()
  if (path.isAbsolute(trimmed)) return trimmed
  return path.join(resolveBackendRoot(), trimmed)
}

const readExecutionSettings = async (app: Application, projectId: number): Promise<ExecutionSettings> => {
  try {
    const setting = await app.service('settings').find({
      query: { key: 'execution', projectId, $limit: 1 },
      paginate: false
    })

    const row = Array.isArray(setting) ? setting[0] : (setting as any)?.data?.[0]
    const value = parseMaybeJson(row?.value)
    if (value && typeof value === 'object') {
      return value as ExecutionSettings
    }
  } catch {
    // fallback to defaults
  }

  return {}
}

const resolveSandboxOptions = async (app: Application, projectId: number) => {
  const execution = await readExecutionSettings(app, projectId)

  const envRoot = process.env.OPENJULES_SANDBOX_ROOT
  const configuredRoot = String(execution.sandboxRoot || '').trim()
  const root = toAbsoluteSandboxPath(envRoot?.trim() || configuredRoot || resolveDefaultSandboxRoot())

  const envPersist = process.env.OPENJULES_SANDBOX_PERSIST
  const persist = envPersist !== undefined ? (String(envPersist) !== 'false' && String(envPersist) !== '0') : (execution.persistSandbox !== false)

  return { root, persist }
}

class DockerSandboxInstance implements SandboxInstance {
  id: string
  workspacePath: string
  repoPath: string
  private readonly containerPath = '/workspace/repo'
  private onLog?: (log: string) => void
  private readonly container: any
  private readonly containerImage: string
  private shell: string = 'sh'

  constructor(input: { id: string; workspacePath: string; repoPath: string; container: any; image: string }) {
    this.id = input.id
    this.workspacePath = input.workspacePath
    this.repoPath = input.repoPath
    this.container = input.container
    this.containerImage = input.image
  }

  streamLogs(onLog: (log: string) => void): void {
    this.onLog = onLog
  }

  // Convert host path to container path
  private toContainerWorkdir(hostWorkdir?: string) {
    if (!hostWorkdir) return this.containerPath
    if (!hostWorkdir.startsWith(this.workspacePath)) return this.containerPath

    const relative = path.relative(this.workspacePath, hostWorkdir)
    const normalized = relative.replace(/\\/g, '/')
    return `/workspace/${normalized}`
  }

  async init(config: {}): Promise<void> {
    try {
      const bashCheck = await this.command('command -v bash')
      if (bashCheck.exitCode === 0) {
        this.shell = 'bash'
        this.onLog?.('Bash detected. Enabled for session.\n')
      }
    } catch { /* ignore */ }

    await fs.mkdir(this.repoPath, { recursive: true })

    // Ensure basic tools like git are installed
    // This is a "best effort" using apt-get if available (Debian/Ubuntu/node-slim images)
    try {
      const checkGit = await this.command('git --version')
      if (checkGit.exitCode !== 0) {
        this.onLog?.('Git not found. Installing basic dependencies...\n')

        // Check for apk (Alpine)
        const checkApk = await this.command('which apk')
        if (checkApk.exitCode === 0) {
          await this.command('apk add --no-cache git curl wget procps bash')
        } else {
          // Check for apt-get (Debian/Ubuntu)
          const checkApt = await this.command('which apt-get')
          if (checkApt.exitCode === 0) {
            await this.command('apt-get update && apt-get install -y git curl wget procps bash')
          } else {
            this.onLog?.('Warning: Could not detect package manager (apk or apt-get). Git installation skipped.\n')
          }
        }
      }
    } catch (err: any) {
      this.onLog?.(`Warning: Failed to install system dependencies: ${err.message}\n`)
    }

    const initResult = await this.command(
      'git init && git config user.email "openjules@local" && git config user.name "OpenJules"'
    )
    if (initResult.exitCode !== 0) {
      throw new Error(`Failed to initialize empty sandbox repository: ${initResult.stderr || initResult.stdout}`)
    }

    this.onLog?.(`Docker sandbox ready (${this.containerImage}) at ${this.containerPath}\n`)
  }

  async command(cmd: string, workdir?: string, timeoutMs?: number): Promise<ExecutionResult> {
    const exec = await this.container.exec({
      AttachStdout: true,
      AttachStderr: true,
      Cmd: [this.shell || 'sh', '-lc', cmd],
      WorkingDir: this.toContainerWorkdir(workdir)
    })

    const stream = await exec.start({ Detach: false, Tty: false })
    let stdout = ''
    let stderr = ''

    await new Promise<void>((resolve, reject) => {
      this.container.modem.demuxStream(
        stream,
        {
          write: (chunk: Buffer | string) => {
            const text = chunk.toString()
            stdout += text
            this.onLog?.(text)
          }
        },
        {
          write: (chunk: Buffer | string) => {
            const text = chunk.toString()
            stderr += text
            this.onLog?.(text)
          }
        }
      )
      stream.on('end', () => resolve())
      stream.on('error', (error: Error) => reject(error))
    })

    const inspect = await exec.inspect()
    return {
      stdout,
      stderr,
      exitCode: inspect?.ExitCode ?? -1
    }
  }

  async backgroundCommand(cmd: string, readyPattern: string, workdir?: string, timeoutMs?: number): Promise<ExecutionResult> {
    const id = randomUUID().replace(/-/g, '')
    const logFile = `/tmp/bg-${id}.log`

    // Create a safe wrapper to run the command in background, detached, with output redirection
    const escapedCmd = cmd.replace(/'/g, "'\\''")
    const shell = this.shell || 'sh'
    const wrapper = `nohup ${shell} -c '${escapedCmd}' > "${logFile}" 2>&1 & echo $! > "${logFile}.pid"`

    // 1. Execute the wrapper (returns immediately)
    const startRes = await this.command(wrapper, workdir)
    if (startRes.exitCode !== 0) {
      throw new Error(`Failed to spawn background command: ${startRes.stderr || startRes.stdout}`)
    }

    // 2. Monitor valid log file for ready pattern
    const regex = new RegExp(readyPattern, 'i')
    const effectiveTimeout = timeoutMs || 120_000

    // Use tail -f to stream changes from the start
    const tailExec = await this.container.exec({
      Cmd: ['tail', '-n', '+1', '-f', logFile],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false
    })

    const stream = await tailExec.start({ Detach: false, Tty: false })
    let fullLog = ''

    return new Promise<ExecutionResult>((resolve, reject) => {
      let settled = false
      let pidCheckInterval: any

      const cleanup = () => {
        settled = true
        clearTimeout(timer)
        clearInterval(pidCheckInterval)
        try { stream.destroy() } catch { /* ignore */ }
      }

      const timer = setTimeout(() => {
        if (settled) return
        cleanup()
        reject(new Error(`Timeout (${effectiveTimeout}ms) waiting for ready pattern "${readyPattern}" in command logs.`))
      }, effectiveTimeout)

      pidCheckInterval = setInterval(async () => {
        if (settled) return
        // Periodically check if the process is still alive.
        // If it dies, fail fast instead of waiting for timeout.
        try {
          const pidResult = await this.command(`kill -0 $(cat "${logFile}.pid")`)
          if (settled) return

          if (pidResult.exitCode !== 0) {
            cleanup()
            const errorMsg = `Background process died unexpectedly.\nLast Logs:\n${fullLog.slice(-2000)}`
            reject(new Error(errorMsg))
          }
        } catch { /* ignore check errors */ }
      }, 2000)

      const check = (chunk: Buffer | string) => {
        if (settled) return
        const text = chunk.toString()
        fullLog += text
        // Also stream to main log
        this.onLog?.(text)

        if (regex.test(fullLog)) {
          cleanup()
          resolve({ stdout: fullLog, stderr: '', exitCode: 0 })
        }
      }

      this.container.modem.demuxStream(
        stream,
        { write: check },
        { write: check }
      )

      stream.on('end', () => {
        if (!settled) {
          cleanup()
          // If tail ends correctly but we haven't found the pattern, it's an error?
          // Usually tail -f doesn't end unless killed.
          // If it ends, maybe the file was deleted or container died.
          reject(new Error(`Log monitoring stream ended before ready pattern matched.`))
        }
      })

      stream.on('error', (err: any) => {
        if (!settled) {
          cleanup()
          reject(err)
        }
      })
    })
  }

  async destroy(): Promise<void> {
    // In Docker mode, background processes live inside the container.
    // They are killed when the container is stopped/removed during teardown.
  }

  async write_file(filePath: string, content: string): Promise<void> {
    const absolutePath = path.join(this.repoPath, filePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, content, 'utf8')
  }

  async read_file(filePath: string): Promise<string> {
    const absolutePath = path.join(this.repoPath, filePath)
    return fs.readFile(absolutePath, 'utf8')
  }

  async create_patch(): Promise<string> {
    const diff = await this.command('git diff --no-color -- .')
    return diff.stdout
  }
}

class DockerDriver implements SandboxDriver {
  name: SandboxDriverName = 'docker'
  private readonly instances = new Map<string, { instance: DockerSandboxInstance; container: any }>()
  private readonly persistByInstance = new Map<string, boolean>()
  private readonly app: Application

  constructor(app: Application) {
    this.app = app
  }

  private getDockerClient() {
    return new Docker({
      socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock'
    })
  }

  private async resolveImage(app: Application, projectId: number) {
    try {
      const setting = await app
        .service('settings')
        .find({ query: { key: 'execution', projectId, $limit: 1 }, paginate: false })

      const row = Array.isArray(setting) ? setting[0] : (setting as any)?.data?.[0]
      const value = parseMaybeJson(row?.value) as any
      const image = String(value?.docker?.image || '').trim()
      if (image) return image
    } catch {
      // fallback
    }

    return process.env.OPENJULES_DOCKER_IMAGE || 'node:20-bookworm-slim'
  }

  private async resolveDockerConfig(app: Application, projectId: number): Promise<{
    cpuLimit?: number
    memLimitMb?: number
    pidsLimit?: number
    networkMode?: string
  }> {
    try {
      const setting = await app
        .service('settings')
        .find({ query: { key: 'execution', projectId, $limit: 1 }, paginate: false })

      const row = Array.isArray(setting) ? setting[0] : (setting as any)?.data?.[0]
      const value = parseMaybeJson(row?.value) as any
      const docker = value?.docker || {}

      return {
        cpuLimit: docker.cpuLimit ? Number(docker.cpuLimit) : undefined,
        memLimitMb: docker.memLimitMb ? Number(docker.memLimitMb) : undefined,
        pidsLimit: docker.pidsLimit ? Number(docker.pidsLimit) : undefined,
        networkMode: docker.networkMode ? String(docker.networkMode) : undefined
      }
    } catch {
      return {}
    }
  }

  private async pullImageIfNeeded(docker: Docker, image: string) {
    try {
      await docker.getImage(image).inspect()
      return
    } catch {
      // pull below
    }

    const stream = await docker.pull(image)
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (error: Error | null) => {
        if (error) return reject(error)
        resolve()
      })
    })
  }

  async spawn(config: { missionId: number; projectId: number; jobId: number }): Promise<SandboxInstance> {
    const options = await resolveSandboxOptions(this.app, config.projectId)
    const sandboxRoot = options.root

    // Hash based instance ID
    const hash = createHash('sha1').update(`${config.projectId}-${config.missionId}-${Date.now()}`).digest('hex').slice(0, 8)
    const instanceId = `sandbox-${config.missionId}-${hash}-${randomUUID().slice(0, 8)}`
    const workspacePath = path.join(sandboxRoot, instanceId)
    const repoPath = path.join(workspacePath, 'repo')

    await fs.mkdir(workspacePath, { recursive: true })
    await fs.mkdir(repoPath, { recursive: true })

    const docker = this.getDockerClient()
    const image = await this.resolveImage(this.app, config.projectId)
    const dockerCfg = await this.resolveDockerConfig(this.app, config.projectId)

    await this.pullImageIfNeeded(docker, image)

    const container = await docker.createContainer({
      Image: image,
      Cmd: ['sh', '-lc', 'while true; do sleep 60; done'], // keep alive
      WorkingDir: '/workspace/repo',
      Tty: false,
      HostConfig: {
        Binds: [
          // Bind the workspace path on host to /workspace inside container
          `${workspacePath}:/workspace`
        ],
        AutoRemove: false,
        ...(dockerCfg.cpuLimit ? { NanoCpus: Math.round(dockerCfg.cpuLimit * 1e9) } : {}),
        ...(dockerCfg.memLimitMb ? { Memory: dockerCfg.memLimitMb * 1024 * 1024 } : {}),
        ...(dockerCfg.pidsLimit ? { PidsLimit: dockerCfg.pidsLimit } : {}),
        ...(dockerCfg.networkMode ? { NetworkMode: dockerCfg.networkMode } : {})
      },
      Labels: {
        'openjules.missionId': String(config.missionId),
        'openjules.jobId': String(config.jobId)
      }
    })

    await container.start()

    const instance = new DockerSandboxInstance({
      id: instanceId,
      workspacePath,
      repoPath,
      container,
      image
    })

    this.instances.set(instanceId, { instance, container })
    this.persistByInstance.set(instanceId, !!options.persist)
    return instance
  }

  async teardown(instanceId: string): Promise<void> {
    const tracked = this.instances.get(instanceId)
    if (tracked) {
      // 1. Destroy logic (stop container)
      try {
        await tracked.container.stop({ t: 1 })
      } catch { /* ignore */ }
      try {
        await tracked.container.remove({ force: true })
      } catch { /* ignore */ }

      // 2. Cleanup files if not persisting
      const persist = this.persistByInstance.get(instanceId) ?? shouldPersistSandbox()
      if (!persist) {
        try {
          // This removes the host directory that was bound
          await fs.rm(tracked.instance.workspacePath, { recursive: true, force: true })
        } catch { /* ignore */ }
      }

      this.instances.delete(instanceId)
      this.persistByInstance.delete(instanceId)
    }
  }
}

export const getSandboxDriver = async (app: Application, projectId: number): Promise<SandboxDriver> => {
  return new DockerDriver(app)
}
