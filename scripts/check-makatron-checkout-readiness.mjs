// Read-only MAKAtron checkout preflight. Never prints credentials, bot tokens or customer data.
import "dotenv/config";
import { pool } from "../src/config/db.js";

function yes(v){ return v ? "yes" : "no"; }
const flags={
  featureEnabled:/^(1|true|yes|on)$/i.test(process.env.TELEGRAM_INLINE_CHECKOUT_ENABLED||""),
  pilotRestricted:Boolean(process.env.TELEGRAM_INLINE_CHECKOUT_TEST_CHAT_ID),
  novaPoshtaKeyConfigured:Boolean(process.env.NOVA_POSHTA_API_KEY),
  botPollingEnabled:process.env.TELEGRAM_BOT_POLLING_ENABLED!=="false",
};
try{
 const role=await pool.query("SELECT current_user AS role, current_database() AS db");
 const versions=await pool.query(
   "SELECT version FROM schema_migrations WHERE version IN "+
   "('105_add_commit_on_submit_checkout','110_telegram_bot_locales','111_telegram_order_drafts','112_explicit_public_pickup_locations')"
 );
 const list=new Set(versions.rows.map(x=>x.version));
 const draft=await pool.query("SELECT to_regclass('public.telegram_order_drafts') AS table_name");
 const grants=draft.rows[0].table_name
   ? (await pool.query(
    "SELECT has_table_privilege(current_user,'public.telegram_order_drafts','SELECT') AS can_read,"+
    "has_table_privilege(current_user,'public.telegram_order_drafts','INSERT') AS can_insert,"+
    "has_table_privilege(current_user,'public.telegram_order_drafts','UPDATE') AS can_update")).rows[0]
   : null;
 const publicPickupEnabled=list.has("112_explicit_public_pickup_locations");
 const pickup=publicPickupEnabled
   ? await pool.query("SELECT COUNT(*)::integer AS n FROM warehouses "+
       "WHERE is_active=TRUE AND pickup_available=TRUE AND public_pickup_enabled=TRUE "+
       "AND NULLIF(BTRIM(public_pickup_name),'') IS NOT NULL "+
       "AND NULLIF(BTRIM(public_pickup_city),'') IS NOT NULL "+
       "AND NULLIF(BTRIM(public_pickup_address),'') IS NOT NULL")
   : {rows:[{n:0}]};
 console.log("MAKAtron checkout preflight (read-only):");
 console.log("DB role: "+role.rows[0].role+", DB: "+role.rows[0].db);
 for(const v of ["105_add_commit_on_submit_checkout","110_telegram_bot_locales","111_telegram_order_drafts","112_explicit_public_pickup_locations"]){
   console.log("Migration "+v+": "+yes(list.has(v)));
 }
 console.log("Draft access SELECT/INSERT/UPDATE: "+(
   grants? [grants.can_read,grants.can_insert,grants.can_update].map(yes).join("/"):"not yet created"));
 console.log("Approved PUBLIC pickup points: "+pickup.rows[0].n);
 console.log("Nova Poshta configured: "+yes(flags.novaPoshtaKeyConfigured));
 console.log("Inline checkout enabled: "+yes(flags.featureEnabled));
 console.log("Pilot limited to one chat: "+yes(flags.pilotRestricted));
 console.log("Note: live purchase activation still requires an end-to-end order test.");
} catch(e){
 console.error("Preflight could not complete. Check DB connection and schema permissions.");
 process.exitCode=1;
} finally {await pool.end();}
