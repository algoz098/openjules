import type { Application } from '../declarations'
import { users } from './users/users'
import { usersExtra } from './users/users-extra'
import { projects } from './projects/projects'
import { jobs } from './jobs/jobs'
import { settings } from './settings/settings'
import { missions } from './missions/missions'
import { missionSteps } from './mission-steps/mission-steps'
import { missionLogs } from './mission-logs/mission-logs'
import { sandboxFiles } from './sandbox-files/sandbox-files'
import { bootstrap } from './bootstrap/bootstrap'

export const services = (app: Application) => {
  app.configure(users)
  app.configure(usersExtra)
  app.configure(projects)
  app.configure(jobs)
  app.configure(settings)
  app.configure(missions)
  app.configure(missionSteps)
  app.configure(missionLogs)
  app.configure(sandboxFiles)
  app.configure(bootstrap)
}
