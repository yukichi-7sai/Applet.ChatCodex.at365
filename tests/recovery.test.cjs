'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Chat}=require('../src/chat.cjs'),{CodexProcess}=require('../src/codex-process.cjs'),{recoveryContinuation}=require('../src/session.cjs');
async function until(check){const end=Date.now()+8000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('Timed out');}
function fixture(t){
  const base=path.resolve(__dirname,'../.artifacts/recovery-tests');fs.mkdirSync(base,{recursive:true});
  const folder=fs.mkdtempSync(path.join(base,'case-')),file=path.join(folder,'state.json'),values=new Map(),calls=[];
  const make=()=>{const chat=new Chat({storage:{get:async key=>values.get(key),set:async(key,value)=>values.set(key,structuredClone(value))},getHostInfo:async()=>({instanceId:'recovery-fixture'}),clientFactory:()=>{
    const client=new CodexProcess({command:{file:process.execPath,args:[path.join(__dirname,'fixtures/server.cjs')]},env:{...process.env,CHATCODEX_FIXTURE_STATE:file}});
    const request=client.request.bind(client);client.request=(method,params,...rest)=>{calls.push({method,params:structuredClone(params)});return request(method,params,...rest);};return client;
  }});t.after(()=>chat.close());return chat;};
  const mode=recoveryRead=>{const state=JSON.parse(fs.readFileSync(file,'utf8'));state.recoveryRead=recoveryRead;fs.writeFileSync(file,JSON.stringify(state));};
  return{make,values,calls,mode};
}
async function connect(chat){chat.connect(chat.generation);await until(()=>['idle','error'].includes(chat.state)&&!chat.usageOperation);assert.equal(chat.state,'idle',chat.detail);}
async function interrupted(c){const first=c.make();await connect(first);first.send(first.generation,'original','切断再開テスト');await until(()=>first.state==='error');await first.close();c.calls.length=0;const next=c.make();await connect(next);assert.ok(next.interruption);return next;}
test('実stdio: 切断後の復元は自動送信せず、最新状態を確認して継続依頼だけを1回送る',async t=>{
  const c=fixture(t),chat=await interrupted(c),id=chat.interruption.id,thread=chat.threadId;
  assert.equal(c.calls.some(call=>call.method==='turn/start'),false);await chat.selectApproval(chat.generation,'full');await chat.selectApproval(chat.generation,'inherit');
  chat.recover(chat.generation,'continue',id);chat.recover(chat.generation,'continue',id);
  await until(()=>chat.state==='idle'&&!chat.interruption);chat.recover(chat.generation,'continue',id);
  const sends=c.calls.filter(call=>call.method==='turn/start');assert.equal(sends.length,1);assert.equal(sends[0].params.threadId,thread);
  assert.deepEqual(sends[0].params.input,[{type:'text',text:recoveryContinuation}]);assert.equal(sends[0].params.sandboxPolicy.type,'readOnly');
  assert.equal(c.calls.filter(call=>call.method==='thread/read').length,1);assert.equal(c.values.get('lastSession').inFlight,false);
});
test('実stdio: 活動中・別会話・別cwd・不明な状態・API失敗では入力を送らず、明示的に再確認できる',async t=>{
  const c=fixture(t),chat=await interrupted(c),id=chat.interruption.id;
  for(const mode of ['active','wrong','cwd','notLoaded','systemError','error']){
    c.mode(mode);chat.recover(chat.generation,'check-'+mode,id);await until(()=>chat.state==='idle');assert.ok(chat.interruption.note);assert.equal(c.calls.some(call=>call.method==='turn/start'),false);
  }
  assert.throws(()=>chat.recover(chat.generation-1,'old',id));assert.throws(()=>chat.recover(chat.generation,'bad','old-id'));
  c.mode('normal');chat.recover(chat.generation,'valid',id);await until(()=>chat.state==='idle'&&!chat.interruption);
  assert.equal(c.calls.filter(call=>call.method==='turn/start').length,1);
});
test('実stdio: 確認中は他操作を受け付けず、終了後の遅れた成功から送信しない',async t=>{
  const c=fixture(t),chat=await interrupted(c);let release;
  const request=chat.client.request.bind(chat.client);chat.client.request=(method,params,timeout)=>method==='thread/read'?new Promise(resolve=>{assert.equal(timeout,10000);release=resolve;}):request(method,params,timeout);
  chat.recover(chat.generation,'pending',chat.interruption.id);assert.equal(chat.state,'checkingRecovery');
  assert.throws(()=>chat.send(chat.generation,'other','別の入力'));await assert.rejects(chat.newChat(chat.generation));await assert.rejects(chat.selectApproval(chat.generation,'full'));
  const thread=chat.threadId,cwd=chat.session.cwd;await chat.close();release({thread:{id:thread,cwd,status:{type:'idle'},ephemeral:false}});await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(c.calls.some(call=>call.method==='turn/start'),false);assert.equal(c.values.get('lastSession').inFlight,true);
});
test('実stdio: 利用制限とコンテキスト上限の専用復旧を一般続行で回避しない',async t=>{
  for(const text of ['利用枠制限','コンテキスト制限']){
    const c=fixture(t),first=c.make();await connect(first);first.send(first.generation,'limit',text);await until(()=>first.state==='idle'&&!first.usageOperation);await first.close();c.calls.length=0;
    const next=c.make();await connect(next);assert.ok(next.interruption);assert.throws(()=>next.recover(next.generation,'wrong-path',next.interruption.id));assert.equal(c.calls.some(call=>call.method==='turn/start'),false);
  }
});
test('実stdio: 正常完了の復元では続行要求を提示せず、通常入力と新規会話で案内を解除する',async t=>{
  const c=fixture(t),first=c.make();await connect(first);first.send(first.generation,'done','正常な完了');await until(()=>first.state==='idle');await first.close();
  const next=c.make();await connect(next);assert.equal(next.interruption,null);assert.throws(()=>next.recover(next.generation,'unnecessary','none'));
  next.session.inFlight=true;await next.sessions.save(next.session);await next.close();const third=c.make();await connect(third);assert.ok(third.interruption);
  third.send(third.generation,'manual','自分で状態を確認してください');assert.equal(third.interruption,null);await until(()=>third.state==='idle');await third.newChat(third.generation);assert.equal(third.read(0,0).interruption,null);
});
