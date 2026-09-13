import { PGlite } from '@electric-sql/pglite';
import { PGliteServer } from '@electric-sql/pglite/server';

async function main() {
  const db = new PGlite();
  // Using PGliteServer directly based on recent versions
  const server = new PGliteServer(db, { port: 54321 });
  await server.start();
  console.log('PGlite server listening on port 54321');
}
main().catch(console.error);
