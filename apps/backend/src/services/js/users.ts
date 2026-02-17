import { NotAuthenticated, BadRequest } from '@feathersjs/errors'
import type { HookContext } from '@feathersjs/feathers'

const DEFAULT_SETTINGS = {
  execution: { sandbox: 'docker', docker: {} },
  ai: {
    provider: 'openai',
    openai: { apiKey: '', model: 'gpt-4o-mini' },
    anthropic: { apiKey: '', model: 'claude-3-5-sonnet-latest' },
    google: { apiKey: '', model: 'gemini-1.5-pro' },
    groq: { apiKey: '', model: 'llama-3.1-70b-versatile' }
  },
  prompts: {
    planner: { content: 'You are a planner agent.' },
    coder: { content: 'You are a coder agent.' },
    reviewer: { content: 'You are a reviewer agent.' }
  }
}

const isExternal = (context: HookContext) => !!context.params.provider
const isAdmin = (context: HookContext) => context.params.user?.role === 'admin'

export const validateUserCreate = async (context: HookContext) => {
  const email = String((context.data as any)?.email || '').trim().toLowerCase()
  const password = String((context.data as any)?.password || '')

  if (!email || !password) throw new BadRequest('Email and password are required')
  if (!email.includes('@')) throw new BadRequest('Invalid email')

  context.data = { ...(context.data as any), email }

  const knex = context.app.get('sqliteClient')
  const firstAdmin = await knex('users').where({ role: 'admin' }).first()
  if (!firstAdmin) {
    context.data = { ...(context.data as any), role: 'admin' }
    return context
  }

  if (!isExternal(context)) {
    context.data = { role: 'member', ...(context.data as any) }
    return context
  }

  if (!context.params.user || !isAdmin(context)) {
    throw new NotAuthenticated('Only admin can create users after bootstrap')
  }

  context.data = { role: 'member', ...(context.data as any) }
  return context
}

export const createDefaultProjectForUser = async (context: HookContext) => {
  const user = context.result as any
  if (!user?.id) return context

  if (user.defaultProjectId) return context

  const project = await context.app.service('projects').create(
    {
      name: 'Default Project',
      ownerUserId: user.id
    },
    { provider: undefined, user } as any
  )

  const updatedUser = await context.app.service('users').patch(
    user.id,
    { defaultProjectId: project.id },
    { provider: undefined, user } as any
  )

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await context.app.service('settings').create(
      { key, value, projectId: project.id },
      { provider: undefined, user } as any
    )
  }

  context.result = updatedUser
  return context
}
