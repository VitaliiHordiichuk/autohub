// Run on the isolated MAKAtron VPS checkout with the MAKAtron DB environment.
// Example: node scripts/makatron-staff-link.mjs 123
// This prints a one-time 15 minute link. Never paste it into a public chat.
import "dotenv/config";
import { issueMakatronStaffLink } from "../src/services/MakatronStaffService.js";
import { pool } from "../src/config/db.js";

const userId=Number(process.argv[2]);
if(!Number.isSafeInteger(userId)||userId<=0){
  console.error("Usage: node scripts/makatron-staff-link.mjs <MAKA_ADMIN_OR_MANAGER_USER_ID>");
  process.exitCode=2;
}else{
  try{
    const url=await issueMakatronStaffLink(userId);
    console.log("Staff link (expires in 15 minutes):",url);
    console.log("Do not share the link; it grants access to staff MAKAtron features.");
  }catch(error){
    console.error("Could not create staff link:",error.message);
    process.exitCode=1;
  }
}
await pool.end();
