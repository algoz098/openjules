import { KnexService } from '@feathersjs/knex'
import type { Application } from '../../declarations'
import { applyProjectScope, parseJobJson, requireAuth, serializeJobJson, stampAuditFields } from '../js'

import { runMission } from '../../mission-runner'
import type { HookContext } from '@feathersjs/feathers'

const triggerMission = async (context: HookContext) => {
  if (context.result?.id) {
    // Fire and forget - let standard node event loop handle concurrent executions
    void runMission(context.app as Application, context.result.id)
  }
  return context
}

export const jobs = (app: Application) => {
  app.use(
    'jobs',
    new KnexService({
      Model: app.get('sqliteClient'),
      name: 'jobs',
      paginate: app.get('paginate')
    })
  )

  app.service('jobs').hooks({
    before: {
      all: [requireAuth, applyProjectScope],
      create: [stampAuditFields, serializeJobJson],
      patch: [stampAuditFields, serializeJobJson],
      update: [stampAuditFields, serializeJobJson]
    },
    after: {
      all: [parseJobJson],
      create: [triggerMission]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    jobs: any
  }
}
