
import knex from 'knex';
import path from 'path';

const dbPath = path.resolve(__dirname, 'backend.sqlite');

const db = knex({
    client: 'sqlite3',
    connection: {
        filename: dbPath
    },
    useNullAsDefault: true
});

async function check() {
    const missionId = 27;
    console.log(`--- Mission ${missionId} Status ---`);
    const [mission] = await db('missions').where('id', missionId);
    console.log(`Status: ${mission.status}`);
    await db.destroy();
}

check();
