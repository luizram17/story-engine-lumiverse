import assert from 'node:assert/strict';

const globalStore = new Map();
const chatStore = new Map();
const events = new Map();
let interceptor = null;
let frontendHandler = null;
const messageUpdates = [];

globalStore.set('story_engine_settings_v4', JSON.stringify({
  enabled:true,
  semanticEnabled:false,
  proseGuardMode:'off',
  randomEvents:false,
  proactivity:false,
  powerActors:false,
  progression:true,
  trackerPostPass:false,
}));

globalThis.spindle = {
  permissions:{ has:()=>true, onChanged:()=>{} },
  variables:{
    global:{ get:async k=>globalStore.get(k), set:async(k,v)=>globalStore.set(k,v) },
    chat:{ get:async(chatId,k)=>chatStore.get(`${chatId}|${k}`), set:async(chatId,k,v)=>chatStore.set(`${chatId}|${k}`,v) },
  },
  registerInterceptor:(fn)=>{interceptor=fn;},
  on:(name,fn)=>{events.set(name,fn);return()=>events.delete(name);},
  onFrontendMessage:(fn)=>{frontendHandler=fn;},
  sendToFrontend:()=>{},
  chats:{getActive:async()=>({id:'chat-smoke',name:'Smoke'})},
  connections:{list:async()=>[]},
  personas:{getActive:async()=>null},
  chat:{
    updateMessage:async(chatId,messageId,patch)=>{messageUpdates.push({chatId,messageId,patch});},
    appendMessage:async()=>({}),
  },
  generate:{quiet:async()=>({content:''})},
  log:{info:()=>{},warn:()=>{},error:()=>{}},
  toast:{success:()=>{},error:()=>{}},
};

await import('../dist/backend.js?smoke=1');
assert.equal(typeof interceptor,'function','backend did not register interceptor');
assert.equal(typeof frontendHandler,'function','backend did not register frontend bridge');
assert.equal(typeof events.get('GENERATION_ENDED'),'function','backend did not register generation finalizer');

const messages=[{role:'user',content:'I carefully climb the unstable wall.'}];
const intercepted=await interceptor(messages,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal'});
assert.equal(intercepted.messages[0].role,'system');
assert.equal(intercepted.breakdown[0].name,'Story Engine · Scene Resolution');
let raw=chatStore.get('chat-smoke|story_engine_state_v6');
let state=JSON.parse(raw);
assert.ok(state.pending,'preflight did not persist pending resolution');
assert.equal(state.turn,0,'preflight must not commit turn');

await events.get('GENERATION_ENDED')({generationId:'g1',chatId:'chat-smoke',messageId:'m1',content:'You find a stable handhold and reach the ledge.'});
raw=chatStore.get('chat-smoke|story_engine_state_v6');
state=JSON.parse(raw);
assert.equal(state.turn,1,'finalizer did not commit turn');
assert.equal(state.pending,null,'finalizer did not clear pending resolution');
assert.equal(state.audits.length,1,'turn audit missing');
assert.ok(messageUpdates.some(x=>x.messageId==='m1'&&x.patch.metadata?.story_engine),'final message metadata was not written');

// Preview/dry-run must be side-effect free.
const before=chatStore.get('chat-smoke|story_engine_state_v6');
const dry=await interceptor(messages,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal',dryRun:true});
assert.equal(dry,messages);
assert.equal(chatStore.get('chat-smoke|story_engine_state_v6'),before);

console.log('Story Engine Spindle runtime smoke passed');
