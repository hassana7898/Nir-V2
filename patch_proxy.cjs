const fs = require('fs');
let code = fs.readFileSync('server/db/index.ts', 'utf8');

code = code.replace(
  /if \(drizzleDb\) \{/,
  `console.log("Proxy accessed prop:", prop, "drizzleDb is truthy:", !!drizzleDb);
    if (drizzleDb) {`
);
fs.writeFileSync('server/db/index.ts', code);
