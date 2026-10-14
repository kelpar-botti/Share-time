import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShiftSyncHandler } from '../src/lib/shift-sync/handler.mjs';
import { JobcanError } from '../src/lib/shift-sync/jobcan.mjs';

const token='t'.repeat(64);
const config={SHIFT_SYNC_TOKEN:token,SHIFT_SYNC_ENABLED:'true',ADMIN_EMAIL:'owner@example.test',JOBCAN_CLIENT_ID:'company',JOBCAN_EMAIL:'owner@example.test',JOBCAN_PASSWORD:'secret',JOBCAN_STAFF_CODE:'123'};
const request=(body,headers={},method='POST')=>new Request('https://example.test/api/integrations/jobcan',{method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...headers},...(method==='POST'?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
function setup(settings=config){let touched=0;const handle=createShiftSyncHandler({env:()=>settings,getDb:()=>{touched++;throw new Error('DB must not be reached');}});return {handle,touched:()=>touched};}
test('unauthenticated requests do not initialize database or leak configuration',async()=>{
  const s=setup(); const r=await s.handle(request({}, {authorization:'Bearer wrong'}));
  assert.equal(r.status,401); assert.equal(s.touched(),0); assert.equal((await r.json()).persisted,false);
});
test('GET and browser requests cannot trigger writes',async()=>{
  const s=setup();assert.equal((await s.handle(request(undefined,{},'GET'))).status,405);
  assert.equal((await s.handle(request({}, {origin:'https://example.test'}))).status,403);assert.equal(s.touched(),0);
});
test('unconfigured or disabled integration cannot touch database',async()=>{
  const off=setup({...config,SHIFT_SYNC_ENABLED:'false'});assert.equal((await off.handle(request({}))).status,503);assert.equal(off.touched(),0);
  const incomplete=setup({...config,JOBCAN_PASSWORD:''});assert.equal((await incomplete.handle(request({}))).status,503);assert.equal(incomplete.touched(),0);
});
test('oversized, invalid and account-selecting input fail before database',async()=>{
  for(const body of ['x'.repeat(4100),'{', {notification:{},ownerEmail:'attacker@example.test'}, {notification:{url:'https://example.org'}},{notification:{},dryRun:'true'}]){
    const s=setup();const r=await s.handle(request(body));assert.equal(r.status,400);assert.equal(s.touched(),0);
  }
});

test('Jobcan diagnostics log only fixed code and reason without exception details',async t=>{
  const logs=[];
  t.mock.method(console,'warn',(...args)=>logs.push(args));
  const failure=new JobcanError('JOBCAN_PARSE','https://private.example/?token=private-password','MONTH_TAB');
  const handle=createShiftSyncHandler({env:()=>config,getDb:()=>{throw failure;}});
  const r=await handle(request({notification:{},dryRun:true}));
  assert.equal(r.status,502);
  const result=await r.json();
  assert.equal(result.error.code,'JOBCAN_PARSE');
  assert.equal(result.persisted,false);
  assert.deepEqual(logs,[['Share Time Jobcan diagnostic','JOBCAN_PARSE','MONTH_TAB']]);
  assert.ok(!JSON.stringify({logs,result}).includes('private-password'));
  assert.equal(result.error.reason,undefined);
});
test('diagnostic logging rejects injected labels even if an error reason is mutated',async t=>{
  const logs=[];
  t.mock.method(console,'warn',(...args)=>logs.push(args));
  const failure=new JobcanError('JOBCAN_PARSE','private credential');
  failure.reason='SECRETUPPERCASEVALUE';
  const handle=createShiftSyncHandler({env:()=>config,getDb:()=>{throw failure;}});
  assert.equal((await handle(request({notification:{},dryRun:true}))).status,502);
  assert.deepEqual(logs,[['Share Time Jobcan diagnostic','JOBCAN_PARSE','UNSPECIFIED']]);
});
