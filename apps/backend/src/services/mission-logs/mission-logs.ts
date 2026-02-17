import { KnexService } from '@feathersjs/knex'
import type { Application } from '../../declarations'
import { applyProjectScope, parseMissionLogContent, requireAuth, serializeMissionLogContent, stampAuditFields } from '../js'

export const missionLogs = (app: Application) => {
  app.use(
    'mission-logs',
    new KnexService({
      Model: app.get('sqliteClient'),
      name: 'mission_logs',
      paginate: app.get('paginate')
    })
  )

  app.service('mission-logs').hooks({
    before: {
      all: [requireAuth, applyProjectScope],
      create: [stampAuditFields, serializeMissionLogContent],
      patch: [stampAuditFields, serializeMissionLogContent],
      update: [stampAuditFields, serializeMissionLogContent]
    },
    after: {
      all: [parseMissionLogContent]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    'mission-logs': any
  }
}
