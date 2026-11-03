const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Generate a licenses.json file with all license information
console.log('Generating license information...');
const licenseInfo = execSync('npx license-checker --json', { encoding: 'utf8' });

// Parse the license information
const licenses = JSON.parse(licenseInfo);

Object.values(licenses).forEach((info) => {
    delete info.path;
    delete info.licenseFile;
})



// Write the license information to a file
const outputPath = path.join(__dirname, '..', 'THIRD_PARTY_LICENSES.json');
fs.writeFileSync(outputPath, JSON.stringify(licenses));

console.log(`Generated license file: ${outputPath}`);
console.log('Include this file with your application or link to a web version of it.');
