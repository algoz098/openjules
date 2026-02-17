import { BadRequest } from '@feathersjs/errors'
import type { HookContext } from '@feathersjs/feathers'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseMaybeJson, resolveBackendRoot, isSameOrInside } from '../../utils'

const resolveAbsoluteSandboxRoot = (rawPath: string) => {
  const trimmed = String(rawPath || '').trim()
  if (!trimmed) return path.join(os.homedir(), '.openjules', 'sandboxes')
  if (path.isAbsolute(trimmed)) return trimmed
  return path.join(resolveBackendRoot(), trimmed)
}

const collectSandboxPathsFromLogs = (rows: any[]) => {
  const parsed = new Set<string>()
  for (const row of rows) {
    const content = parseMaybeJson(row?.content)
    if (typeof content !== 'string') continue
    const match = content.match(/^Workspace sandbox:\s*(.+)$/i)
    if (!match?.[1]) continue
    parsed.add(path.resolve(match[1].trim()))
  }
  return parsed
}

const collectSandboxPathsFromRoot = async (root: string, missionId: number) => {
  const found = new Set<string>()
  try {
    const entries = await fs.readdir(root, { withFileTypes: true })
    const prefix = `sandbox-${missionId}-`
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith(prefix)) continue
      found.add(path.resolve(path.join(root, entry.name)))
    }
  } catch {
    // root may not exist
  }
  return found
}

export const cleanupMissionSandboxBeforeRemove = async (context: HookContext) => {
  if (context.method !== 'remove') return context
  if (context.id === null || context.id === undefined) {
    throw new BadRequest('Bulk mission remove is not allowed')
  }

  const missionId = Number(context.id)
  if (!Number.isFinite(missionId) || missionId <= 0) {
    throw new BadRequest('Invalid mission id')
  }

  const mission = (await context.app.service('missions').get(missionId, {
    provider: undefined,
    user: context.params.user
  } as any)) as any

  const settingsRows = (await context.app.service('settings').find({
    query: { key: 'execution', projectId: mission.projectId },
    paginate: false,
    provider: undefined,
    user: context.params.user
  } as any)) as any[]

  const roots = new Set<string>()
  roots.add(resolveAbsoluteSandboxRoot(process.env.OPENJULES_SANDBOX_ROOT || ''))

  for (const row of settingsRows) {
    const value = parseMaybeJson(row?.value) as any
    const configuredRoot = value?.sandboxRoot
    if (configuredRoot) {
      roots.add(resolveAbsoluteSandboxRoot(String(configuredRoot)))
    }
  }

  const logs = (await context.app.service('mission-logs').find({
    query: { missionId, $limit: 1000 },
    paginate: false,
    provider: undefined,
    user: context.params.user
  } as any)) as any[]

  const toDelete = new Set<string>()
  for (const candidate of collectSandboxPathsFromLogs(logs)) {
    if ([...roots].some((root) => isSameOrInside(candidate, root))) {
      toDelete.add(candidate)
    }
  }

  for (const root of roots) {
    const matches = await collectSandboxPathsFromRoot(root, missionId)
    for (const candidate of matches) {
      if (isSameOrInside(candidate, root)) {
        toDelete.add(candidate)
      }
    }
  }

  for (const folder of toDelete) {
    await fs.rm(folder, { recursive: true, force: true })
  }

  return context
}

export const normalizeMissionCreate = async (context: HookContext) => {
  const data = (context.data as any) || {}
  const goal = String(data.goal || data.instruction || '').trim()
  if (!goal) throw new BadRequest('Mission goal is required')

  context.data = {
    ...data,
    goal,
    trigger_type: data.trigger_type || 'manual',
    status: data.status || 'QUEUED'
  }

  return context
}

export const enqueueMissionJob = async (context: HookContext) => {
  const mission = (context.result || context.data) as any
  if (!mission?.id) return context

  // Enqueue if status is PLANNING or QUEUED
  // (EXECUTING is handled by the runner itself after approval)
  const isPendingStart = ['PLANNING', 'QUEUED'].includes(mission.status)
  if (!isPendingStart) return context

  if (context.method === 'patch') {
    // Check if there's already an active job for this mission to avoid duplicates
    const existingJobs = await context.app.service('jobs').find({
      query: {
        missionId: mission.id,
        status: { $in: ['pending', 'running'] },
        $limit: 1
      },
      paginate: false,
      provider: undefined
    })
    if (existingJobs.length > 0) return context
  }

  await context.app.service('jobs').create(
    {
      missionId: mission.id,
      instruction: mission.goal,
      type: 'mission',
      status: 'pending',
      payload: {
        repo: mission.repoUrl || '',
        branch: mission.baseBranch || ''
      },
      projectId: mission.projectId
    },
    { provider: undefined, user: context.params.user } as any
  )

  return context
}

export const enforceMissionReviewAction = async (context: HookContext) => {
  if (context.method !== 'patch' || !context.id) return context

  const reviewAction = String((context.data as any)?.reviewAction || '').toLowerCase()
  const planAction = String((context.data as any)?.planAction || '').toLowerCase()
  const controlAction = String((context.data as any)?.controlAction || '').toLowerCase()

  if (!reviewAction && !planAction && !controlAction) return context

  const mission = (await context.app.service('missions').get(context.id, {
    provider: undefined,
    user: context.params.user
  } as any)) as any

  if (reviewAction) {
    if (!['approve', 'reject'].includes(reviewAction)) {
      throw new BadRequest('reviewAction must be approve or reject')
    }

    if (mission.status !== 'WAITING_REVIEW') {
      throw new BadRequest('Mission is not waiting review')
    }

    if (reviewAction === 'approve') {
      context.data = {
        status: 'COMPLETED',
        reviewed_at: new Date().toISOString(),
        fail_reason: null,
        result_summary: (context.data as any)?.result_summary || 'Mission approved by human reviewer.'
      }
    } else {
      context.data = {
        status: 'FAILED',
        reviewed_at: new Date().toISOString(),
        fail_reason: (context.data as any)?.reason || 'Mission rejected by reviewer.'
      }
    }

    ; (context.params as any).__reviewAction = reviewAction
    return context
  }

  if (planAction) {
    if (!['approve', 'reject'].includes(planAction)) {
      throw new BadRequest('planAction must be approve or reject')
    }
    if (mission.status !== 'WAITING_PLAN_APPROVAL') {
      throw new BadRequest('Mission plan is not waiting approval')
    }

    if (planAction === 'approve') {
      context.data = {
        status: 'EXECUTING',
        fail_reason: null
      }
    } else {
      context.data = {
        status: 'FAILED',
        fail_reason: (context.data as any)?.reason || 'Mission plan rejected by reviewer.'
      }
    }

    ; (context.params as any).__planAction = planAction
    return context
  }

  if (!['pause', 'resume', 'input'].includes(controlAction)) {
    throw new BadRequest('controlAction must be pause, resume or input')
  }

  if (controlAction === 'pause') {
    if (['COMPLETED', 'FAILED'].includes(mission.status)) {
      throw new BadRequest('Mission is already finished')
    }
    context.data = {
      status: 'PAUSED'
    }
      ; (context.params as any).__controlAction = controlAction
    return context
  }

  if (controlAction === 'resume') {
    if (!['PAUSED', 'WAITING_INPUT'].includes(mission.status)) {
      throw new BadRequest('Mission is not paused or waiting input')
    }
    context.data = {
      status: 'EXECUTING'
    }
      ; (context.params as any).__controlAction = controlAction
    return context
  }

  const message = String((context.data as any)?.message || '').trim()
  if (!message) {
    throw new BadRequest('message is required for controlAction=input')
  }

  context.data = {
    latest_user_input: message,
    latest_agent_question: null,
    status: 'PLANNING'
  }
    ; (context.params as any).__controlAction = controlAction
  return context
}

export const syncMissionJobStatus = async (context: HookContext) => {
  const mission = context.result as any
  if (!mission?.id) return context

  const status = String(mission.status || '')
  const targetJobStatus =
    status === 'COMPLETED'
      ? 'completed'
      : status === 'FAILED'
        ? 'failed'
        : status === 'WAITING_REVIEW'
          ? 'waiting_review'
          : status === 'WAITING_PLAN_APPROVAL' || status === 'PAUSED' || status === 'WAITING_INPUT'
            ? 'waiting_review'
            : null

  if (!targetJobStatus) return context

  const knex = context.app.get('sqliteClient')
  await knex('jobs').where({ missionId: mission.id }).update({
    status: targetJobStatus,
    updated_at: knex.fn.now(),
    ...(targetJobStatus === 'completed' || targetJobStatus === 'failed'
      ? { finished_at: knex.fn.now() }
      : {})
  })

  return context
}
