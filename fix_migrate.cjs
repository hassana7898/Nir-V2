const fs = require('fs');
let code = fs.readFileSync('services/dataService.ts', 'utf8');

code = code.replace(/export const migrateLegacyData = async \(\) => \{/, `
import { runLegacyMigration } from './legacyMigration';
export const migrateLegacyData = async () => {
    await runLegacyMigration();
`);

fs.writeFileSync('services/dataService.ts', code);
