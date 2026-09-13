import { newDb } from 'pg-mem';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './server/db/schema';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

async function main() {
  const db = newDb();
  
  // Create tables using pg-mem's DDL generation or drizzle migrator
  // Actually pg-mem has a built-in Drizzle adapter!
  const pg = db.adapters.createPg();
  const drizzleDb = drizzle(pg, { schema });
  
  console.log("pg-mem initialized");
}
main().catch(console.error);
