const { PGlite } = require('@electric-sql/pglite');
const { startServer } = require('@electric-sql/pglite/server');

async function main() {
  const db = new PGlite();
  const server = await startServer(db, { port: 54321 });
  console.log('PGlite server listening on port 54321');
}
main().catch(console.error);
