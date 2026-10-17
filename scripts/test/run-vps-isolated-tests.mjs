// VPS-only launcher for the project's production-backed isolated test suite.
// Rebuilds ONLY autohub_test; production autohub is accessed through a read-only pg_dump.
// Does not require PostgreSQL role privileges for the application user.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const expectedRoot = '/home/ubuntu/autohub-release-check';
const productionEnvFile = '/home/ubuntu/autohub/.env';
if (root !== expectedRoot) throw new Error('STOP: this launcher runs only from the isolated VPS worktree');

const config = dotenv.parse(fs.readFileSync(productionEnvFile));
if (config.DB_HOST !== 'localhost' || config.DB_PORT !== '5432'
    || config.DB_USER !== 'autohub_app' || config.DB_NAME !== 'autohub'
    || !config.DB_PASSWORD) {
  throw new Error('STOP: production DB parameters differ from the verified baseline');
}

const dbCheck = spawnSync('sudo', ['-n', '-u', 'postgres', 'psql', '-d', 'postgres', '-Atc',
  "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='autohub_test'"], { encoding: 'utf8' });
if (dbCheck.error || dbCheck.status !== 0) throw new Error('STOP: could not verify test database');
const existingOwner = dbCheck.stdout.trim();
if (existingOwner && existingOwner !== 'autohub_app') {
  throw new Error('STOP: autohub_test is owned by another role; refusing to replace it');
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maka-safe-tests-'));
function wrapper(name, lines) {
  fs.writeFileSync(path.join(dir, name), ['#!/bin/bash', 'set -euo pipefail', ...lines, ''].join('\n'),
    { mode: 0o700 });
}

// The existing test runner only reads autohub to create a snapshot.
// All potentially destructive DB-management calls must target autohub_test exactly.
wrapper('pg_dump', [
  '[[ $# -eq 12 && "$1" == "--host" && "$2" == "localhost" && "$3" == "--port" && "$4" == "5432" && "$5" == "--username" && "$6" == "autohub_app" && "$7" == "--format=custom" && "$8" == "--no-owner" && "$9" == "--no-privileges" && "${10}" == "--file" && "${11}" == /tmp/autohub-tests-*/autohub.dump && "${12}" == "autohub" ]] || { echo "BLOCKED pg_dump" >&2; exit 2; }',
  'sudo -n -u postgres /usr/bin/pg_dump -d autohub -Fc --no-owner --no-privileges > "${11}"',
]);
wrapper('dropdb', [
  '[[ $# -eq 5 && "$1" == "--maintenance-db" && "$2" == "postgres" && "$3" == "--if-exists" && "$4" == "--force" && "$5" == "autohub_test" ]] || { echo "BLOCKED dropdb" >&2; exit 2; }',
  'exec sudo -n -u postgres /usr/bin/dropdb "$@"',
]);
wrapper('createdb', [
  '[[ $# -eq 5 && "$1" == "--maintenance-db" && "$2" == "postgres" && "$3" == "--owner" && "$4" == "autohub_app" && "$5" == "autohub_test" ]] || { echo "BLOCKED createdb" >&2; exit 2; }',
  'exec sudo -n -u postgres /usr/bin/createdb "$@"',
]);

try {
  console.log('=== FULL MAKA BACKEND TESTS: disposable autohub_test ===');
  if (existingOwner) console.log('Rebuilding test DB autohub_test from a new read-only snapshot');

  const result = spawnSync(process.execPath, ['scripts/test/run-isolated-tests.mjs'], {
    cwd: root, stdio: 'inherit',
    env: {
      PATH: dir + ':' + process.env.PATH,
      HOME: process.env.HOME,
      USER: process.env.USER,
      LANG: process.env.LANG || 'C.UTF-8',
      DB_HOST: config.DB_HOST,
      DB_PORT: config.DB_PORT,
      DB_USER: config.DB_USER,
      DB_PASSWORD: config.DB_PASSWORD,
      DB_NAME: config.DB_NAME,
      TEST_DB_NAME: 'autohub_test',
      NODE_ENV: 'test',
      JWT_SECRET: 'maka-isolated-tests-only',
      AUTH_JWT_SECRET: 'maka-isolated-tests-only-32-character-secret',
      AUTO_TRANSLATION_ENABLED: 'false',
      AUTH_COOKIE_SECURE: 'false',
      PRODUCT_IMAGE_GC_ENABLED: 'false',
      PRODUCT_IMAGE_DELIVERY_BASE_URL: '',
    },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
