import { PGlite } from '@electric-sql/pglite';
async function main() {
  const db = new PGlite();
  await db.query(`CREATE TABLE test (id SERIAL PRIMARY KEY, name TEXT);`);
  await db.query(`INSERT INTO test (name) VALUES ('hello');`);
  const res = await db.query(`SELECT * FROM test;`);
  console.log("Result:", res.rows);
}
main().catch(console.error);
