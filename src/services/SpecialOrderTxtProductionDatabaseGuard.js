/*
 * MAKA Mercedes TXT: production DB identity guard.
 *
 * Does not write to the database.
 * Does not authorize activation.
 * Does not change the isolated test importer.
 */

const EXPECTED = Object.freeze({
  database: "autohub",
  port: "5432",
  user: "autohub_app",
  dataDirectory: "/var/lib/postgresql/16/main",
  uploadRoot:
    "/home/ubuntu/maka-mercedes-txt-prod-uploads-20261110",
});

export function assertProductionTxtStageEnvironment(
  env = process.env
) {
  const permittedHost = [
    "127.0.0.1",
    "/var/run/postgresql",
  ].includes(env.DB_HOST);

  if (
    env.NODE_ENV !== "production" ||
    env.MAKA_TXT_STAGE_MODE !== "PRODUCTION_READY_ONLY" ||
    env.MAKA_TXT_UPLOAD_MODE !== "PRODUCTION_UPLOAD_ONLY" ||
    env.MAKA_TXT_UPLOAD_ROOT !== EXPECTED.uploadRoot ||
    env.DB_NAME !== EXPECTED.database ||
    env.DB_PORT !== EXPECTED.port ||
    env.DB_USER !== EXPECTED.user ||
    !permittedHost ||
    env.MAKA_TXT_ACTIVATION_ENABLED === "true"
  ) {
    throw new Error("PRODUCTION_TXT_STAGE_DISABLED");
  }

  return true;
}

export async function assertProductionTxtDatabase(
  client,
  env = process.env
) {
  assertProductionTxtStageEnvironment(env);

  if (!client || typeof client.query !== "function") {
    throw new Error("PRODUCTION_DB_CLIENT_REQUIRED");
  }

  const result = await client.query(`
    SELECT
      current_database() AS database_name,
      current_setting('port') AS server_port,
      public.maka_txt_verify_production_cluster() AS cluster_verified,
      current_user AS database_user,
      to_regclass('public.special_order_import_runs')::text
        AS import_runs_table,
      to_regclass('public.special_order_entries')::text
        AS entries_table,
      to_regclass('public.special_order_sources')::text
        AS sources_table
  `);

  const row = result.rows?.[0];

  if (
    result.rows?.length !== 1 ||
    row.database_name !== EXPECTED.database ||
    row.server_port !== EXPECTED.port ||
    row.cluster_verified !== true ||
    row.database_user !== EXPECTED.user ||
    !row.import_runs_table ||
    !row.entries_table ||
    !row.sources_table
  ) {
    throw new Error("PRODUCTION_TXT_DATABASE_IDENTITY_MISMATCH");
  }

  return {
    database: row.database_name,
    port: row.server_port,
    dataDirectory: EXPECTED.dataDirectory,
    user: row.database_user,
    verified: true,
  };
}
