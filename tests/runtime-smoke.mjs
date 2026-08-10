import assert from 'node:assert/strict';

const globalStore = new Map();
const chatStore = new Map();
const events = new Map();
let interceptor = null;
let frontendHandler = null;
let activeChatLookups = 0;
let activePersonaLookups = 0;
let connectionListUserId = null;
let lastFrontendPayload = null;
let lastFrontendUserId = null;
let appendMessageCalls = 0;
let getMessagesCalls = 0;
let lastQuietUserId = null;
let lastGenerationRequestUserId = null;
let rawGenerationCalls = 0;
let forceQuietScopeFailure = false;
const messageUpdates = [];
let activePersona = {id:'persona-old',name:'Old Hero',title:'Veteran',description:'A nimble veteran scout with a bow.',attached_world_book_id:'wb-1'};
const createdPersonas=[];
let switchedPersonaId=null;
let personaUpdateCalls=0;
const userSettingsStore=new Map();
let savedSettingsUserId=null;
const quietConnectionIds=[];

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
  autoBootstrapExistingChat:true,
}));

const generationResponder=async(req,userId,isRaw=false)=>{
  lastQuietUserId=userId;
  lastGenerationRequestUserId=req?.userId||null;
  assert.equal(req?.userId,'user-smoke','operator-scoped sidecar request must carry userId inside the generation request');
  assert.equal(userId,'user-smoke','operator-scoped sidecar generation must retain callback userId');
  quietConnectionIds.push(req?.connection_id||'');
  const system=String(req?.messages?.[0]?.content||'');
  if(system.includes("Command Assistant"))return{tool_calls:[{name:'apply_story_state_changes',args:{summary:'Moved the scene.',operations:[{op:'set',path:['world','location'],value:'Commanded Place'}]}}]};
  if(system.includes("History Import Assistant"))return{tool_calls:[{name:'apply_story_history_import',args:{summary:'Imported established history.',operations:[{op:'set',path:['world','location'],value:'Emberfall'},{op:'set',path:['world','presentNpcs'],value:['Mira']},{op:'merge',path:['npcs','Mira'],value:{name:'Mira',role:'companion',rank:'Average',bond:4,companion:true,relationshipDescriptors:['childhood best friend'],personalitySummary:'Old and trusted friend.',inventory:['Old map'],conditions:['protective oath'],romanceStyle:'auto',standingInfluence:'none'}}]}}]};
  if(system.includes('CURRENT LUMIVERSE PERSONA'))return{tool_calls:[{name:'submit_character_sheet',args:{name:'Old Hero',race:'Human',genre:'Fantasy',appearance:'Nimble veteran scout',stats:{PHY:6,MND:5,CHA:4},naturalWeapons:[],abilities:['Scouting','Archery'],spells:[],inventory:['Bow'],currency:[],gear:['Travel cloak'],anchors:['Veteran scout'],concept:'Scout',backstory:'Experienced traveler'}}]};
  if(system.includes('Create a concise player character sheet'))return{tool_calls:[{name:'submit_character_sheet',args:{name:'Manual Hero',race:'Human',genre:'Fantasy',appearance:'A road-worn traveler',stats:{PHY:5,MND:5,CHA:5},naturalWeapons:[],abilities:['Travel'],spells:[],inventory:['Rope'],currency:[],gear:['Travel clothes'],anchors:['Practical traveler'],concept:'Traveler',backstory:'Has spent years on the road.'}}]};
  return{content:''};
};

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
  sendToFrontend:(payload,userId)=>{lastFrontendPayload=payload;lastFrontendUserId=userId;},
  chats:{getActive:async(userId)=>{activeChatLookups++;assert.equal(userId,'user-smoke','operator-scoped active chat lookup must receive userId');return{id:'chat-smoke',name:'Smoke'};}},
  connections:{list:async(userId)=>{connectionListUserId=userId;return[{id:'profile-1',name:'Assistant',provider:'openai',model:'gpt-test',is_default:true,has_api_key:true}];},get:async(id,userId)=>{if(userId)connectionListUserId=userId;return{id,name:'Assistant',provider:'openai',model:'gpt-test',is_default:id==='profile-1',has_api_key:true};}},
  personas:{
    getActive:async()=>{activePersonaLookups++;return activePersona;},
    get:async(id)=>createdPersonas.find(p=>p.id===id)|| (activePersona?.id===id?activePersona:null),
    create:async(input)=>{const p={id:`persona-${createdPersonas.length+1}`,...input};createdPersonas.push(p);return p;},
    switchActive:async(id)=>{switchedPersonaId=id;if(id){const found=createdPersonas.find(p=>p.id===id);if(found)activePersona=found;}},
    update:async()=>{personaUpdateCalls++;}
  },
  chat:{
    updateMessage:async(chatId,messageId,patch)=>{messageUpdates.push({chatId,messageId,patch});},
    appendMessage:async()=>{appendMessageCalls++;return{};},
    getMessages:async()=>{getMessagesCalls++;return[{id:'h1',role:'user',content:'We arrive in Emberfall.'},{id:'h2',role:'assistant',content:'Mira, your childhood best friend, greets you at the gate.'},{id:'h3',role:'user',content:'I hug Mira.'}];},
  },
  generate:{
    quiet:async(req,userId)=>{if(forceQuietScopeFailure){forceQuietScopeFailure=false;throw new Error('userId is required for operator-scoped extensions');}return generationResponder(req,userId,false);},
    raw:async(req,userId)=>{rawGenerationCalls++;return generationResponder(req,userId,true);},
  },
  log:{info:()=>{},warn:()=>{},error:()=>{}},
  toast:{success:()=>{},error:()=>{}},
};

await import('../dist/backend.js?smoke=1');
assert.equal(typeof interceptor,'function','backend did not register interceptor');
assert.equal(typeof frontendHandler,'function','backend did not register frontend bridge');
assert.equal(typeof events.get('GENERATION_ENDED'),'function','backend did not register generation finalizer');
assert.equal(typeof events.get('CHAT_SWITCHED'),'function','backend did not register chat switch tracking');
assert.equal(typeof events.get('PERSONA_CHANGED'),'function','backend did not register persona-change tracking');
assert.equal(typeof events.get('SETTINGS_UPDATED'),'function','backend did not register activeChatId settings tracking');
await frontendHandler({type:'get_dashboard'},'user-smoke');
assert.ok(activeChatLookups>0,'dashboard did not resolve the active chat');
assert.equal(connectionListUserId,'user-smoke','dashboard did not list connections in user scope');
assert.ok(activePersonaLookups>0,'dashboard did not resolve the active persona');
assert.equal(lastFrontendUserId,'user-smoke','dashboard response was not targeted to the originating operator user');
assert.equal(lastFrontendPayload?.activePersona?.id,'persona-old','dashboard failed to expose the active persona');
assert.equal(lastFrontendPayload?.chatId,'chat-smoke');
assert.equal(lastFrontendPayload?.connections?.[0]?.model,'gpt-test');
assert.equal(appendMessageCalls,0,'opening/attaching Story Engine must never inject a synthetic Start Adventure message');
await new Promise(r=>setTimeout(r,5));
assert.equal(getMessagesCalls,0,'dashboard attachment must not launch history import as a detached backend task');

await frontendHandler({type:'save_settings',chatId:'chat-smoke',settings:{semanticTemperature:0.22}},'user-smoke');
assert.equal(savedSettingsUserId,'user-smoke','settings were not saved in operator-safe per-user storage');
assert.equal(userSettingsStore.get('user-smoke|settings.json').semanticTemperature,0.22);

const messages=[{role:'user',content:'I carefully climb the unstable wall.'}];
const intercepted=await interceptor(messages,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal',userId:'user-smoke'});
assert.equal(intercepted.messages[0].role,'system');
assert.equal(intercepted.breakdown[0].name,'Story Engine · Scene Resolution');
let raw=chatStore.get('chat-smoke|story_engine_state_v10');
let state=JSON.parse(raw);
assert.ok(state.pending,'preflight did not persist pending resolution');
assert.equal(state.turn,0,'preflight must not commit turn');

await events.get('GENERATION_ENDED')({generationId:'g1',chatId:'chat-smoke',messageId:'m1',content:'You find a stable handhold and reach the ledge.'});
raw=chatStore.get('chat-smoke|story_engine_state_v10');
state=JSON.parse(raw);
assert.equal(state.turn,1,'finalizer did not commit turn');
assert.equal(state.pending,null,'finalizer did not clear pending resolution');
assert.equal(state.audits.length,1,'turn audit missing');
assert.ok(messageUpdates.some(x=>x.messageId==='m1'&&x.patch.metadata?.story_engine),'final message metadata was not written');

// Preview/dry-run must be side-effect free.
const before=chatStore.get('chat-smoke|story_engine_state_v10');
const dry=await interceptor(messages,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal',dryRun:true,userId:'user-smoke'});
assert.equal(dry,messages);
assert.equal(chatStore.get('chat-smoke|story_engine_state_v10'),before);

// Mixed OOC commands are handled outside the IC text and applied before scene resolution.
const mixed=[{role:'assistant',content:'The road is quiet.'},{role:'user',content:'I smile. ((Move us to Commanded Place))'}];
const mixedResult=await interceptor(mixed,{chatId:'chat-smoke',connectionId:'conn',generationType:'normal',userId:'user-smoke'});
assert.equal(mixedResult.messages.at(-1).content,'I smile.');
state=JSON.parse(chatStore.get('chat-smoke|story_engine_state_v10'));
assert.equal(state.world.location,'Commanded Place');
assert.equal(state.commandHistory.length,1);
state.pending=null;chatStore.set('chat-smoke|story_engine_state_v10',JSON.stringify(state));

// Manual history import reads canonical stored messages and reconstructs established relationships.
// Reproduce the real operator-runtime failure reported by Lumiverse: if quiet rejects
// even inside a scoped frontend callback, the compatibility wrapper must retry raw
// with the userId carried in the request.
forceQuietScopeFailure=true;
await frontendHandler({type:'import_existing_history'},'user-smoke');
state=JSON.parse(chatStore.get('chat-smoke|story_engine_state_v10'));
assert.equal(state.bootstrap.status,'ready');
assert.equal(state.bootstrap.sourceMessageCount,3);
assert.equal(state.world.location,'Emberfall');
assert.equal(state.npcs.Mira.bond,4);
assert.deepEqual(state.npcs.Mira.relationshipDescriptors,['childhood best friend']);
assert.ok(state.health.npcs.Mira);
assert.deepEqual(state.world.presentNpcs,['Mira'],'history import did not reconstruct current-scene NPC presence');
assert.equal(lastQuietUserId,'user-smoke','history import sidecar generation lost operator callback scope');
assert.equal(lastGenerationRequestUserId,'user-smoke','history import generation request lost operator userId');
assert.equal(rawGenerationCalls,1,'history import did not recover from operator-scoped quiet userId failure via scoped raw generation');
assert.equal(state.npcs.Mira.inventory[0],'Old map');

// Manual character creation resolves an explicit usable connection before assistant generation.
await frontendHandler({type:'create_player',applyMode:'state_only',input:{name:'Manual Hero',race:'Human',genre:'Fantasy',concept:'Traveler',appearance:'A road-worn traveler',backstory:'Has spent years on the road.',stats:{PHY:5,MND:5,CHA:5},desiredAbilities:'Travel',desiredSpells:'',inventory:'Rope',anchors:'Practical traveler'}},'user-smoke');
state=JSON.parse(chatStore.get('chat-smoke|story_engine_state_v10'));
assert.equal(state.player.name,'Manual Hero');
assert.equal(state.player.stats.PHY+state.player.stats.MND+state.player.stats.CHA,15);
assert.ok(quietConnectionIds.at(-1),'manual character generation did not resolve a usable connection profile');

// AI conversion creates and selects a new persona; the source persona is not overwritten.
activePersona={id:'persona-old',name:'Old Hero',title:'Veteran',description:'A nimble veteran scout with a bow.',attached_world_book_id:'wb-1'};
await frontendHandler({type:'convert_active_persona',chatId:'chat-smoke'},'user-smoke');
assert.equal(personaUpdateCalls,0);
assert.equal(createdPersonas.length,1);
assert.equal(switchedPersonaId,createdPersonas[0].id);
assert.equal(createdPersonas[0].attached_world_book_id,'wb-1');
state=JSON.parse(chatStore.get('chat-smoke|story_engine_state_v10'));
assert.equal(state.player.stats.PHY+state.player.stats.MND+state.player.stats.CHA,15);
assert.ok(quietConnectionIds.filter(Boolean).length>=2,'assistant generations were not bound to resolved connection profiles');

// A non-active CHAT_CHANGED event must not be mistaken for a chat switch.
await events.get('CHAT_CHANGED')({chatId:'background-chat'},'user-smoke');
assert.equal(lastFrontendPayload?.chatId,'chat-smoke','background CHAT_CHANGED incorrectly replaced the active chat');

// Persona changes refresh the active persona exposed by the dashboard.
const eventPersona={id:'persona-event',name:'Event Hero',title:'Current',description:'Selected in the Lumiverse persona picker.'};
activePersona=null; // Simulate a transient host getActive() miss after the frontend already emitted the selected persona.
await events.get('PERSONA_CHANGED')({persona:eventPersona},'user-smoke');
assert.equal(lastFrontendPayload?.activePersona?.id,'persona-event','persona-change event did not refresh the active persona');
assert.equal(appendMessageCalls,0,'Story Engine injected a synthetic chat message during normal setup/actions');

console.log('Story Engine Spindle runtime smoke passed');
