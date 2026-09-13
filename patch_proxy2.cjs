const fs = require('fs');
let code = fs.readFileSync('server/db/index.ts', 'utf8');

code = code.replace(
  /const databaseUrl = \(process.env.DATABASE_URL \|\| ''\).trim\(\);/,
  `console.log("DB Module Init! PGLITE_TEST=", process.env.PGLITE_TEST);
const databaseUrl = (process.env.DATABASE_URL || '').trim();`
);
fs.writeFileSync('server/db/index.ts', code);
