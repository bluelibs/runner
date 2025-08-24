#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

// This script runs the TypeScript CLI directly using ts-node
// In production, this would compile to JS first

const tsFile = path.join(__dirname, '..', 'src', 'cli.ts');
const args = process.argv.slice(2);

const child = spawn('npx', ['ts-node', tsFile, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code) => {
  process.exit(code || 0);
});