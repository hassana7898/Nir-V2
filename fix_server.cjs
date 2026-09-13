const fs = require('fs');
let server = fs.readFileSync('server.ts', 'utf8');

const importStatement = `import invoicesRouter from './server/routes/invoices';\n`;
if (!server.includes('invoicesRouter')) {
  server = server.replace(/const app = express\(\);/, \`const app = express();\napp.use(express.json());\napp.use('/api/invoices', invoicesRouter);\`);
  server = importStatement + server;
  fs.writeFileSync('server.ts', server);
}
