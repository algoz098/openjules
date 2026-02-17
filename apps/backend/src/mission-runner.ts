/**
 * Mission Worker — Core job execution engine.
 *
 * Improvements over v2:
 * - Persistent Controller Loop: supports re-planning at any time.
 * - Multi-plan support: keeps history of executed steps.
 * - Per-step retry with exponential backoff.
 * - AI troubleshooting on failure.
 */

import type { Knex } from 'knex'
import type { Application } from './declarations'
import { getSandboxDriver } from './sandbox-driver'
import { getAIProvider, getAIProviderForRole, getPlannerPrompt, generateStepCommand, analyzeStepError } from './ai-provider'
import type { PlanStep, PlanContext, StepCommandContext } from './ai-provider'
import { guardCommand } from './command-guard'
import {
  parseMaybeJson,
  serializeMaybeJson,
  sleep,
  normalizeConcurrency,
  retryWithBackoff,
  truncate
} from './utils'

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_MAX_RETRIES = 2
const STDOUT_TAIL_LENGTH = 5000
const STDERR_TAIL_LENGTH = 3000

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

type MissionStatus =
  | 'QUEUED'
  | 'PLANNING'
  | 'WAITING_PLAN_APPROVAL'
  | 'EXECUTING'
  | 'PAUSED'
  | 'WAITING_INPUT'
  | 'VALIDATING'
  | 'WAITING_REVIEW'
  | 'COMPLETED'
  | 'FAILED'

type MissionRecord = {
  id: number
  projectId: number
  goal: string
  status: MissionStatus
  latest_user_input?: string | null
  latest_agent_question?: string | null
}

type JobRecord = {
  id: number
  projectId: number
  missionId?: number | null
  instruction?: string | null
  payload?: any
  status: string
}

/* -------------------------------------------------------------------------- */
/*  Logging helpers                                                           */
/* -------------------------------------------------------------------------- */

const createMissionLog = async (
  app: Application,
  input: {
    projectId: number
    missionId: number
    stepId?: number
    type: 'thought' | 'command' | 'tool_output' | 'error' | 'metric' | 'agent_question'
    content: unknown
  }
) => {
  await app.service('mission-logs').create({
    projectId: input.projectId,
    missionId: input.missionId,
    stepId: input.stepId,
    type: input.type,
    content: serializeMaybeJson(input.content)
  })
}

const patchMissionStatus = async (
  app: Application,
  missionId: number,
  status: MissionStatus,
  extra: Record<string, unknown> = {}
) => {
  await app.service('missions').patch(missionId, { status, ...extra })
}

/* -------------------------------------------------------------------------- */
/*  Execution gates                                                           */
/* -------------------------------------------------------------------------- */

const waitForMissionStatus = async (app: Application, missionId: number, targetStatus: MissionStatus[]): Promise<MissionRecord> => {
  while (true) {
    const mission = (await app.service('missions').get(missionId, { provider: undefined } as any)) as MissionRecord

    if (targetStatus.includes(mission.status)) return mission
    if (['COMPLETED', 'FAILED'].includes(mission.status)) return mission

    await sleep(1000)
  }
}

const consumeUserInput = async (app: Application, mission: MissionRecord, missionId: number, stepId?: number) => {
  const latest = (await app.service('missions').get(missionId, { provider: undefined } as any)) as MissionRecord
  if (latest.latest_user_input) {
    await createMissionLog(app, {
      projectId: mission.projectId,
      missionId,
      stepId,
      type: 'thought',
      content: `User input received: ${latest.latest_user_input}`
    })
    await app.service('missions').patch(missionId, { latest_user_input: null }, { provider: undefined } as any)
    return latest.latest_user_input
  }
  return null
}


/* -------------------------------------------------------------------------- */
/*  Mission & step management                                                 */
/* -------------------------------------------------------------------------- */

const ensureMission = async (app: Application, job: JobRecord): Promise<MissionRecord> => {
  if (job.missionId) {
    return (await app.service('missions').get(job.missionId)) as MissionRecord
  }

  const created = (await app.service('missions').create({
    projectId: job.projectId,
    trigger_type: 'manual',
    goal: job.instruction || String(job.payload?.instruction || 'Untitled mission'),
    status: 'QUEUED'
  })) as MissionRecord

  await app.service('jobs').patch(job.id, { missionId: created.id })
  return created
}

const removePendingMissionSteps = async (app: Application, mission: MissionRecord) => {
  const existing = (await app.service('mission-steps').find({
    query: { missionId: mission.id, status: 'PENDING' },
    paginate: false
  })) as any[]

  for (const row of existing) {
    await app.service('mission-steps').remove(row.id)
  }
}

const createStepsFromPlan = async (
  app: Application,
  mission: MissionRecord,
  steps: PlanStep[]
) => {
  const existingMax = (await app.service('mission-steps').find({
    query: { missionId: mission.id, $sort: { order_index: -1 }, $limit: 1 },
    paginate: false
  })) as any[]

  const startOrder = existingMax.length > 0 ? existingMax[0].order_index : 0
  const created: any[] = []

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]
    const record = await app.service('mission-steps').create({
      projectId: mission.projectId,
      missionId: mission.id,
      order_index: startOrder + index + 1,
      description: step.description,
      command: step.command || null,
      status: 'PENDING',
      timeout_ms: step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS,
      retryable: step.retryable ?? false,
      max_retries: step.retryable ? DEFAULT_MAX_RETRIES : 0,
      background: step.background ?? false,
      ready_pattern: step.readyPattern || null
    })
    created.push(record)
  }

  return created
}

const loadPendingMissionSteps = async (app: Application, missionId: number) => {
  return (await app.service('mission-steps').find({
    query: { missionId, status: 'PENDING', $sort: { order_index: 1 } },
    paginate: false
  })) as any[]
}

/* -------------------------------------------------------------------------- */
/*  Legacy job log append (backwards compat)                                  */
/* -------------------------------------------------------------------------- */

const appendLegacyJobLog = async (app: Application, jobId: number, message: string) => {
  try {
    const current = (await app.service('jobs').get(jobId)) as any
    const logs = parseMaybeJson(current.logs)
    const list = Array.isArray(logs) ? logs : []
    list.push({ timestamp: new Date().toISOString(), message })
    await app.service('jobs').patch(jobId, { logs: JSON.stringify(list) })
  } catch {
    /* non-critical */
  }
}

/* -------------------------------------------------------------------------- */
/*  AI-powered plan generation                                                */
/* -------------------------------------------------------------------------- */

const generatePlan = async (
  app: Application,
  mission: MissionRecord,
  sandbox: any,
  hasSourceRepository: boolean
): Promise<{ steps: PlanStep[]; reasoning: string; tokenUsage: { prompt: number; completion: number; total: number } }> => {
  let fileTree = ''
  let packageJson = ''

  try {
    const result = await sandbox.command('find . -maxdepth 3 -not -path "*/node_modules/*" -not -path "*/.git/*" | head -100')
    fileTree = result.stdout?.trim() || ''
  } catch {
    /* ignore */
  }

  try {
    packageJson = await sandbox.read_file('package.json')
  } catch {
    /* no package.json */
  }

  const customPrompt = await getPlannerPrompt(app, mission.projectId)

  const planContext: PlanContext = {
    goal: mission.goal,
    packageJson,
    customPrompt,
    hasSourceRepository
  }

  const aiProvider = await getAIProviderForRole(app, mission.projectId, 'planner')

  await createMissionLog(app, {
    projectId: mission.projectId,
    missionId: mission.id,
    type: 'thought',
    content: `Using AI provider: ${aiProvider.name} (${aiProvider.modelName}) for plan generation [role: planner]`
  })

  const planResult = await aiProvider.generatePlan(planContext)

  // Persist AI metadata on mission
  await app.service('missions').patch(
    mission.id,
    {
      plan_reasoning: planResult.reasoning,
      ai_provider: aiProvider.name,
      token_usage_prompt: planResult.tokenUsage.prompt,
      token_usage_completion: planResult.tokenUsage.completion,
      token_usage_total: planResult.tokenUsage.total
    },
    { provider: undefined } as any
  )

  return planResult
}

/* -------------------------------------------------------------------------- */
/*  Step execution with retry and metrics                                     */
/* -------------------------------------------------------------------------- */

const executeStep = async (
  app: Application,
  sandbox: any,
  mission: MissionRecord,
  step: any,
  jobId: number
): Promise<{ exitCode: number; stdout: string; stderr: string; durationMs: number; retries: number }> => {
  const rawCommand = step.command || 'echo "no command"'
  const timeoutMs = step.timeout_ms || DEFAULT_STEP_TIMEOUT_MS
  const maxRetries = step.retryable ? (step.max_retries || DEFAULT_MAX_RETRIES) : 0
  let actualRetries = 0

  const startTime = Date.now()

  // ── Command Guard check ───────────────────────────────────────────
  const verdict = await guardCommand(rawCommand, {
    isBackground: !!step.background,
    app,
    projectId: mission.projectId
  })

  if (!verdict.allowed) {
    const ruleId = verdict.rule || 'unknown'
    const reasonText = (verdict.reason || '').replace(/^\[[^\]]+\]\s*/, '') // strip leading [rule-id]

    await app.service('mission-steps').patch(step.id, {
      status: 'BLOCKED',
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      result_summary: `Blocked by command guard: ${verdict.reason}`
    })

    await createMissionLog(app, {
      projectId: mission.projectId,
      missionId: mission.id,
      stepId: step.id,
      type: 'error',
      content: `🛡️ **Comando bloqueado** (regra: \`${ruleId}\`)\n\n**Motivo:** ${reasonText}\n\n**Comando:**\n\`\`\`\n${truncate(rawCommand, 300)}\n\`\`\``
    })

    return {
      exitCode: -2,
      stdout: '',
      stderr: `Command blocked: ${verdict.reason}`,
      durationMs: Date.now() - startTime,
      retries: 0
    }
  }

  const command = verdict.sanitised

  // ── Auto-promote to background if guard detected a long-running command ──
  if (verdict.promotedToBackground && !step.background) {
    step.background = true
    step.ready_pattern = verdict.suggestedReadyPattern || 'listening on|ready|started'
    await app.service('mission-steps').patch(step.id, {
      background: true,
      ready_pattern: step.ready_pattern
    })
    await createMissionLog(app, {
      projectId: mission.projectId,
      missionId: mission.id,
      stepId: step.id,
      type: 'thought',
      content: `Command auto-promoted to background by guard: "${truncate(command, 100)}" (readyPattern: "${step.ready_pattern}")`
    })
  }

  await app.service('mission-steps').patch(step.id, {
    status: 'IN_PROGRESS',
    started_at: new Date().toISOString()
  })

  await createMissionLog(app, {
    projectId: mission.projectId,
    missionId: mission.id,
    stepId: step.id,
    type: 'command',
    content: `Executing step ${step.order_index}: ${command} (timeout: ${timeoutMs}ms, retryable: ${!!step.retryable}${step.background ? `, background, readyPattern: "${step.ready_pattern || ''}"` : ''})`
  })

  let lastResult: { stdout: string; stderr: string; exitCode: number } = { stdout: '', stderr: '', exitCode: -1 }

  const attemptExecution = async () => {
    if (step.background && step.ready_pattern) {
      return await sandbox.backgroundCommand(command, step.ready_pattern, undefined, timeoutMs)
    }
    return await sandbox.command(command, undefined, timeoutMs)
  }

  try {
    if (maxRetries > 0) {
      lastResult = await retryWithBackoff(attemptExecution, {
        maxRetries,
        baseDelayMs: 2000,
        label: `step-${step.order_index}`
      })
    } else {
      lastResult = await attemptExecution()
    }
  } catch (error: any) {
    lastResult = {
      stdout: '',
      stderr: error?.message || 'Step execution failed',
      exitCode: -1
    }
  }

  const durationMs = Date.now() - startTime

  const stepPatch: Record<string, unknown> = {
    status: lastResult.exitCode === 0 ? 'DONE' : 'FAILED',
    exit_code: lastResult.exitCode,
    retry_count: actualRetries,
    duration_ms: durationMs,
    finished_at: new Date().toISOString(),
    result_summary: `exit=${lastResult.exitCode} duration=${durationMs}ms`,
    stdout_tail: truncate(lastResult.stdout, STDOUT_TAIL_LENGTH),
    stderr_tail: truncate(lastResult.stderr, STDERR_TAIL_LENGTH)
  }

  await app.service('mission-steps').patch(step.id, stepPatch)

  await createMissionLog(app, {
    projectId: mission.projectId,
    missionId: mission.id,
    stepId: step.id,
    type: 'tool_output',
    content: {
      exitCode: lastResult.exitCode,
      durationMs,
      stdout: truncate(lastResult.stdout, STDOUT_TAIL_LENGTH),
      stderr: truncate(lastResult.stderr, STDERR_TAIL_LENGTH)
    }
  })

  return {
    exitCode: lastResult.exitCode,
    stdout: lastResult.stdout,
    stderr: lastResult.stderr,
    durationMs,
    retries: actualRetries
  }
}

/* -------------------------------------------------------------------------- */
/*  Core job processor                                                        */
/* -------------------------------------------------------------------------- */

export const runMission = async (app: Application, jobId: number) => {
  const db = app.get('sqliteClient')

  const job = (await app.service('jobs').get(jobId)) as JobRecord
  if (!job) return

  const missionStartTime = Date.now()
  const missionTokenUsage: Record<string, { prompt: number; completion: number; total: number }> = {
    total: { prompt: 0, completion: 0, total: 0 }
  }

  const trackUsage = async (role: string, usage: { prompt: number; completion: number; total: number }) => {
    if (!missionTokenUsage[role]) {
      missionTokenUsage[role] = { prompt: 0, completion: 0, total: 0 }
    }
    missionTokenUsage[role].prompt += usage.prompt || 0
    missionTokenUsage[role].completion += usage.completion || 0
    missionTokenUsage[role].total += usage.total || 0

    missionTokenUsage.total.prompt += usage.prompt || 0
    missionTokenUsage.total.completion += usage.completion || 0
    missionTokenUsage.total.total += usage.total || 0

    await app.service('missions').patch(mission.id, {
      token_usage: missionTokenUsage
    })
  }

  await app.service('jobs').patch(job.id, {
    status: 'running',
    started_at: db.fn.now(),
    heartbeat_at: db.fn.now()
  })

  const mission = await ensureMission(app, job)
  const sandboxDriver = await getSandboxDriver(app, mission.projectId)
  const sandbox = await sandboxDriver.spawn({
    missionId: mission.id,
    projectId: mission.projectId,
    jobId: job.id
  })

  let heartbeatTimer: NodeJS.Timeout | undefined
  let currentStepId: number | undefined

  sandbox.streamLogs((chunk: string) => {
    void createMissionLog(app, {
      projectId: mission.projectId,
      missionId: mission.id,
      stepId: currentStepId,
      type: 'tool_output',
      content: chunk
    })
  })

  try {
    heartbeatTimer = setInterval(() => {
      void app.service('jobs').patch(job.id, { heartbeat_at: db.fn.now() })
    }, 2000)

    const repoUrl = job.payload?.repo || ''
    const hasSourceRepository = !!repoUrl && repoUrl.trim().length > 0

    // Initialise sandbox - usually empty unless persisted
    await sandbox.init({})

    if (hasSourceRepository) {
      await createMissionLog(app, {
        projectId: mission.projectId,
        missionId: mission.id,
        type: 'thought',
        content: `Cloning repository: ${repoUrl}`
      })
      await sandbox.command(`git clone "${repoUrl}" .`, undefined, 120000)
    }

    // Mark mission as started (only if not already running)
    const initialMission = await app.service('missions').get(mission.id)
    if (['QUEUED'].includes(initialMission.status)) {
      await patchMissionStatus(app, mission.id, 'PLANNING', { started_at: new Date().toISOString() })
    }

    // ── Main Controller Loop ───────────────────────────────────────────
    while (true) {
      const current = (await app.service('missions').get(mission.id, { provider: undefined } as any)) as MissionRecord

      if (['COMPLETED', 'FAILED'].includes(current.status)) break

      // --- STAGE: PLANNING ---
      if (current.status === 'PLANNING') {
        await createMissionLog(app, {
          projectId: mission.projectId,
          missionId: mission.id,
          type: 'thought',
          content: 'Generating execution plan based on current state...'
        })

        const planResult = await generatePlan(app, mission, sandbox, hasSourceRepository)
        await trackUsage('planner', planResult.tokenUsage)

        // Remove only future steps, keep the history of done/failed ones
        await removePendingMissionSteps(app, mission)
        await createStepsFromPlan(app, mission, planResult.steps)

        await patchMissionStatus(app, mission.id, 'WAITING_PLAN_APPROVAL')
        await createMissionLog(app, {
          projectId: mission.projectId,
          missionId: mission.id,
          type: 'thought',
          content: 'Plan ready. Waiting for user approval.'
        })
      }

      // --- STAGE: WAITING_PLAN_APPROVAL ---
      if (current.status === 'WAITING_PLAN_APPROVAL') {
        // Wait for user to approve (EXECUTING) or send more input (which goes back to PLANNING)
        await waitForMissionStatus(app, mission.id, ['EXECUTING', 'PLANNING'])
        continue
      }

      // --- STAGE: EXECUTING ---
      if (current.status === 'EXECUTING') {
        const pendingSteps = await loadPendingMissionSteps(app, mission.id)
        if (pendingSteps.length === 0) {
          // No more steps? Go to validation
          await patchMissionStatus(app, mission.id, 'VALIDATING')
          continue
        }

        // Gather workspace context for the coder role (once per execution wave)
        let coderFileTree = ''
        let coderPackageJson = ''
        try {
          const ftResult = await sandbox.command('find . -maxdepth 3 -not -path "*/node_modules/*" -not -path "*/.git/*" | head -100')
          coderFileTree = ftResult.stdout?.trim() || ''
        } catch { /* ignore */ }
        try {
          coderPackageJson = await sandbox.read_file('package.json')
        } catch { /* ignore */ }

        const allStepDescriptions = pendingSteps.map((s: any) => s.description as string)
        const previousOutputs: string[] = []

        for (let index = 0; index < pendingSteps.length; index += 1) {
          const step = pendingSteps[index]

          // Re-check status before each step (might have been paused/replanned)
          const latest = await waitForMissionStatus(app, mission.id, ['EXECUTING', 'PLANNING', 'PAUSED', 'WAITING_INPUT'])
          if (latest.status !== 'EXECUTING') break // yield to main loop

          await consumeUserInput(app, mission, mission.id, step.id)
          currentStepId = step.id

          // Generate command if empty
          if (!step.command) {
            const coderProvider = await getAIProviderForRole(app, mission.projectId, 'coder')
            const cmdContext: StepCommandContext = {
              missionGoal: mission.goal,
              stepDescription: step.description,
              stepIndex: index,
              totalSteps: pendingSteps.length,
              allStepDescriptions,
              previousStepsOutput: previousOutputs.length ? previousOutputs.join('\n---\n') : undefined,
              fileTree: coderFileTree,
              packageJson: coderPackageJson,
              background: !!step.background,
              readyPattern: step.ready_pattern || undefined
            }

            const cmdResult = await generateStepCommand(coderProvider, cmdContext)
            await trackUsage('coder', cmdResult.tokenUsage)

            step.command = cmdResult.command
            await app.service('mission-steps').patch(step.id, { command: cmdResult.command })

            await createMissionLog(app, {
              projectId: mission.projectId,
              missionId: mission.id,
              stepId: step.id,
              type: 'thought',
              content: `AI generated command: \`${truncate(cmdResult.command, 200)}\``
            })
          }

          const result = await executeStep(app, sandbox, mission, step, job.id)

          if (result.exitCode !== 0) {
            // Handle FAILURE (executeStep already patched the step status)
            // If troubleshooting or retry is needed, we could do it here.
            // For simplicity, if it fails, we transition mission to FAILED and let user continue via chat.
            if (step.status === 'FAILED') {
              await patchMissionStatus(app, mission.id, 'FAILED', { fail_reason: `Step ${step.order_index} failed.` })
              break
            }
          }

          previousOutputs.push(`${step.description}: exit=${result.exitCode}`)
          if (previousOutputs.length > 5) previousOutputs.shift()
        }
      }

      // --- STAGE: VALIDATING ---
      if (current.status === 'VALIDATING') {
        const patchContent = await sandbox.create_patch()
        const totalDurationMs = Date.now() - missionStartTime

        await patchMissionStatus(app, mission.id, 'WAITING_REVIEW', {
          finished_at: new Date().toISOString(),
          total_duration_ms: totalDurationMs
        })

        await app.service('jobs').patch(job.id, {
          status: 'waiting_review',
          finished_at: db.fn.now(),
          result: { patch: patchContent, durationMs: totalDurationMs }
        })
      }

      // Yield
      if (['PAUSED', 'WAITING_INPUT', 'WAITING_REVIEW'].includes(current.status)) {
        await sleep(2000)
      }
    }
  } catch (error: any) {
    const reason = error?.message || 'Unknown runner error'
    await patchMissionStatus(app, mission.id, 'FAILED', { fail_reason: reason })
    await createMissionLog(app, {
      projectId: mission.projectId,
      missionId: mission.id,
      type: 'error',
      content: reason
    })
    await app.service('jobs').patch(job.id, { status: 'failed', last_error: reason })
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    await sandbox.destroy()
    await sandboxDriver.teardown(sandbox.id)
  }
}
