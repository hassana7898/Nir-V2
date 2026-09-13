const fs = require('fs');
let code = fs.readFileSync('server/middleware/auth.ts', 'utf8');

const target = `export const requireRole = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {`;
const replacement = `export const requireRole = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    console.log("REQUIRE_ROLE DEBUG:", { AI_STUDIO_PREVIEW: process.env.AI_STUDIO_PREVIEW, NODE_ENV: process.env.NODE_ENV });`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('server/middleware/auth.ts', code);
  console.log('Patched');
} else {
  console.log('Not found');
}
