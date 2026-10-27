import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../account/storage.mjs';
import { ProgressSync } from '../account/sync.mjs';
const ids = new Set(['a','b']);
const categories = new Set(['g1']);
function fixture() {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) };
  return { a: new AccountStore(storage,'a',{ids,categories}), b: new AccountStore(storage,'b',{ids,categories}) };
}
function snapshot(marks=[],ack=[]) { return { complete:true, marks, acknowledgedOperationIds:ack, conflicts:[], view:null }; }
test('an account switch discards the old account response and keeps its queue', async () => {
  const {a,b}=fixture(); a.enqueueMarks([{cardId:'a',status:'known'}]);
  let resolve; const pending=new Promise(r=>{resolve=r;}); const applied=[];
  const sync=new ProgressSync({api:{sync:()=>pending},onSnapshot:s=>applied.push(s),onState:()=>{}});
  sync.setAccount(a); const running=sync.run(); sync.setAccount(b);
  resolve(snapshot([{cardId:'a',status:'known',revision:1}])); await running;
  assert.equal(a.read().outbox.length,1);
  assert.deepEqual(b.visibleMarks(),{});
  assert.equal(applied.length,0);
});
test('offline does not call the API or remove pending changes', async () => {
  const {a}=fixture();a.enqueueMarks([{cardId:'a',status:'weak'}]);let calls=0;
  const sync=new ProgressSync({api:{sync:async()=>{calls++;return snapshot();}},isOnline:()=>false,onSnapshot:()=>{},onState:()=>{}});
  sync.setAccount(a);await sync.run(); assert.equal(calls,0);assert.equal(a.read().outbox.length,1);
});
test('retry after an ambiguous failure sends the original operation ID', async () => {
  const {a}=fixture();a.enqueueMarks([{cardId:'a',status:'weak'}]);let calls=0;const idsSent=[];
  const api={sync:async batch=>{
    if(!batch.operations.length)return snapshot();
    idsSent.push(batch.operations[0].operationId);
    if(++calls===1)throw new Error('network');
    return snapshot([{cardId:'a',status:'weak',revision:1}],idsSent.slice(-1));
  }};
  const sync=new ProgressSync({api,onSnapshot:()=>{},onState:()=>{}});sync.setAccount(a);
  await sync.run();assert.equal(a.read().outbox.length,1);await sync.run();
  assert.equal(idsSent.length,2);assert.equal(idsSent[0],idsSent[1]);assert.equal(a.read().outbox.length,0);
});
test('mutation during an in-flight upload runs a second round without losing either card', async () => {
  const {a}=fixture();a.enqueueMarks([{cardId:'a',status:'known'}]);
  const cloud=new Map(); let release;const gate=new Promise(r=>{release=r;});let held=false;
  const api={sync:async batch=>{
    if(batch.operations.length&&!held){held=true;await gate;}
    const ack=[];for(const op of batch.operations){cloud.set(op.cardId,{cardId:op.cardId,status:op.status,revision:1});ack.push(op.operationId);}
    return snapshot([...cloud.values()],ack);
  }};
  const sync=new ProgressSync({api,onSnapshot:()=>{},onState:()=>{}});sync.setAccount(a);
  const running=sync.run();
  while(!held)await new Promise(resolve=>setImmediate(resolve));
  a.enqueueMarks([{cardId:'b',status:'weak'}]);sync.run();release();await running;
  assert.deepEqual(a.visibleMarks(),{a:'known',b:'weak'});assert.equal(a.hasPending(),false);
});
