'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {CodexProcess}=require('../src/codex-process.cjs');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'.artifacts','startup-probe-'+Date.now());
const configFile=path.join(process.env.CODEX_HOME||path.join(os.homedir(),'.codex'),'config.toml');
const configHash=()=>fs.existsSync(configFile)?crypto.createHash('sha256').update(fs.readFileSync(configFile)).digest('hex'):null;
const result={ok:false,accepted:[],invalidMemoryValueRejected:false};
const client=new CodexProcess();
(async()=>{
 const before=configHash();
 try{
  await client.start();
  for(const mode of ['inherit','include','exclude']){
   const params={cwd:root,ephemeral:true,serviceName:'appdock_startup_probe'};
   if(mode!=='inherit')params.config={'memories.use_memories':mode==='include'};
   const response=await client.request('thread/start',params);
   if(!response.thread?.id||response.thread.ephemeral!==true||response.thread.path)throw Error('Test thread must not persist');
   result.accepted.push({mode,ephemeral:true,instructionSourcesCount:response.instructionSources?.length||0});
  }
  try{await client.request('thread/start',{cwd:root,ephemeral:true,config:{'memories.use_memories':'invalid-bool'}});}catch(error){result.invalidMemoryValueRejected=error.code!==undefined;}
  result.configFileUnchanged=before===configHash();
  result.ok=result.accepted.length===3&&result.invalidMemoryValueRejected&&result.configFileUnchanged;
 }finally{await client.close();fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,folder}));}
 if(!result.ok)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1});
