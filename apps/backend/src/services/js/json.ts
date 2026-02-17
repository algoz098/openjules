import type { HookContext } from '@feathersjs/feathers'

export const parseMaybeJson = (value: unknown) => {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export const serializeMaybeJson = (value: unknown) => {
  if (value === null || value === undefined) return value
  if (typeof value === 'object') return JSON.stringify(value)
  return value
}

export const serializeJobJson = async (context: HookContext) => {
  if (!context.data) return context
  context.data = {
    ...(context.data as any),
    payload: serializeMaybeJson((context.data as any).payload),
    result: serializeMaybeJson((context.data as any).result)
  }
  return context
}

export const parseJobJson = async (context: HookContext) => {
  const parseOne = (row: any) => {
    if (!row) return row
    row.payload = parseMaybeJson(row.payload)
    row.result = parseMaybeJson(row.result)
    return row
  }

  if (Array.isArray(context.result)) {
    context.result = context.result.map(parseOne)
  } else if ((context.result as any)?.data && Array.isArray((context.result as any).data)) {
    ;(context.result as any).data = (context.result as any).data.map(parseOne)
  } else {
    context.result = parseOne(context.result)
  }

  return context
}

export const serializeSettingValue = async (context: HookContext) => {
  if (!context.data) return context
  context.data = { ...(context.data as any), value: serializeMaybeJson((context.data as any).value) }
  return context
}

export const parseSettingValue = async (context: HookContext) => {
  const parseOne = (row: any) => {
    if (!row) return row
    row.value = parseMaybeJson(row.value)
    return row
  }

  if (Array.isArray(context.result)) {
    context.result = context.result.map(parseOne)
  } else if ((context.result as any)?.data && Array.isArray((context.result as any).data)) {
    ;(context.result as any).data = (context.result as any).data.map(parseOne)
  } else {
    context.result = parseOne(context.result)
  }

  return context
}

export const serializeMissionLogContent = async (context: HookContext) => {
  if (!context.data) return context
  context.data = { ...(context.data as any), content: serializeMaybeJson((context.data as any).content) }
  return context
}

export const parseMissionLogContent = async (context: HookContext) => {
  const parseOne = (row: any) => {
    if (!row) return row
    row.content = parseMaybeJson(row.content)
    return row
  }

  if (Array.isArray(context.result)) {
    context.result = context.result.map(parseOne)
  } else if ((context.result as any)?.data && Array.isArray((context.result as any).data)) {
    ;(context.result as any).data = (context.result as any).data.map(parseOne)
  } else {
    context.result = parseOne(context.result)
  }

  return context
}
