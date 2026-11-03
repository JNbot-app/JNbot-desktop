#!/usr/bin/env node
// This script installs required dependencies for the enhanced CLI

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Define CLI directory
const cliDir = path.join(__dirname, '..', 'src', 'cli');

console.log('Installing dependencies for JNBot CLI...');

try {
  // Navigate to CLI directory
  process.chdir(cliDir);
  
  // Install dependencies
  console.log('Installing npm packages...');
  execSync('npm install', { stdio: 'inherit' });
  
  console.log('\n✅ Successfully installed dependencies for JNBot CLI!');
  console.log('Run the CLI with: npm run cli');
} catch (error) {
  console.error('❌ Failed to install dependencies:', error);
  process.exit(1);
}
