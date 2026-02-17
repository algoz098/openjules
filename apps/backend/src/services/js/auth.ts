import { authenticate } from '@feathersjs/authentication'
import { NotAuthenticated, BadRequest } from '@feathersjs/errors'
import type { HookContext } from '@feathersjs/feathers'

export const requireAuth = authenticate('jwt')

const isExternal = (context: HookContext) => !!context.params.provider
const isAdmin = (context: HookContext) => context.params.user?.role === 'admin'

export const scopeProjects = async (context: HookContext) => {
  if (!isExternal(context) || isAdmin(context)) return context
  const ownerUserId = context.params.user?.id
  if (!ownerUserId) throw new NotAuthenticated()

  if (context.method === 'create') {
    context.data = { ...(context.data as any), ownerUserId }
    return context
  }

  context.params.query = { ...(context.params.query || {}), ownerUserId }
  return context
}

export const applyProjectScope = async (context: HookContext) => {
  const explicitProjectId =
    (context.params.query as any)?.projectId ??
    (context.params as any).projectId ??
    (context.data as any)?.projectId

  const projectId = explicitProjectId ?? context.params.user?.defaultProjectId

  if (context.method === 'create') {
    if (!projectId) throw new BadRequest('Missing project context')
    context.data = { ...(context.data as any), projectId }
    return context
  }

  if (!isExternal(context) || isAdmin(context)) return context
  if (!projectId) throw new BadRequest('Missing project context')

  context.params.query = { ...(context.params.query || {}), projectId }
  return context
}

export const stampAuditFields = async (context: HookContext) => {
  if (!context.params.user || !context.data) return context
  const userId = context.params.user.id
  if (context.method === 'create') {
    context.data = { ...(context.data as any), createdBy: userId, updatedBy: userId }
  }
  if (context.method === 'patch' || context.method === 'update') {
    context.data = { ...(context.data as any), updatedBy: userId }
  }
  return context
}
