import type { Application } from '../../declarations'
import { createDefaultProjectForUser, validateUserCreate } from '../js'

export const usersExtra = (app: Application) => {
  app.service('users').hooks({
    before: {
      create: [validateUserCreate]
    },
    after: {
      create: [createDefaultProjectForUser]
    }
  })
}
