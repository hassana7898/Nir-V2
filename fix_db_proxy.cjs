const fs = require('fs');
let code = fs.readFileSync('server/db/index.ts', 'utf8');

code = code.replace(
  /if \(prop === 'migrateDb' && !drizzleDb\) return undefined;\n    if \(drizzleDb\) \{/,
  `if ((prop === 'migrateDb' || prop === 'then') && !drizzleDb) return undefined;\n    if (drizzleDb) {`
);

fs.writeFileSync('server/db/index.ts', code);
