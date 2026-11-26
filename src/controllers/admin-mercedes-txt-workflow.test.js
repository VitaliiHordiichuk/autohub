import test from 'node:test';
import assert from 'node:assert/strict';
import {createMercedesTxtAdminHandlers} from './admin-mercedes-txt.controller.js';
import {requireMercedesTxtActivationEnabled} from '../middleware/mercedes-txt-activation-gate.middleware.js';
const good='6ed79a21-dc1b-4359-91b1-8d021b75521f';
function response(){return {code:200,body:null,headers:{},status(code){this.code=code;return this;},json(data){this.body=data;return this;},set(k,v){this.headers[k]=v;return this;}};}
function handlers(){const seen=[];return {seen,...createMercedesTxtAdminHandlers({getSupplier:async()=>({id:7,name:'Солли + Мерседес'}),readWorkflow:async id=>{seen.push(id);return{capabilities:{import:true,activate:true},latestUpload:{fileId:good},analysis:null,stage:null};}})};}
test('workflow resumes saved file and returns not-started status as data instead of HTTP errors',async()=>{
 const h=handlers(),res=response();await h.workflow({params:{supplierId:'7'},query:{}},res);assert.equal(res.code,200);assert.equal(res.body.sourceKey,'mercedes-txt');assert.equal(res.body.stage,null);assert.equal(res.body.analysis,null);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('workflow supports polling the exact file, rejects traversal, arrays and foreign suppliers before reading files',async()=>{
 const h=handlers();let res=response();await h.workflow({params:{supplierId:'7'},query:{fileId:good}},res);assert.deepEqual(h.seen,[good]);
 for(const bad of ['../env','invalid',[good]]){res=response();await h.workflow({params:{supplierId:'7'},query:{fileId:bad}},res);assert.equal(res.code,400);}
 res=response();await h.workflow({params:{supplierId:'8'},query:{}},res);assert.equal(res.code,404);assert.equal(h.seen.length,1);
});
test('workflow read failure has a safe message and never exposes filesystem paths',async()=>{
 const h=createMercedesTxtAdminHandlers({getSupplier:async()=>({id:7,name:'Солли + Мерседес'}),readWorkflow:async()=>{throw Error('/private/credentials');}});const res=response();await h.workflow({params:{supplierId:'7'},query:{}},res);assert.equal(res.code,503);assert.equal(JSON.stringify(res.body).includes('credentials'),false);
});
test('activation middleware remains disabled unless explicitly opted in',()=>{
 const old=process.env.MAKA_TXT_ACTIVATION_ENABLED;process.env.MAKA_TXT_ACTIVATION_ENABLED='false';
 try{const res=response();let called=false;requireMercedesTxtActivationEnabled({},res,()=>{called=true;});assert.equal(res.code,423);assert.equal(called,false);}finally{if(old===undefined)delete process.env.MAKA_TXT_ACTIVATION_ENABLED;else process.env.MAKA_TXT_ACTIVATION_ENABLED=old;}
});
