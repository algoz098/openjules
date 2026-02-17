// For more information about this file see https://dove.feathersjs.com/guides/cli/app.test.html
import assert from 'assert'
import { app } from '../src/app'
import { startMissionWorker, stopMissionWorker } from '../src/mission-worker'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Mission Flow Integration Test', () => {
    before(async () => {
        // Start the app and the worker
        await app.listen(0) // Listen on a random port
        startMissionWorker(app)
    })

    after(async () => {
        stopMissionWorker(app)
        await app.teardown()
    })

    it('Create a simple api in nodejs with helloworld', async () => {
        // 1. Create a Project
        const project = await app.service('projects').create({
            name: 'Integration Test Project',
            ownerUserId: 1
        } as any)

        // 2. Create a Mission
        const mission = await app.service('missions').create({
            projectId: project.id,
            goal: 'Create a simple api in nodejs with helloworld',
            status: 'QUEUED',
            trigger_type: 'manual'
        })

        const job = await app.service('jobs').create({
            projectId: project.id,
            missionId: mission.id,
            status: 'pending',
            instruction: 'Create a simple api in nodejs with helloworld'
        })

        console.log(`Mission ${mission.id} started (Job ${job.id})`)

        // 3. Poll for completion
        let finalStatus = 'QUEUED'
        const maxRetries = 120 // 4 minutes approx
        for (let i = 0; i < maxRetries; i++) {
            const current = await app.service('missions').get(mission.id)
            finalStatus = current.status
            console.log(`Mission Status: ${finalStatus}`)

            if (['WAITING_REVIEW', 'COMPLETED', 'WAITING_PLAN_APPROVAL'].includes(finalStatus)) {
                if (finalStatus === 'WAITING_PLAN_APPROVAL') {
                    console.log('Approving plan...')
                    await app.service('missions').patch(mission.id, { status: 'EXECUTING' })
                    continue;
                }
                if (['WAITING_REVIEW', 'COMPLETED'].includes(finalStatus)) {
                    break;
                }
            }

            if (finalStatus === 'FAILED') {
                throw new Error(`Mission failed: ${current.fail_reason}`)
            }

            if (finalStatus === 'WAITING_INPUT') {
                // Check if it's the specific repo prompt we are trying to kill
                throw new Error(`Mission halted waiting for input: ${current.latest_agent_question || 'No question'}`)
            }

            await sleep(2000)
        }

        assert.ok(['WAITING_REVIEW', 'COMPLETED'].includes(finalStatus), `Mission did not complete successfully. Status: ${finalStatus}`)
    }).timeout(300000) // 5 minute timeout for this test
})
