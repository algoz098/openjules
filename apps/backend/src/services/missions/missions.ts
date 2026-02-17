import { KnexService } from '@feathersjs/knex'
import type { Application } from '../../declarations'
import {
  applyProjectScope,
  cleanupMissionSandboxBeforeRemove,
  enforceMissionReviewAction,
  enqueueMissionJob,
  normalizeMissionCreate,
  requireAuth,
  stampAuditFields,
  syncMissionJobStatus
} from '../js'

export const missions = (app: Application) => {
  app.use(
    'missions',
    new KnexService({
      Model: app.get('sqliteClient'),
      name: 'missions',
      paginate: app.get('paginate')
    })
  )

  app.service('missions').hooks({
    before: {
      all: [requireAuth, applyProjectScope],
      create: [stampAuditFields, normalizeMissionCreate],
      remove: [cleanupMissionSandboxBeforeRemove],
      patch: [stampAuditFields, enforceMissionReviewAction],
      update: [stampAuditFields]
    },
    after: {
      create: [enqueueMissionJob],
      patch: [syncMissionJobStatus, enqueueMissionJob]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    missions: any
  }
}
