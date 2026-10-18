// Intentionally independent of run-isolated-tests.mjs: never loads .env, dumps
// an existing database, or drops/recreates a database in an existing cluster.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const root = fileURLToPath(new URL('../../', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'maka-photo-pg-test-'));
const data = path.join(directory, 'data');
const socket = path.join(directory, 'socket');
await mkdir(socket, { mode: 0o700 });
const database = 'maka_photo_management_v2_test';
const user = 'maka_photo_review';
// Explicit allowlist: do not forward DB_*, PG*, R2_* or production dotenv config.
const environment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C', TZ: 'UTC' };
const run = (command, args, env = environment) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command}: ${code ?? signal}`)));
});
const port = await new Promise((resolve, reject) => {
  const reservation = net.createServer();
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', () => {
    const selected = reservation.address().port;
    reservation.close(error => error ? reject(error) : resolve(selected));
  });
});
const psql = (name, args) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', String(port), '-U', user, '-d', name, ...args]);
const migrations = [
  '040_add_product_image_storage_key.sql',
  '061_add_product_image_processing.sql',
  '083_add_product_image_quality_metadata.sql',
  '084_add_product_image_branding_mode.sql',
  '085_add_product_image_merchant_version.sql',
  '106_add_smart_product_image_processing.sql',
  '108_product_image_lifecycle.sql',
  '109_product_image_replacements.sql',
];
let started = false;
console.log(JSON.stringify({ directory, database, host: '127.0.0.1', port, syntheticDataOnly: true }));
try {
  await run('initdb', ['-D', data, '-U', user, '--auth-local=trust', '--auth-host=trust', '--encoding=UTF8', '--locale=C']);
  // A failed startup (including a port collision) aborts before any SQL command.
  await run('pg_ctl', ['-D', data, '-l', path.join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -k ${socket}`, '-w', 'start']);
  started = true;
  await psql('postgres', ['-c', `CREATE DATABASE ${database}`]);
  await psql(database, ['-f', path.join(root, 'tests/helpers/photo-management-baseline.sql')]);
  for (const migration of migrations) await psql(database, ['-f', path.join(root, 'migrations', migration)]);
  await psql(database, ['-c', 'SELECT version FROM schema_migrations ORDER BY version']);
  await run(process.execPath, ['--test', '--test-concurrency=1',
    'src/services/ProductImageLifecycle.integration.test.js',
    'src/services/ProductImageReplacement.integration.test.js',
  ], {
    ...environment, NODE_ENV: 'test', DOTENV_CONFIG_PATH: '/dev/null',
    DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_NAME: database, DB_USER: user, DB_PASSWORD: '',
    AUTO_TRANSLATION_ENABLED: 'false', AUTH_COOKIE_SECURE: 'false',
  });
  await psql(database, ['-c', `SELECT
    (SELECT count(*) FROM products) AS fixture_products,
    (SELECT count(*) FROM product_images) AS remaining_images,
    (SELECT count(*) FROM product_image_replacements) AS remaining_replacements,
    (SELECT count(*) FROM product_image_objects) AS remaining_objects`]);
} finally {
  if (started) await run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
  console.log(`Stopped test cluster retained for inspection: ${directory}`);
}
