
import { app } from '../src/app';
import { startMissionWorker, stopMissionWorker } from '../src/mission-worker';

console.log('--- Force Starting Mission Worker ---');

async function run() {
    // Start worker
    startMissionWorker(app);

    // Keep alive for 2 minutes to process jobs
    console.log('Worker started. Waiting 120s...');
    await new Promise(resolve => setTimeout(resolve, 120000));

    console.log('Stopping worker...');
    stopMissionWorker(app);
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
