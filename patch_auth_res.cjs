const fs = require('fs');
let code = fs.readFileSync('server/middleware/auth.ts', 'utf8');

const target = `if (!req.user) {
      const token = getSessionToken(req);
      if (!token) return res.status(401).json({ error: 'احراز هویت انجام نشده است.' });`;
const replacement = `if (!req.user) {
      const token = getSessionToken(req);
      if (!token) return res.status(401).json({ error: 'احراز هویت انجام نشده است.', debug: { AI_STUDIO_PREVIEW: process.env.AI_STUDIO_PREVIEW, NODE_ENV: process.env.NODE_ENV } });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('server/middleware/auth.ts', code);
  console.log('Patched');
} else {
  console.log('Not found');
}
