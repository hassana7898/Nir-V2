const { generateSync } = require('otplib');
const secret = process.argv[2];
process.stdout.write(generateSync({ strategy: 'totp', secret, algorithm: 'sha1', digits: 6, period: 30 }));
