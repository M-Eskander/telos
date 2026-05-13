#!/usr/bin/env node
// Loads dotenv then runs the local knex CLI with passed args so knex sees .env
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const cp = require('child_process');

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/runKnex.js <knex-args>');
  process.exit(1);
}

const res = cp.spawnSync('npx', ['knex', ...args], { stdio: 'inherit', env: process.env, shell: true });
process.exit(res.status === null ? 1 : res.status);
