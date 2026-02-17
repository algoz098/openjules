
import { app } from './src/app';
import { startMissionWorker, stopMissionWorker } from './src/mission-worker';

console.log('--- Force Starting Mission Worker ---');

async function run() {
    startMissionWorker(app);
    console.log('Worker started. Waiting 60s...');
    await new Promise(resolve => setTimeout(resolve, 60000));
    stopMissionWorker(app);
    process.exit(0);
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
