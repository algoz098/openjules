
import knex from 'knex';
import path from 'path';

const dbPath = path.resolve(__dirname, '../backend.sqlite');

const db = knex({
    client: 'sqlite3',
    connection: {
        filename: dbPath
    },
    useNullAsDefault: true
});

const GOAL = "criar um simples api em nodejs com helloworld";

async function runSmokeTest() {
    console.log(`[Smoke Test] Starting mission with goal: "${GOAL}"`);

    // 1. Create Project (mock or use default)
    const projectId = 1; // Assuming project 1 exists

    // 2. Create Mission
    const [mission] = await db('missions').insert({
        projectId,
        goal: GOAL,
        status: 'PENDING',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).returning('*');

    console.log(`[Smoke Test] Mission created: ID ${mission.id}`);

    // 3. Create Job to trigger worker
    const [job] = await db('jobs').insert({
        projectId,
        missionId: mission.id,
        type: 'mission',
        payload: JSON.stringify({ missionId: mission.id }),
        status: 'queued',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).returning('*');

    console.log(`[Smoke Test] Job queued: ID ${job.id}`);

    // 4. Poll for completion
    const start = Date.now();
    const timeout = 10 * 60 * 1000; // 10 minutes

    while (Date.now() - start < timeout) {
        const [m] = await db('missions').where('id', mission.id);

        if (m.status === 'COMPLETED') {
            console.log(`[Smoke Test] SUCCESS! Mission completed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
            process.exit(0);
        }

        if (m.status === 'FAILED') {
            console.error(`[Smoke Test] FAILED! Reason: ${m.fail_reason}`);
            console.error(m.result_summary);
            process.exit(1);
        }

        // Optional: Log new steps?
        process.stdout.write('.');
        await new Promise(r => setTimeout(r, 2000));
    }

    console.error('[Smoke Test] Timeout waiting for mission completion.');
    process.exit(1);
}

runSmokeTest().catch(err => {
    console.error(err);
    process.exit(1);
}).finally(() => db.destroy());
