import { KnexService } from '@feathersjs/knex'
import type { Application } from '../../declarations'
import { requireAuth, scopeProjects, stampAuditFields } from '../js'

export const projects = (app: Application) => {
  app.use(
    'projects',
    new KnexService({
      Model: app.get('sqliteClient'),
      name: 'projects',
      paginate: app.get('paginate')
    })
  )

  app.service('projects').hooks({
    before: {
      all: [requireAuth, scopeProjects],
      create: [stampAuditFields],
      patch: [stampAuditFields],
      update: [stampAuditFields]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    projects: any
  }
}
