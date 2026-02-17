
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

async function approve() {
    await db('missions')
        .where('id', 27)
        .update({ status: 'EXECUTING' });
    console.log('Mission 27 approved (status set to EXECUTING)');
}

approve().catch(console.error).finally(() => db.destroy());
