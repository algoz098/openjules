// For more information about this file see https://dove.feathersjs.com/guides/cli/client.html
import { feathers } from '@feathersjs/feathers'
import type { TransportConnection, Application } from '@feathersjs/feathers'
import authenticationClient from '@feathersjs/authentication-client'
import type { AuthenticationClientOptions } from '@feathersjs/authentication-client'

import { usersClient } from './services/users/users.shared'
export type { USER, Users, UsersData, UsersQuery, UsersPatch } from './services/users/users.shared'

export type UserRecord = {
  id: number
  email: string
  role: 'admin' | 'member'
  defaultProjectId: number | null
  created_at?: string
  updated_at?: string
}

export type ProjectRecord = {
  id: number
  name: string
  ownerUserId: number
  createdBy?: number
  updatedBy?: number
  created_at?: string
  updated_at?: string
}

export type JobRecord = {
  id: number
  projectId: number
  missionId?: number | null
  instruction?: string
  type?: string
  status: string
  payload?: Record<string, unknown>
  result?: Record<string, unknown>
  logs?: string
  createdBy?: number
  updatedBy?: number
  created_at?: string
  updated_at?: string
}

export type MissionRecord = {
  id: number
  projectId: number
  trigger_type: 'webhook' | 'cron' | 'manual'
  status: 'QUEUED' | 'PLANNING' | 'EXECUTING' | 'VALIDATING' | 'WAITING_REVIEW' | 'COMPLETED' | 'FAILED'
  goal: string
  repoUrl?: string
  baseBranch?: string
  reviewed_at?: string | null
  fail_reason?: string | null
  result_summary?: string | null
  createdBy?: number
  updatedBy?: number
  created_at?: string
  updated_at?: string
}

export type MissionStepRecord = {
  id: number
  projectId: number
  missionId: number
  order_index: number
  description: string
  status: 'PENDING' | 'IN_PROGRESS' | 'DONE' | 'FAILED'
  result_summary?: string | null
  createdBy?: number
  updatedBy?: number
  created_at?: string
  updated_at?: string
}

export type MissionLogRecord = {
  id: number
  projectId: number
  missionId: number
  stepId?: number | null
  type: 'thought' | 'command' | 'tool_output' | 'error'
  content: unknown
  timestamp?: string
  createdBy?: number
  updatedBy?: number
  created_at?: string
  updated_at?: string
}

export type SettingRecord = {
  id: number
  projectId: number
  key: string
  value: unknown
  createdBy?: number
  updatedBy?: number
  created_at?: string
  updated_at?: string
}

export type BootstrapStatus = {
  hasAdmin: boolean
}

export interface Configuration {
  connection: TransportConnection<ServiceTypes>
}

export interface ServiceTypes {
  projects: any
  jobs: any
  settings: any
  missions: any
  'mission-steps': any
  'mission-logs': any
  bootstrap: any
}

export type ClientApplication = Application<ServiceTypes, Configuration>

/**
 * Returns a typed client for the backend app.
 *
 * @param connection The REST or Socket.io Feathers client connection
 * @param authenticationOptions Additional settings for the authentication client
 * @see https://dove.feathersjs.com/api/client.html
 * @returns The Feathers client application
 */
export const createClient = <Configuration = any,>(
  connection: TransportConnection<ServiceTypes>,
  authenticationOptions: Partial<AuthenticationClientOptions> = {}
) => {
  const client: ClientApplication = feathers()

  client.configure(connection)
  client.configure(authenticationClient(authenticationOptions))
  client.set('connection', connection)

  client.configure(usersClient)
  return client
}
