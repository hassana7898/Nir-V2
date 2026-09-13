const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

if (!code.includes('await (db as any).migrateDb()')) {
  code = code.replace(
    /import express from "express";/,
    `import express from "express";\nimport { db } from "./server/db/index";`
  );
  code = code.replace(
    /async function startServer\(\) \{/,
    `async function startServer() {\n  if ((db as any).migrateDb) {\n    await (db as any).migrateDb();\n    console.log("Migrations applied to PGLite DB from server.ts.");\n  }`
  );
  fs.writeFileSync('server.ts', code);
}
