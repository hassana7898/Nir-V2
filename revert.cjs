const fs = require('fs');
let code = fs.readFileSync('server/middleware/auth.ts', 'utf8');

const target1 = `export const requireRole = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    console.log("REQUIRE_ROLE DEBUG:", { AI_STUDIO_PREVIEW: process.env.AI_STUDIO_PREVIEW, NODE_ENV: process.env.NODE_ENV });`;
const rep1 = `export const requireRole = (...allowedRoles: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {`;
code = code.replace(target1, rep1);

const target2 = `if (!token) return res.status(401).json({ error: 'احراز هویت انجام نشده است.', debug: { AI_STUDIO_PREVIEW: process.env.AI_STUDIO_PREVIEW, NODE_ENV: process.env.NODE_ENV } });`;
const rep2 = `if (!token) return res.status(401).json({ error: 'احراز هویت انجام نشده است.' });`;
code = code.replace(target2, rep2);

fs.writeFileSync('server/middleware/auth.ts', code);
