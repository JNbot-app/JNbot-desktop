const fs = require('fs');
const path = require('path');

// Service credentials are injected at build time from the environment or a
// local, untracked `.env` file, so they never live in the repository. Builds
// without them still work; cloud backups and TURN relaying are just unavailable.
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const secrets = {
  b2KeyId: process.env.JNBOT_B2_KEY_ID ?? '',
  b2Secret: process.env.JNBOT_B2_SECRET ?? '',
  turnUsername: process.env.JNBOT_TURN_USERNAME ?? '',
  turnCredential: process.env.JNBOT_TURN_CREDENTIAL ?? '',
};

module.exports = { __JNBOT_SECRETS__: JSON.stringify(secrets) };
