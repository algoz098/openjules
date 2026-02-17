import { KnexService } from '@feathersjs/knex'
import type { Application } from '../../declarations'
import { applyProjectScope, requireAuth, stampAuditFields } from '../js'

export const missionSteps = (app: Application) => {
  app.use(
    'mission-steps',
    new KnexService({
      Model: app.get('sqliteClient'),
      name: 'mission_steps',
      paginate: app.get('paginate')
    })
  )

  app.service('mission-steps').hooks({
    before: {
      all: [requireAuth, applyProjectScope],
      create: [stampAuditFields],
      patch: [stampAuditFields],
      update: [stampAuditFields]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    'mission-steps': any
  }
}
