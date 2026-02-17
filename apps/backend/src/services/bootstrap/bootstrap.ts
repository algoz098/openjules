import type { Application } from '../../declarations'

export const bootstrap = (app: Application) => {
  app.use('bootstrap', {
    async get(id: string) {
      if (id !== 'status') return { hasAdmin: false }
      const knex = app.get('sqliteClient')
      const admin = await knex('users').where({ role: 'admin' }).first()
      return { hasAdmin: !!admin }
    }
  })
}

declare module '../../declarations' {
  interface ServiceTypes {
    bootstrap: any
  }
}
