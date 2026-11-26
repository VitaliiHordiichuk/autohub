import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,lstat,rm,symlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {txtAdminWorkflowEnabled,txtActivationEnabled,latestTxtUploadAt,removeReplacedTxtAt} from './SpecialOrderTxtAdminWorkflowService.js';
import {assertProductionTxtLaunchEnabled,workerEnvironment} from './SpecialOrderTxtProductionLaunchService.js';
import {assertProductionTxtStageEnvironment} from './SpecialOrderTxtProductionDatabaseGuard.js';
import {activateMercedesTxtRevision} from './SpecialOrderAdminRevisionService.js';
const oldId='883092b1-e6c1-46cb-b5b3-476f4969ebe6';
const newId='6ed79a21-dc1b-4359-91b1-8d021b75521f';
const root='/home/ubuntu/maka-mercedes-txt-prod-uploads-20261110';
const env={NODE_ENV:'production',MAKA_TXT_ADMIN_WORKFLOW_ENABLED:'true',MAKA_TXT_UPLOAD_MODE:'PRODUCTION_UPLOAD_ONLY',MAKA_TXT_UPLOAD_ROOT:root,DB_NAME:'autohub',DB_PORT:'5432',DB_USER:'autohub_app',DB_HOST:'localhost',DB_PASSWORD:'fictional-test-only',MAKA_TXT_ACTIVATION_ENABLED:'false'};
const bytes=Buffer.alloc(1000,65);
const sha=createHash('sha256').update(bytes).digest('hex');
async function fixture(dir,fileId,createdAt){
 await writeFile(join(dir,`${fileId}.txt`),bytes,{mode:0o600});
 await writeFile(join(dir,`${fileId}.txt.json`),JSON.stringify({fileId,sourceKey:'mercedes-txt',status:'UPLOADED_UNVERIFIED',originalName:'test.txt',sizeBytes:bytes.length,sha256:sha,createdAt}),{mode:0o600});
 return {id:fileId===oldId?1:2,source_key:'mercedes-txt',status:'READY',upload_file_id:fileId,source_sha256:sha};
}
async function inDir(fn){const dir=await mkdtemp(join(tmpdir(),'txt-workflow-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}

test('workflow is opt-in; wrong source, DB, storage, or credentials fail closed',()=>{
 assert.equal(txtAdminWorkflowEnabled(env),true); assert.equal(txtActivationEnabled(env),true);
 for(const [key,value] of Object.entries({NODE_ENV:'test',MAKA_TXT_ADMIN_WORKFLOW_ENABLED:'false',MAKA_TXT_UPLOAD_MODE:'ISOLATED_STAGE',MAKA_TXT_UPLOAD_ROOT:'/tmp',DB_HOST:'remote',DB_PORT:'5545',DB_NAME:'other',DB_USER:'postgres',DB_PASSWORD:''})) {
  const bad={...env,[key]:value};assert.equal(txtAdminWorkflowEnabled(bad),false,key);assert.equal(txtActivationEnabled(bad),false,key);
 }
});
test('admin may import and explicitly activate; worker always has activation disabled and no workflow opt-in',()=>{
 assert.equal(assertProductionTxtLaunchEnabled(env),true);
 const child=workerEnvironment(env);assert.equal(child.MAKA_TXT_ACTIVATION_ENABLED,'false');assert.equal(child.MAKA_TXT_ADMIN_WORKFLOW_ENABLED,undefined);assert.equal(child.DB_HOST,'127.0.0.1');
 assert.equal(assertProductionTxtStageEnvironment(child),true);
 assert.throws(()=>assertProductionTxtStageEnvironment({...child,MAKA_TXT_ACTIVATION_ENABLED:'true'}));
 assert.throws(()=>assertProductionTxtLaunchEnabled({...env,MAKA_TXT_ADMIN_WORKFLOW_ENABLED:'false'}));
});
test('latest valid upload is restored across sessions; technical server paths are never exposed',()=>inDir(async dir=>{
 await fixture(dir,oldId,'2026-11-11T00:00:00Z');await fixture(dir,newId,'2026-11-26T00:00:00Z');
 const latest=await latestTxtUploadAt(dir);assert.equal(latest.fileId,newId);assert.equal('path' in latest,false);
 await rm(join(dir,`${newId}.txt`));assert.equal((await latestTxtUploadAt(dir)).fileId,oldId);
}));
test('malformed metadata, symlinks, unsafe permissions, foreign source do not become current upload',()=>inDir(async dir=>{
 await fixture(dir,oldId,'2026-11-11T00:00:00Z');await fixture(dir,newId,'2026-11-26T00:00:00Z');
 const path=join(dir,`${newId}.txt.json`);const good=await readFile(path,'utf8');
 await writeFile(path,'{');assert.equal((await latestTxtUploadAt(dir)).fileId,oldId);
 await writeFile(path,good);await chmod(path,0o644);assert.equal((await latestTxtUploadAt(dir)).fileId,oldId);
 await chmod(path,0o600);await rm(join(dir,`${newId}.txt`));await symlink(join(dir,`${oldId}.txt`),join(dir,`${newId}.txt`));assert.equal((await latestTxtUploadAt(dir)).fileId,oldId);
}));
test('replacement removes only the old raw TXT, preserving active file, audits and metadata',()=>inDir(async dir=>{
 const old=await fixture(dir,oldId,'2026-11-11T00:00:00Z');await fixture(dir,newId,'2026-11-26T00:00:00Z');
 await writeFile(join(dir,`${oldId}.txt.audit.json`),'audit',{mode:0o600});
 assert.deepEqual(await removeReplacedTxtAt(dir,old,2),{status:'REMOVED',deletedBytes:1000});
 await assert.rejects(lstat(join(dir,`${oldId}.txt`)),{code:'ENOENT'});
 assert.equal((await lstat(join(dir,`${newId}.txt`))).size,1000);
 assert.equal(await readFile(join(dir,`${oldId}.txt.audit.json`),'utf8'),'audit');
 await lstat(join(dir,`${oldId}.txt.json`));
 assert.equal((await removeReplacedTxtAt(dir,old,2)).status,'ALREADY_REMOVED');
}));
test('cleanup refuses active/newer/unimported/foreign sources and path traversal',()=>inDir(async dir=>{
 const old=await fixture(dir,oldId,'2026-11-11T00:00:00Z');
 for(const change of [{id:2},{id:3},{id:0},{status:'IMPORTING'},{status:'FAILED'},{source_key:'email'},{upload_file_id:'../outside'}]) await assert.rejects(removeReplacedTxtAt(dir,{...old,...change},2));
 assert.equal((await lstat(join(dir,`${oldId}.txt`))).size,1000);
}));
test('cleanup refuses changed bytes and symbolic links',()=>inDir(async dir=>{
 const old=await fixture(dir,oldId,'2026-11-11T00:00:00Z');
 await writeFile(join(dir,`${oldId}.txt`),Buffer.alloc(1000,66));await assert.rejects(removeReplacedTxtAt(dir,old,2));
 await rm(join(dir,`${oldId}.txt`));await fixture(dir,newId,'2026-11-26T00:00:00Z');await symlink(join(dir,`${newId}.txt`),join(dir,`${oldId}.txt`));
 await assert.rejects(removeReplacedTxtAt(dir,old,2));assert.equal((await lstat(join(dir,`${newId}.txt`))).size,1000);
}));
const row={id:2,source_key:'mercedes-txt',status:'READY',total_lines:3,eligible_lines:2,rejected_lines:1,upload_file_id:newId,source_sha256:sha};
const job={fileId:newId,sourceKey:'mercedes-txt',status:'READY_NOT_ACTIVATED',importId:2,sha256:sha,expectedLines:3,expectedAccepted:2,expectedUniqueArticles:2,expectedPricingConflicts:0,imported:true,activated:false};
function db({mismatch=false,commitError=false}={}){const calls=[];return {calls,async query(sql){calls.push(sql);if(sql==='COMMIT'&&commitError)throw Error('commit failed');if(['BEGIN','ROLLBACK','COMMIT'].includes(sql))return{rows:[]};if(sql.includes('pg_try_advisory_xact_lock'))return{rows:[{locked:true}]};if(sql.includes('FROM special_order_import_runs'))return{rows:[row]};if(sql.includes('FROM special_order_entries'))return{rows:[{entries:mismatch?1:2,unique_articles:2}]};if(sql.includes('SELECT active_import_id'))return{rows:[{active_import_id:1}]};if(sql.includes('INSERT INTO special_order_sources'))return{rows:[{active_import_id:2}]};throw Error('unexpected query');}};}
async function enabled(fn){const prior=process.env.MAKA_TXT_ACTIVATION_ENABLED;process.env.MAKA_TXT_ACTIVATION_ENABLED='true';try{await fn();}finally{if(prior===undefined)delete process.env.MAKA_TXT_ACTIVATION_ENABLED;else process.env.MAKA_TXT_ACTIVATION_ENABLED=prior;}}
const deps={importId:2,readJob:async()=>job,readClaim:async()=>true,readSourceIntegrity:async()=>true};
test('cleanup runs after COMMIT and only for the previous active revision',()=>enabled(async()=>{
 const client=db();let cleaned=false;
 const result=await activateMercedesTxtRevision({db:client,...deps,cleanup:async args=>{assert.equal(client.calls.at(-1),'COMMIT');assert.equal(args.previousId,1);assert.equal(args.activeId,2);cleaned=true;return{status:'REMOVED',deletedBytes:1000};}});
 assert.equal(cleaned,true);assert.equal(result.status,'ACTIVE');assert.equal(result.cleanup.status,'REMOVED');
}));
test('count mismatch or failed COMMIT never deletes an old TXT',()=>enabled(async()=>{
 for(const config of [{mismatch:true},{commitError:true}]){let cleaned=false;const client=db(config);await assert.rejects(activateMercedesTxtRevision({db:client,...deps,cleanup:async()=>{cleaned=true;}}));assert.equal(cleaned,false);assert.equal(client.calls.at(-1),'ROLLBACK');}
}));
test('cleanup failure reports ACTIVE with pending cleanup; it cannot undo or misreport committed activation',()=>enabled(async()=>{
 const client=db();const result=await activateMercedesTxtRevision({db:client,...deps,cleanup:async()=>{throw Error('permission denied');}});
 assert.equal(result.status,'ACTIVE');assert.equal(result.cleanup.status,'PENDING');assert.equal(client.calls.at(-1),'COMMIT');
}));
