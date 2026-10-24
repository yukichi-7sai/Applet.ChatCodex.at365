'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sanitize,wireView,format}=require('../src/diagnostics.cjs');
const {normalizeSettings,threadConfig}=require('../src/chat-settings.cjs');
const {createApplet}=require('../src/applet.cjs');
test('構造化結果・JSON文字列・URL・認証ヘッダーの秘密値を伏せる',()=>{
 const value={apiKey:'key-secret',nested:{MY_ACCESS_TOKEN:'token-secret'},text:'Bearer secret-value sk-longsecretvalue https://user:password@example.test/?token=secretquery MY_TOKEN=env-secret',json:'{"clientSecret":"json-secret"}'};
 const text=format(value);
 for(const secret of ['key-secret','token-secret','secret-value','sk-longsecretvalue','user:password','secretquery','json-secret','env-secret'])assert.ok(!text.includes(secret),secret);
 assert.ok(text.includes('[伏せ字]'));
});
test('認証・設定RPCの応答と、未公開の思考本文を通信ログへ流さない',()=>{
 for(const method of ['account/read','account/login/start','config/read','mcpServer/oauth/login'])
  assert.ok(!JSON.stringify(wireView({method,message:{id:1,result:{arbitrary:'hidden-secret'}}})).includes('hidden-secret'));
 assert.ok(!JSON.stringify(wireView({message:{id:1,result:{arbitrary:'late-secret'}}})).includes('late-secret'));
 assert.ok(!JSON.stringify(wireView({method:'item/reasoning/textDelta',message:{params:{delta:'private-reasoning'}}})).includes('private-reasoning'));
 assert.ok(!JSON.stringify(sanitize({type:'reasoning',summary:['summary'],content:['private-reasoning']})).includes('private-reasoning'));
});
test('長文・深い構造を制限し、表示へHTMLを実行可能な値として渡さない',()=>{
 assert.ok(format({text:'a'.repeat(100000)}).length<17000);
 const value={};value.self=value;assert.doesNotThrow(()=>sanitize(value));
 assert.equal(sanitize('<script>fixture</script>'),'<script>fixture</script>'); // UI uses textContent, never HTML.
});
test('表示設定の既定値とメモリの会話単位指定',()=>{
 assert.deepEqual(normalizeSettings(),{displayMode:'normal',wireLogEnabled:false,sendKey:'ctrl-enter',sendOperationInstructions:true,memoryMode:'inherit'});
 const legacy={displayMode:'trace'};
 assert.equal(normalizeSettings(legacy).displayMode,'detail');
 assert.equal(normalizeSettings(legacy).wireLogEnabled,false);
 assert.deepEqual(legacy,{displayMode:'trace'});
 assert.equal(normalizeSettings({wireLogEnabled:true}).wireLogEnabled,true);
 assert.equal(normalizeSettings({wireLogEnabled:'true'}).wireLogEnabled,false);
 assert.equal(normalizeSettings({sendKey:'enter'}).sendKey,'enter');
 assert.equal(normalizeSettings({sendKey:'unknown'}).sendKey,'ctrl-enter');
 assert.deepEqual(threadConfig({memoryMode:'inherit'}),{});
 assert.deepEqual(threadConfig({memoryMode:'exclude'}),{config:{'memories.use_memories':false}});
 assert.deepEqual(threadConfig({memoryMode:'include'}),{config:{'memories.use_memories':true}});
 assert.equal(normalizeSettings({displayMode:'invalid'}).displayMode,'normal');
});
test('共通設定の新キーを優先し、継承時だけ旧値を読んで保存値を変更しない',async()=>{
 const values={displayMode:'trace'};let changed,disposed=false;
 const app=createApplet();
 await app.activate({settings:{get:(key,fallback)=>values[key]??fallback,onChanged:handler=>{changed=handler;return()=>{disposed=true;};}},
  storage:{},appdock:{},pages:{notifyChanged:()=>{}},commands:{register:()=>{}}});
 const read=()=>app.onPageAction('chat.read',{generation:0,after:0},'main');
 try{
  assert.equal((await read()).displayMode,'detail');assert.equal((await read()).wireLogEnabled,false);
  values.wireLogEnabled=true;changed();assert.equal((await read()).wireLogEnabled,true);
  values.chatDisplayMode='normal';changed();assert.equal((await read()).displayMode,'normal');
  values.chatDisplayMode='detail';changed();assert.equal((await read()).displayMode,'detail');
  delete values.chatDisplayMode;changed();assert.equal((await read()).displayMode,'detail');
  assert.deepEqual(values,{displayMode:'trace',wireLogEnabled:true});
 }finally{await app.deactivate();}
 assert.equal(disposed,true);
});
