import assert from 'node:assert/strict';

const globalStore = new Map();
const chatStore = new Map();
const events = new Map();
let interceptor = null;
let frontendHandler = null;
let activeChatUserId = null;
let connectionListUserId = null;
let lastFrontendPayload = null;
const messageUpdates = [];
let activePersona = {id:'persona-old',name:'Old Hero',title:'Veteran',description:'A nimble veteran scout with a bow.',attached_world_book_id:'wb-1'};
const createdPersonas=[];
let switchedPersonaId=null;
let personaUpdateCalls=0;
const userSettingsStore=new Map();
let savedSettingsUserId=null;
const quietUserIds=[];

globalStore.set('story_engine_settings_v4', JSON.stringify({
  enabled:true,
  semanticEnabled:false,
  proseGuardMode:'off',
  randomEvents:false,
  proactivity:false,
  powerActors:false,
  progression:true,
  trackerPostPass:false,
  oocCommandsEnabled:true,
  autoBootstrapExistingChat:false,
}));

globalThis.spindle = {
  permissions:{ has:()=>true, onChanged:()=>{} },
  userStorage:{
    getJson:async(path,opts={})=>userSettingsStore.get(`${opts.userId}|${path}`)??opts.fallback,
    setJson:async(path,value,opts={})=>{savedSettingsUserId=opts.userId;userSettingsStore.set(`${opts.userId}|${path}`,value);},
  },
  variables:{
    global:{ get:async k=>globalStore.get(k), set:async(k,v)=>globalStore.set(k,v) },
    chat:{ get:async(chatId,k)=>chatStore.get(`${chatId}|${k}`), set:async(chatId,k,v)=>chatStore.set(`${chatId}|${k}`,v) },
  },
  registerInterceptor:(fn)=>{interceptor=fn;},
  on:(name,fn)=>{events.set(name,fn);return()=>events.delete(name);},
  onFrontendMessage:(fn)=>{frontendHandler=fn;},
  sendToFrontend:(payload)=>{lastFrontendPayload=payload;},
  chats:{getActive:async(userId)=>{activeChatUserId=userId;return{id:'chat-smoke',name:'Smoke',userId};}},
  connections:{list:async(userId)=>{connectionListUserId=userId;return[{id:'profile-1',name:'Assistant',provider:'openai',model:'gpt-test',is_default:true,has_api_key:true}];},get:async(id)=>({id,name:'Assistant',provider:'openai',model:'gpt-test',has_api_key:true})},
  personas:{getActive:async()=>activePersona,create:async(input)=>{const p={id:`persona-${createdPersonas.length+1}`,...input};createdPersonas.push(p);return p;},switchActive:async(id)=>{switchedPersonaId=id;if(id){const found=createdPersonas.find(p=>p.id===id);if(found)activePersona=found;}},update:async()=>{personaUpdateCalls++;}},
  chat:{
    updateMessage:async(chatId,messageId,patch)=>{messageUpdates.push({chatId,messageId,patch});},
    appendMessage:async()=>({}),
    getMessages:async()=>[{id:'h1',role:'user',content:'We arrive in Emberfall.'},{id:'h2',role:'assistant',content:'Mira, your childhood best friend, greets you at the gate.'},{id:'h3',role:'user',content:'I hug Mira.'}],
  },
  generate:{quiet:async(req,userId)=>{quietUserIds.push(userId);const system=String(req?.messages?.[0]?.content||'');if(system.includes("Command Assistant"))return{tool_calls:[{name:'apply_story_state_changes',args:{summary:'Moved the scene.',operations:[{op:'set',path:['world','location'],value:'Commanded Place'}]}}]};if(system.includes("History Import Assistant"))return{tool_calls:[{name:'apply_story_history_import',args:{summary:'Imported established history.',operations:[{op:'set',path:['world','location'],value:'Emberfall'},{op:'merge',path:['npcs','Mira'],value:{name:'Mira',role:'companion',rank:'Average',bond:4,companion:true,relationshipDescriptors:['childhood best friend'],personalitySummary:'Old and trusted friend.'}}]}}]};if(system.includes('CURRENT LUMIVERSE PERSONA'))return{tool_calls:[{name:'submit_character_sheet',args:{name:'Old Hero',race:'Human',genre:'Fantasy',appearance:'Nimble veteran scout',stats:{PHY:6,MND:5,CHA:4},naturalWeapons:[],abilities:['Scouting','Archery'],spells:[],inventory:['Bow'],currency:[],gear:['Travel cloak'],anchors:['Veteran scout'],concept:'Scout',backstory:'Experienced traveler'}}]};return{content:''};}},
  log:{info:()=>{},warn:()=>{},error:()=>{}},
  toast:{success:()=>{},error:()=>{}},
};

await import('../dist/backend.js?smoke=1');
assert.equal(typeof interceptor,'function','backend did not register interceptor');
assert.equal(typeof frontendHandler,'function','backend did not register frontend bridge');
assert.equal(typeof events.get('GENERATION_ENDED'),'function','backend did not register generation finalizer');
assert.equal(typeof events.get('CHAT_SWITCHED'),'function','backend did not register chat switch tracking');
await frontendHandler({type:'get_dashboard'},'user-smoke');
assert.equal(activeChatUserId,undefined,'dashboard should use host-scoped getActive() and rely on frontend/event hints for user routing');
assert.equal(connectionListUserId,'user-smoke','dashboard did not list connections in user scope');
assert.equal(lastFrontendPayload?.chatId,'chat-smoke');
assert.equal(lastFrontendPayload?.connections?.[0]?.model,'gpt-test');

await frontendHandler({type:'save_settings',chatId:'chat-smoke',settings:{semanticTemperature:0.22}},'user-smoke');
assert.equal(savedSettingsUserId,'user-smoke','settings were not saved in operator-safe per-user storage');
assert.equal(userSettingsStore.get('user-smoke|settings.json').semanticTemperature,0.22);

const messages=[{role:'user',content:'I carefully climb the unstable wall.'}];
const intercepted=await interceptor(messages,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal',userId:'user-smoke'});
assert.equal(intercepted.messages[0].role,'system');
assert.equal(intercepted.breakdown[0].name,'Story Engine · Scene Resolution');
let raw=chatStore.get('chat-smoke|story_engine_state_v7');
let state=JSON.parse(raw);
assert.ok(state.pending,'preflight did not persist pending resolution');
assert.equal(state.turn,0,'preflight must not commit turn');

await events.get('GENERATION_ENDED')({generationId:'g1',chatId:'chat-smoke',messageId:'m1',content:'You find a stable handhold and reach the ledge.'});
raw=chatStore.get('chat-smoke|story_engine_state_v7');
state=JSON.parse(raw);
assert.equal(state.turn,1,'finalizer did not commit turn');
assert.equal(state.pending,null,'finalizer did not clear pending resolution');
assert.equal(state.audits.length,1,'turn audit missing');
assert.ok(messageUpdates.some(x=>x.messageId==='m1'&&x.patch.metadata?.story_engine),'final message metadata was not written');

// Preview/dry-run must be side-effect free.
const before=chatStore.get('chat-smoke|story_engine_state_v7');
const dry=await interceptor(messages,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal',dryRun:true,userId:'user-smoke'});
assert.equal(dry,messages);
assert.equal(chatStore.get('chat-smoke|story_engine_state_v7'),before);

// Mixed OOC commands are handled outside the IC text and applied before scene resolution.
const mixed=[{role:'assistant',content:'The road is quiet.'},{role:'user',content:'I smile. ((Move us to Commanded Place))'}];
const mixedResult=await interceptor(mixed,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal',userId:'user-smoke'});
assert.equal(mixedResult.messages.at(-1).content,'I smile.');
state=JSON.parse(chatStore.get('chat-smoke|story_engine_state_v7'));
assert.equal(state.world.location,'Commanded Place');
assert.equal(state.commandHistory.length,1);
state.pending=null;chatStore.set('chat-smoke|story_engine_state_v7',JSON.stringify(state));

// Manual history import reads canonical stored messages and reconstructs established relationships.
await frontendHandler({type:'import_existing_history',chatId:'chat-smoke'},'user-smoke');
state=JSON.parse(chatStore.get('chat-smoke|story_engine_state_v7'));
assert.equal(state.bootstrap.status,'ready');
assert.equal(state.bootstrap.sourceMessageCount,3);
assert.equal(state.world.location,'Emberfall');
assert.equal(state.npcs.Mira.bond,4);
assert.deepEqual(state.npcs.Mira.relationshipDescriptors,['childhood best friend']);
assert.ok(state.health.npcs.Mira);

// AI conversion creates and selects a new persona; the source persona is not overwritten.
activePersona={id:'persona-old',name:'Old Hero',title:'Veteran',description:'A nimble veteran scout with a bow.',attached_world_book_id:'wb-1'};
await frontendHandler({type:'convert_active_persona',chatId:'chat-smoke'},'user-smoke');
assert.equal(personaUpdateCalls,0);
assert.equal(createdPersonas.length,1);
assert.equal(switchedPersonaId,createdPersonas[0].id);
assert.equal(createdPersonas[0].attached_world_book_id,'wb-1');
state=JSON.parse(chatStore.get('chat-smoke|story_engine_state_v7'));
assert.equal(state.player.stats.PHY+state.player.stats.MND+state.player.stats.CHA,15);
assert.ok(quietUserIds.filter(Boolean).every(id=>id==='user-smoke'),'quiet generation leaked or lost operator user scope');

console.log('Story Engine Spindle runtime smoke passed');
