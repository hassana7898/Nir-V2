import { db } from './server/db';
async function start() {
    if ((db as any).migrateDb) {
        await (db as any).migrateDb();
        console.log("Migrations applied to PGLite DB.");
    }
    await import('./server.ts');
}
start();
