import { KnexService } from '@feathersjs/knex'
import type { Application } from '../../declarations'
import { applyProjectScope, parseSettingValue, requireAuth, serializeSettingValue, stampAuditFields } from '../js'

export const settings = (app: Application) => {
  app.use(
    'settings',
    new KnexService({
      Model: app.get('sqliteClient'),
      name: 'settings',
      paginate: app.get('paginate')
    })
  )

  app.service('settings').hooks({
    before: {
      all: [requireAuth, applyProjectScope],
      create: [stampAuditFields, serializeSettingValue],
      patch: [stampAuditFields, serializeSettingValue],
      update: [stampAuditFields, serializeSettingValue]
    },
    after: {
      all: [parseSettingValue]
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    settings: any
  }
}
