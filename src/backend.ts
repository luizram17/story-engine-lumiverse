declare const spindle: any;

import type { PlayerSheet, StorySettings, StoryState, TurnResolution, ProseFinding } from './shared/types.js';
import { DEFAULT_SETTINGS, SETTINGS_GLOBAL_KEY, STATE_CHAT_KEY, LEGACY_STATE_CHAT_KEYS, XP_MILESTONE, PROGRESSION_MAX_STAT } from './core/config.js';
import { createDefaultState, normalizeSettings, normalizeState, pruneState, ensureNpc, rankFromCapabilityPool, makeCoreSnapshot, restoreCoreSnapshot, object, text } from './core/state.js';
import { fingerprintText } from './core/rng.js';
import { semanticTool, buildSemanticPrompt, normalizeSemanticLedger, fallbackSemanticLedger } from './core/semantic.js';
import { resolveTurn } from './core/mechanics.js';
import { buildNarratorHandoff, buildPostTurnPrompt, buildStateContext, postTurnTool } from './core/prompts.js';
import { updateRelationships, enforceRelationshipInvariants } from './core/relationships.js';
import { applyHealthEvents, applyNaturalRecovery, increaseMilestoneHealth } from './core/health.js';
import { applyTransaction } from './core/economy.js';
import { applyPowerActorSignals, applyWorldSemantic, addMemoryFact } from './core/world.js';
import { applyContinuitySemantic, archiveDescription, consumeThreadsForActor, resolveBoundary, upsertKnowledge } from './core/continuity.js';
import { collectProseFindings, proseRepairPrompt, stripStructuredArtifacts } from './core/prose.js';
import { applyPlayerToState, buildCharacterPrompt, buildPersonaConversionPrompt, characterTool, normalizeCharacterSheet, normalizeConvertedPersonaSheet, renderPersonaDescription, validateCharacterInput, normalizeStartingStatBudget, type CharacterDraftInput } from './core/character.js';
import { applyMutationBatch, bootstrapAssistantPrompt, commandAssistantPrompt, extractOocCommands, mutationTool, normalizeMutationBatch, stripOocCommands } from './core/commands.js';

const pendingGenerationByChat = new Map<string, string>();
const activeChatByUser = new Map<string, string>();
const activePersonaByUser = new Map<string, any>();
const userByChat = new Map<string, string>();
const bootstrapInFlight = new Set<string>();
let interceptorRegistered = false;
let generationEventsRegistered = false;
let frontendRegistered = false;
let chatEventsRegistered = false;

function has(permission:string):boolean { try { return spindle.permissions?.has ? spindle.permissions.has(permission) : true; } catch { return false; } }
function errorMessage(err:any):string{return err instanceof Error?err.message:String(err||'');}
async function quietForUser(input:any,userId?:string):Promise<any>{
  if(!userId)return spindle.generate.quiet(input);
  // Direct generation requests are user-scoped explicitly in operator installations.
  // Current runtimes consume userId from the request object; retain a narrow fallback
  // for older builds that accepted it as a second RPC argument.
  try{return await spindle.generate.quiet({...input,userId});}
  catch(err){
    const msg=errorMessage(err);
    // A few Lumiverse builds exposed operator scoping as a second RPC argument
    // instead of a request field. Both failures happen before provider dispatch,
    // so retrying the alternate wire shape is safe.
    if(/userId is required for operator-scoped extensions|(?:unknown|unexpected|additional|unrecognized).{0,30}userId|too many arguments/i.test(msg)){
      return spindle.generate.quiet(input,userId);
    }
    throw err;
  }
}
async function getActivePersonaForUser(userId?:string):Promise<any|null>{
  if(userId&&activePersonaByUser.has(userId))return activePersonaByUser.get(userId)??null;
  try{
    const persona=await spindle.personas.getActive(userId);
    if(userId)activePersonaByUser.set(userId,persona??null);
    return persona??null;
  }catch(err){
    // User-scoped/older runtimes infer owner and may not accept the optional argument.
    try{const persona=await spindle.personas.getActive();if(userId)activePersonaByUser.set(userId,persona??null);return persona??null;}catch{return null;}
  }
}
async function getPersonaForUser(personaId:string,userId?:string):Promise<any|null>{
  if(!personaId)return null;
  try{return await spindle.personas.get(personaId,userId);}catch{try{return await spindle.personas.get(personaId);}catch{return null;}}
}
async function createPersonaForUser(input:any,userId?:string):Promise<any>{
  return userId?spindle.personas.create(input,userId):spindle.personas.create(input);
}
async function switchActivePersonaForUser(personaId:string|null,userId?:string):Promise<void>{
  if(userId)await spindle.personas.switchActive(personaId,userId);else await spindle.personas.switchActive(personaId);
  if(userId){if(personaId){const p=await getPersonaForUser(personaId,userId);activePersonaByUser.set(userId,p);}else activePersonaByUser.set(userId,null);}
}
async function updatePersonaForUser(personaId:string,input:any,userId?:string):Promise<any>{
  return userId?spindle.personas.update(personaId,input,userId):spindle.personas.update(personaId,input);
}

async function loadSettings(userId?:string):Promise<StorySettings>{
  if(userId){
    try{
      const stored=await spindle.userStorage.getJson('settings.json',{fallback:null,userId});
      if(stored)return normalizeSettings(stored);
    }catch(err){spindle.log?.warn?.(`Story Engine user settings read failed: ${String(err)}`);}
  }
  // Backward-compatible fallback for user-scoped installs / legacy settings.
  try { const raw=await spindle.variables.global.get(SETTINGS_GLOBAL_KEY); return raw?normalizeSettings(JSON.parse(raw)):normalizeSettings(DEFAULT_SETTINGS); }
  catch { return normalizeSettings(DEFAULT_SETTINGS); }
}
async function saveSettings(settings:StorySettings,userId?:string):Promise<void>{
  const normalized=normalizeSettings(settings);
  if(userId){await spindle.userStorage.setJson('settings.json',normalized,{indent:2,userId});return;}
  await spindle.variables.global.set(SETTINGS_GLOBAL_KEY,JSON.stringify(normalized));
}
function userForChat(chatId:string,explicit?:string):string|undefined{const id=String(explicit||'').trim();if(id){userByChat.set(chatId,id);activeChatByUser.set(id,chatId);return id;}return userByChat.get(chatId);}
async function resolveConnectionId(primary:string,secondary='',runtime='',userId?:string):Promise<string|undefined>{
  for(const id of [primary,secondary,runtime].map(x=>String(x||'').trim()).filter(Boolean)){
    try{const conn=await spindle.connections.get(id,userId||undefined);if(conn&&conn.has_api_key!==false)return id;}catch{}
  }
  return undefined;
}
async function loadState(chatId:string):Promise<StoryState>{
  try {
    const raw=await spindle.variables.chat.get(chatId,STATE_CHAT_KEY);
    if(raw) return normalizeState(JSON.parse(raw));
    for(const legacyKey of LEGACY_STATE_CHAT_KEYS){
      const legacy=await spindle.variables.chat.get(chatId,legacyKey);
      if(legacy){ const migrated=normalizeState(JSON.parse(legacy)); await spindle.variables.chat.set(chatId,STATE_CHAT_KEY,JSON.stringify(pruneState(migrated))); return migrated; }
    }
    return createDefaultState();
  }
  catch(err){ spindle.log?.warn?.(`Story Engine state read failed for ${chatId}: ${String(err)}`); return createDefaultState(); }
}
async function saveState(chatId:string,state:StoryState):Promise<void>{ await spindle.variables.chat.set(chatId,STATE_CHAT_KEY,JSON.stringify(pruneState(state))); }

function textContent(content:any):string {
  if(typeof content==='string') return content;
  if(Array.isArray(content)) return content.filter((p:any)=>p?.type==='text').map((p:any)=>String(p.text||'')).join('\n');
  return '';
}
function lastUserText(messages:any[]):string { for(let i=messages.length-1;i>=0;i--) if(messages[i]?.role==='user') return textContent(messages[i].content); return ''; }
function lastAssistantBeforeUser(messages:any[]):string { let seenUser=false; for(let i=messages.length-1;i>=0;i--){if(messages[i]?.role==='user'){seenUser=true;continue;} if(seenUser&&messages[i]?.role==='assistant')return textContent(messages[i].content);} return ''; }
function compactHistory(messages:any[],count:number):string { return messages.slice(-count).map(m=>`${String(m.role||'').toUpperCase()}: ${textContent(m.content).slice(0,3000)}`).join('\n\n'); }
function turnFingerprint(messages:any[],userText:string):string { const userCount=messages.filter(m=>m?.role==='user').length; return fingerprintText(`${userCount}|${lastAssistantBeforeUser(messages).slice(-800)}|${userText}`); }

function historyBeforeLatestUser(messages:any[],count:number):string {
  let idx=messages.length;
  for(let i=messages.length-1;i>=0;i--){if(messages[i]?.role==='user'){idx=i;break;}}
  return compactHistory(messages.slice(0,idx),count);
}
function replaceLatestUserText(messages:any[],replacement:string):any[]{
  const out=messages.map(m=>({...m}));
  for(let i=out.length-1;i>=0;i--){if(out[i]?.role==='user'){out[i]={...out[i],content:replacement};break;}}
  return out;
}
function storyDataContext(state:StoryState):string{
  const data={turn:state.turn,player:state.player,npcs:state.npcs,health:state.health,world:state.world,reputation:state.reputation,progression:state.progression,economy:state.economy,names:state.names,continuity:state.continuity};
  const json=JSON.stringify(data,null,2);
  return json.length<=36000?json:`${buildStateContext(state)}\n\n[Full state omitted from prompt because it is very large; use the tracker summary above.]`;
}
async function runMutationAssistant(messages:Array<{role:'system'|'user';content:string}>,toolName:string,connectionId:string,userId?:string):Promise<ReturnType<typeof normalizeMutationBatch>>{
  const result=await quietForUser({messages,tools:[mutationTool(toolName)],parameters:{temperature:0.05,max_tokens:3200},connection_id:connectionId||undefined,reasoning:{source:'off'}},userId);
  const call=result?.tool_calls?.find((x:any)=>x?.name===toolName)||result?.tool_calls?.[0];
  const payload=call?.args??parseJsonContent(result?.content);
  if(!payload)throw new Error(`No structured payload returned by ${toolName}.`);
  return normalizeMutationBatch(payload);
}
async function applyOocCommands(chatId:string,commands:string[],messages:any[],settings:StorySettings,state:StoryState,context:any,fingerprint:string):Promise<{state:StoryState;summary:string;replayed:boolean}>{
  const existing=state.commandHistory.find(x=>x.fingerprint===fingerprint);
  if(existing)return{state,summary:existing.summary,replayed:true};
  if(!has('generation'))throw new Error('generation permission is required for OOC commands.');
  const commandConnection=await resolveConnectionId(settings.commandConnectionId,settings.semanticConnectionId,context?.connectionId||'',context?.userId);
  const batch=await runMutationAssistant(commandAssistantPrompt(commands,storyDataContext(state),historyBeforeLatestUser(messages,Math.max(8,settings.recentMessageCount))), 'apply_story_state_changes', commandConnection||'', context?.userId||userByChat.get(chatId));
  const applied=applyMutationBatch(state,batch);
  applied.state.commandHistory.push({fingerprint,createdAt:Date.now(),commands:[...commands],summary:batch.summary||'OOC command applied.',operations:batch.operations});
  await saveState(chatId,applied.state);
  return{state:applied.state,summary:batch.summary||'OOC command applied.',replayed:false};
}
function splitTranscript(messages:any[],maxChars=26000):string[]{
  const chunks:string[]=[];let current='';
  const push=(piece:string)=>{if(current&&current.length+piece.length>maxChars){chunks.push(current);current='';}if(piece.length<=maxChars){current+=piece;return;}for(let i=0;i<piece.length;i+=maxChars){if(current){chunks.push(current);current='';}chunks.push(piece.slice(i,i+maxChars));}};
  for(let i=0;i<messages.length;i++){
    const role=String(messages[i]?.role||'unknown').toUpperCase();const content=textContent(messages[i]?.content);
    push(`\n\n[${i+1} ${role}]\n${content}`);
  }
  if(current)chunks.push(current);
  return chunks.filter(Boolean);
}
function bootstrapEligible(state:StoryState):boolean{return state.bootstrap.status!=='ready'&&state.turn===0&&state.audits.length===0;}
async function bootstrapExistingChat(chatId:string,userId?:string,force=false):Promise<void>{
  if(bootstrapInFlight.has(chatId))return;
  const settings=await loadSettings(userId);
  if(!has('generation')||!has('chat_mutation'))return;
  let state=await loadState(chatId);
  if(!force&&!bootstrapEligible(state))return;
  let messages:any[]=[];
  try{messages=await spindle.chat.getMessages(chatId);}catch(err){spindle.log?.warn?.(`History import could not read chat ${chatId}: ${String(err)}`);return;}
  if(!force&&messages.length<3)return;
  bootstrapInFlight.add(chatId);
  state.bootstrap={status:'importing',sourceMessageCount:messages.length,lastMessageId:String(messages.at(-1)?.id||'')||undefined};
  await saveState(chatId,state);
  if(userId)await sendDashboard(userId,chatId,false);
  try{
    let persona:any=null;try{persona=await getActivePersonaForUser(userId);}catch{}
    const personaContext=persona?`Name: ${persona.name||''}\nTitle: ${persona.title||''}\nDescription:\n${persona.description||''}`:'';
    const chunks=splitTranscript(messages);
    for(let i=0;i<chunks.length;i++){
      const bootstrapConnection=await resolveConnectionId(settings.bootstrapConnectionId,settings.semanticConnectionId,'',userId);
      const batch=await runMutationAssistant(bootstrapAssistantPrompt(chunks[i]!,storyDataContext(state),personaContext,i+1,chunks.length),'apply_story_history_import',bootstrapConnection||'',userId);
      const hadPlayer=Boolean(state.player);
      state=applyMutationBatch(state,batch).state;
      if(!hadPlayer&&state.player)state.player.stats=normalizeStartingStatBudget(state.player.stats);
      state.bootstrap={status:'importing',sourceMessageCount:messages.length,lastMessageId:String(messages.at(-1)?.id||'')||undefined};
      await saveState(chatId,state);
    }
    state.bootstrap={status:'ready',sourceMessageCount:messages.length,importedAt:Date.now(),lastMessageId:String(messages.at(-1)?.id||'')||undefined};
    await saveState(chatId,state);
    spindle.toast?.success?.(`Story Engine imported ${messages.length} existing message(s).`);
  }catch(err){
    state=await loadState(chatId);state.bootstrap={status:'failed',sourceMessageCount:messages.length,lastMessageId:String(messages.at(-1)?.id||'')||undefined,error:err instanceof Error?err.message:String(err)};await saveState(chatId,state);spindle.log?.error?.(`History import failed for ${chatId}: ${String(err)}`);spindle.toast?.error?.('Story Engine could not import the existing chat history.');
  }finally{bootstrapInFlight.delete(chatId);if(userId)await sendDashboard(userId,chatId,false);}
}

async function extractSemantic(messages:any[], context:any, settings:StorySettings, state:StoryState, userText:string){
  if(!settings.semanticEnabled || !has('generation')) return fallbackSemanticLedger(userText);
  const prompts=buildSemanticPrompt({userMessage:userText,history:compactHistory(messages,settings.recentMessageCount),stateContext:buildStateContext(state)});
  try{
    const semanticConnection=await resolveConnectionId(settings.semanticConnectionId,'',context?.connectionId||'',context?.userId);
    const result=await quietForUser({messages:prompts,tools:[semanticTool()],parameters:{temperature:settings.semanticTemperature,max_tokens:2400},connection_id:semanticConnection,reasoning:{source:'off'}},context?.userId||userByChat.get(String(context?.chatId||'')));
    const call=result?.tool_calls?.find((x:any)=>x?.name==='submit_story_ledger') || result?.tool_calls?.[0];
    const payload=call?.args ?? parseJsonContent(result?.content);
    if(!payload) throw new Error('No structured semantic payload returned');
    return normalizeSemanticLedger(payload);
  }catch(err){
    spindle.log?.warn?.(`Semantic preflight failed; using conservative fallback: ${String(err)}`);
    return fallbackSemanticLedger(userText);
  }
}

function projectResolution(baseState:StoryState,resolution:TurnResolution,settings:StorySettings,seed:string):StoryState{
  const projected=normalizeState(JSON.parse(JSON.stringify(baseState)));
  projected.turn=resolution.turn;
  for(const actor of resolution.semantic.actors){ const rank=rankFromCapabilityPool(actor.capabilityPool,seed,actor.name,actor.rank); const npc=ensureNpc(projected,actor.name,rank,actor.role,seed,actor.mainStat); npc.companion=npc.companion||actor.companion; npc.powerActor=npc.powerActor||actor.powerActor; }
  const beforeDay=projected.world.dayIndex;
  applyWorldSemantic(projected,resolution.semantic,seed);
  if(projected.world.dayIndex>beforeDay) applyNaturalRecovery(projected,projected.world.dayIndex-beforeDay);
  updateRelationships(projected,resolution.semantic,resolution.rolls,seed);
  applyContinuitySemantic(projected,resolution.semantic);
  applyHealthEvents(projected,resolution.healthEvents);
  applyTransaction(projected,resolution.semantic.transaction);
  if(settings.powerActors) applyPowerActorSignals(projected,resolution.semantic);
  projected.names.used=[...new Set([...projected.names.used,...resolution.generatedNames])];
  return projected;
}

function registerInterceptor(){
  if(interceptorRegistered || !has('interceptor')) return;
  spindle.registerInterceptor(async(messages:any[],context:any)=>{
    const chatId=String(context?.chatId||'');
    const scopedUserId=userForChat(chatId,context?.userId);
    const settings=await loadSettings(scopedUserId);
    if(!settings.enabled || context?.dryRun===true || context?.generationType==='quiet' || context?.generationType==='impersonate') return messages;
    if(!chatId) return messages;
    const rawUserText=lastUserText(messages); if(!rawUserText.trim()) return messages;
    const fingerprint=turnFingerprint(messages,rawUserText);
    let state=await loadState(chatId);
    let workingMessages=messages;
    let userText=rawUserText;
    let commandSummary='';

    const oocCommands=settings.oocCommandsEnabled?extractOocCommands(rawUserText):[];
    if(oocCommands.length){
      try{
        const applied=await applyOocCommands(chatId,oocCommands,messages,settings,state,context,fingerprint);
        state=applied.state;commandSummary=applied.summary;
      }catch(err){
        commandSummary=`Command Assistant error: ${err instanceof Error?err.message:String(err)}`;
        spindle.log?.error?.(commandSummary);spindle.toast?.error?.(commandSummary);
      }
      userText=stripOocCommands(rawUserText);
      if(userText){workingMessages=replaceLatestUserText(messages,userText);}
      else{
        const instruction=commandSummary.startsWith('Command Assistant error:')
          ?'The user sent only an OOC Story Engine command, but it could not be applied. Do not advance the roleplay. Briefly report that the OOC change failed.'
          :'The user sent only an OOC Story Engine command. The extension already applied it. Do not advance time, add new events, or treat the command as dialogue. Briefly acknowledge the OOC state change.';
        workingMessages=replaceLatestUserText(messages,instruction);
        return {messages:[{role:'system',content:`STORY ENGINE — OOC COMMAND RESULT\n${commandSummary||'OOC command processed.'}\nThis is administrative state, not spoken dialogue.`},...workingMessages],breakdown:[{messageIndex:0,name:'Story Engine · OOC Command'}]};
      }
    }

    const replay=Boolean(['regenerate','swipe'].includes(String(context?.generationType)) && state.lastResolution?.fingerprint===fingerprint && state.rollback?.fingerprint===fingerprint);
    let resolution:TurnResolution;
    let baseForProjection=state;

    if(replay && state.lastResolution && state.rollback){
      const restored=restoreCoreSnapshot(normalizeState(JSON.parse(JSON.stringify(state))),state.rollback.base);
      baseForProjection=restored;
      resolution={...state.lastResolution,replay:true,createdAt:Date.now()};
    }else if(state.pending?.fingerprint===fingerprint){
      resolution=state.pending;
    }else{
      const semantic=await extractSemantic(workingMessages,context,settings,state,userText);
      const seed=`${chatId}|${state.turn+1}|${fingerprint}`;
      const scratch=normalizeState(JSON.parse(JSON.stringify(state)));
      resolution=resolveTurn(scratch,semantic,fingerprint,seed,{randomEvents:settings.randomEvents,randomEventChance:settings.randomEventChance,proactivity:settings.proactivity,nameStyle:settings.nameStyle});
    }
    const seed=`${chatId}|${resolution.turn}|${fingerprint}`;
    const projected=projectResolution(baseForProjection,resolution,settings,seed);
    resolution.handoff=buildNarratorHandoff(projected,resolution,settings)+(commandSummary?`\n\nOOC ADMINISTRATIVE UPDATE\n${commandSummary}\nThe OOC text itself is not dialogue. The resulting state is already authoritative.`:'');
    state.pending=resolution;
    await saveState(chatId,state);
    const injected={role:'system' as const,content:resolution.handoff};
    const out=[injected,...workingMessages];
    return {messages:out,breakdown:[{messageIndex:0,name:'Story Engine · Scene Resolution'}]};
  },70);
  interceptorRegistered=true;
  spindle.log?.info?.('Story Engine interceptor registered');
}

function registerGenerationEvents(){
  if(generationEventsRegistered || !has('generation')) return;
  spindle.on('GENERATION_STARTED',(payload:any)=>{ if(payload?.chatId&&payload?.generationId) pendingGenerationByChat.set(String(payload.chatId),String(payload.generationId)); });
  spindle.on('GENERATION_STOPPED',async(payload:any)=>{
    const chatId=String(payload?.chatId||''); if(!chatId)return;
    const state=await loadState(chatId); if(state.pending){state.pending=null;await saveState(chatId,state);} pendingGenerationByChat.delete(chatId);
  });
  spindle.on('GENERATION_ENDED',async(payload:any)=>{
    const chatId=String(payload?.chatId||''); const messageId=String(payload?.messageId||'');
    if(!chatId || !messageId || payload?.error) { if(chatId)pendingGenerationByChat.delete(chatId); return; }
    try{ await finalizeGeneration(chatId,messageId,String(payload?.generationId||''),String(payload?.content||'')); }
    catch(err){ spindle.log?.error?.(`Story Engine finalizer failed: ${String(err)}`); spindle.toast?.error?.('The reply was generated, but Story Engine could not finalize its tracker state.'); }
    finally{ pendingGenerationByChat.delete(chatId); }
  });
  generationEventsRegistered=true;
}

async function finalizeGeneration(chatId:string,messageId:string,generationId:string,rawContent:string){
  const userId=userByChat.get(chatId);
  const settings=await loadSettings(userId); let state=await loadState(chatId); const resolution=state.pending;
  if(!settings.enabled || !resolution) return;
  let content=stripStructuredArtifacts(rawContent);
  const findings=collectProseFindings(content,settings.proseGuardExtraPhrases);
  if(content!==rawContent && has('chat_mutation')) await spindle.chat.updateMessage(chatId,messageId,{content,metadata:{story_engine_sanitized:true}});

  if(settings.proseGuardMode==='automatic' && findings.length && has('generation') && has('chat_mutation')){
    const repaired=await repairProse(content,findings,settings,userId);
    if(repaired && repaired!==content){ content=repaired; await spindle.chat.updateMessage(chatId,messageId,{content,metadata:{story_engine_prose_guard:'automatic'}}); }
    state.proseReview=null;
  }else if(settings.proseGuardMode==='review' && findings.length){
    state.proseReview={messageId,content,findings};
  }else state.proseReview=null;

  // Restore the pre-turn snapshot on swipe/regenerate, then re-commit the identical dice result.
  if(resolution.replay && state.rollback?.fingerprint===resolution.fingerprint){ state=restoreCoreSnapshot(state,state.rollback.base); }
  else state.rollback={fingerprint:resolution.fingerprint,base:makeCoreSnapshot(state)};

  const notes=commitResolution(state,resolution,settings,chatId);
  if(settings.trackerPostPass && has('generation')){
    try{ const delta=await extractPostTurnDelta(state,resolution,content,settings,userId); applyPostTurnDelta(state,delta,notes); }
    catch(err){ notes.push(`Post-turn archivist skipped: ${String(err)}`); }
  }
  state.pending=null; state.lastResolution={...resolution,replay:false};
  const existing=state.audits.filter(a=>!(resolution.replay&&a.fingerprint===resolution.fingerprint));
  existing.push({turn:resolution.turn,turnId:resolution.turnId,fingerprint:resolution.fingerprint,createdAt:resolution.createdAt,finalizedAt:Date.now(),generationId,messageId,summary:resolution.semantic.summary,rolls:resolution.rolls,xpAward:resolution.xpAward,proseFindings:findings,notes});
  state.audits=existing;
  await saveState(chatId,state);
  if(has('chat_mutation')){
    await spindle.chat.updateMessage(chatId,messageId,{metadata:{story_engine:{turn:resolution.turn,turnId:resolution.turnId,fingerprint:resolution.fingerprint,rolls:resolution.rolls.map(r=>({label:r.label,tier:r.outcomeTier,margin:r.margin})),proseGuard:settings.proseGuardMode,findings:findings.length}}});
  }
}

function commitResolution(state:StoryState,resolution:TurnResolution,settings:StorySettings,chatId:string):string[]{
  const notes:string[]=[]; const seed=`${chatId}|${resolution.turn}|${resolution.fingerprint}`;
  state.turn=resolution.turn;
  for(const actor of resolution.semantic.actors){ const rank=rankFromCapabilityPool(actor.capabilityPool,seed,actor.name,actor.rank); const npc=ensureNpc(state,actor.name,rank,actor.role,seed,actor.mainStat); npc.companion=npc.companion||actor.companion;npc.powerActor=npc.powerActor||actor.powerActor; }
  const beforeDay=state.world.dayIndex;
  notes.push(...applyWorldSemantic(state,resolution.semantic,seed));
  if(state.world.dayIndex>beforeDay){applyNaturalRecovery(state,state.world.dayIndex-beforeDay);notes.push(`Natural recovery applied for ${state.world.dayIndex-beforeDay} day(s).`);}
  notes.push(...updateRelationships(state,resolution.semantic,resolution.rolls,seed));
  notes.push(...applyContinuitySemantic(state,resolution.semantic));
  applyHealthEvents(state,resolution.healthEvents);
  notes.push(...applyTransaction(state,resolution.semantic.transaction));
  if(settings.powerActors) notes.push(...applyPowerActorSignals(state,resolution.semantic));
  state.names.used=[...new Set([...state.names.used,...resolution.generatedNames])];
  if(settings.progression && resolution.xpAward>0){
    state.progression.xp+=resolution.xpAward;
    state.progression.history.push({turn:state.turn,amount:resolution.xpAward,reason:resolution.semantic.summary||'successful challenge'});
    const earned=Math.floor(state.progression.xp/XP_MILESTONE);
    state.progression.pendingMilestones=Math.max(0,earned-state.progression.milestonesClaimed);
    notes.push(`XP +${resolution.xpAward}; ${state.progression.pendingMilestones} milestone(s) pending.`);
  }
  if(resolution.lootResult?.status==='ok' && resolution.lootResult.target){ const npc=state.npcs[resolution.lootResult.target]; if(npc)npc.lootSearchCompleted=true; notes.push(`Loot envelope resolved for ${resolution.lootResult.target}; corpse search marked complete and possession is not automatic.`); }
  else if(resolution.lootResult && resolution.lootResult.status!=='ok') notes.push(`Loot search status: ${resolution.lootResult.status}.`);
  return notes;
}

async function repairProse(content:string,findings:ProseFinding[],settings:StorySettings,userId?:string):Promise<string>{
  try{
    const result=await quietForUser({messages:[{role:'user',content:proseRepairPrompt(content,findings)}],parameters:{temperature:0.1,max_tokens:Math.max(600,Math.ceil(content.length/2))},connection_id:settings.proseGuardConnectionId||settings.semanticConnectionId||undefined,reasoning:{source:'off'}},userId);
    const repaired=stripStructuredArtifacts(String(result?.content||'')).trim();
    if(!repaired) return content;
    if(repaired.length<content.length*.55 || repaired.length>content.length*1.55) return content;
    return repaired;
  }catch(err){spindle.log?.warn?.(`Prose repair failed: ${String(err)}`);return content;}
}

async function extractPostTurnDelta(state:StoryState,resolution:TurnResolution,narration:string,settings:StorySettings,userId?:string):Promise<any>{
  const result=await quietForUser({messages:buildPostTurnPrompt(state,resolution,narration),tools:[postTurnTool()],parameters:{temperature:0.1,max_tokens:1800},connection_id:settings.semanticConnectionId||undefined,reasoning:{source:'off'}},userId);
  const call=result?.tool_calls?.find((x:any)=>x?.name==='submit_post_turn_delta')||result?.tool_calls?.[0];
  return call?.args ?? parseJsonContent(result?.content) ?? {};
}

function applyPostTurnDelta(state:StoryState,delta:any,notes:string[]){
  const d=object(delta);
  for(const f of Array.isArray(d.facts)?d.facts:[]){ const o=object(f); if(text(o.fact)) addMemoryFact(state,text(o.fact),['scene','location','world','user','npc'].includes(String(o.scope))?o.scope:'world',text(o.subject)||undefined,Math.max(1,Math.min(5,Number(o.salience||2)))); }
  for(const u of Array.isArray(d.npcUpdates)?d.npcUpdates:[]){
    const o=object(u); const name=text(o.name); if(!name)continue; const renameFrom=text(o.renameFrom);
    if(renameFrom && renameFrom!==name && state.npcs[renameFrom]){
      const source=state.npcs[renameFrom]!; const target=state.npcs[name];
      state.npcs[name]=target?{...source,...target,name,notes:[...source.notes,...target.notes].slice(-20),relationshipDescriptors:[...new Set([...(source.relationshipDescriptors||[]),...(target.relationshipDescriptors||[])])].slice(-16)}:{...source,name}; delete state.npcs[renameFrom];
      if(state.health.npcs[renameFrom]){state.health.npcs[name]=state.health.npcs[name]??state.health.npcs[renameFrom]!;delete state.health.npcs[renameFrom];}
      for(const plan of state.world.plans) if(plan.actor===renameFrom) plan.actor=name;
      state.names.used=[...new Set([...state.names.used,name])];
      if(state.continuity.boundCompanion.name===renameFrom)state.continuity.boundCompanion.name=name;
      if(state.continuity.pendingBoundary.targetNpc===renameFrom)state.continuity.pendingBoundary.targetNpc=name;
      for(const t of [...state.continuity.latentFavors,...state.continuity.latentGrievances])if(t.actor===renameFrom)t.actor=name;
      for(const arc of state.continuity.worldArcs)if(arc.actor===renameFrom)arc.actor=name;
      if(state.continuity.rapportClocks[renameFrom]){state.continuity.rapportClocks[name]=state.continuity.rapportClocks[name]??state.continuity.rapportClocks[renameFrom]!;delete state.continuity.rapportClocks[renameFrom];}
      for(const d of state.continuity.descriptiveArchive)if(d.label===renameFrom&&!d.promotedName)d.promotedName=name;
      notes.push(`Tracker name promoted: ${renameFrom} -> ${name}.`);
    }
    const npc=ensureNpc(state,name,'Average',text(o.role)||'NPC',`post|${state.turn}`); if(text(o.role))npc.role=text(o.role); if(['active','inactive','dead'].includes(String(o.status)))npc.status=o.status; if(typeof o.companion==='boolean')npc.companion=o.companion;if(typeof o.powerActor==='boolean')npc.powerActor=o.powerActor;if(text(o.personalityArchetype))npc.personalityArchetype=text(o.personalityArchetype).slice(0,80);if(text(o.personalitySummary))npc.personalitySummary=text(o.personalitySummary).slice(0,500);if(Array.isArray(o.relationshipDescriptors)){const merged=[...(npc.relationshipDescriptors||[])];const seen=new Set(merged.map((x:string)=>x.toLowerCase()));for(const raw of o.relationshipDescriptors){const v=text(raw).slice(0,100);if(v&&!seen.has(v.toLowerCase())){merged.push(v);seen.add(v.toLowerCase());}}npc.relationshipDescriptors=merged.slice(-16);}if(text(o.note))npc.notes=[...npc.notes,text(o.note)].slice(-20); enforceRelationshipInvariants(npc);
  }
  for(const r of Array.isArray(d.reputation)?d.reputation:[]){ const o=object(r),loc=text(o.location);if(!loc)continue;let entry=state.reputation.find(x=>x.location.toLowerCase()===loc.toLowerCase());if(!entry){entry={location:loc,fame:0,infamy:0,fear:0,notes:[]};state.reputation.push(entry);}entry.fame=Math.max(-20,Math.min(20,entry.fame+Number(o.fameDelta||0)));entry.infamy=Math.max(-20,Math.min(20,entry.infamy+Number(o.infamyDelta||0)));entry.fear=Math.max(-20,Math.min(20,entry.fear+Number(o.fearDelta||0)));if(text(o.note))entry.notes=[...entry.notes,text(o.note)].slice(-12);}
  for(const k of Array.isArray(d.knowledge)?d.knowledge:[])upsertKnowledge(state,k);
  for(const a of Array.isArray(d.descriptions)?d.descriptions:[])archiveDescription(state,a);
  for(const id of Array.isArray(d.resolvedBoundaryIds)?d.resolvedBoundaryIds:[])resolveBoundary(state,String(id));
  if(d.transaction) notes.push(...applyTransaction(state,d.transaction));
  const completed=new Set(Array.isArray(d.completedPlanIds)?d.completedPlanIds.map(String):[]); for(const p of state.world.plans)if(completed.has(p.id)){p.status='completed';consumeThreadsForActor(state,p.actor);for(const arc of state.continuity.worldArcs)if(arc.actor===p.actor&&arc.status==='active')arc.status='completed';}
}

async function activeChatId(userId?:string,hint=''):Promise<string>{
  const explicit=String(hint||'').trim();
  if(explicit){if(userId){activeChatByUser.set(userId,explicit);userByChat.set(explicit,userId);}return explicit;}
  if(userId&&activeChatByUser.has(userId))return activeChatByUser.get(userId)!;
  try{
    const chat=await spindle.chats.getActive(userId);
    const id=String(chat?.id||chat?.chat_id||'');
    if(userId){if(id)activeChatByUser.set(userId,id);else activeChatByUser.delete(userId);}
    return id;
  }catch{return userId?activeChatByUser.get(userId)||'':'';}
}
function mapConnections(raw:any[]):any[]{return raw.map((c:any)=>({id:String(c.id||c.connection_id||''),name:String(c.name||c.label||c.model||c.id||'Connection'),provider:String(c.provider||''),model:String(c.model||''),isDefault:Boolean(c.is_default),hasApiKey:c.has_api_key!==false})).filter(c=>c.id);}
async function dashboardPayload(userId?:string,hint=''){
  const settings=await loadSettings(userId); const chatId=await activeChatId(userId,hint); const state=chatId?await loadState(chatId):createDefaultState();
  let connections:any[]=[]; try{const r=await spindle.connections.list(userId||undefined);connections=Array.isArray(r)?r:Array.isArray(r?.data)?r.data:[];}catch{}
  let persona:any=null;try{persona=await getActivePersonaForUser(userId);}catch{}
  return {type:'dashboard',chatId,settings,state,connections:mapConnections(connections),capabilities:{chats:has('chats'),chatMutation:has('chat_mutation'),generation:has('generation'),personas:has('personas')},activePersona:persona?{id:persona.id,name:persona.name,title:persona.title,description:persona.description}:null};
}
async function sendDashboard(userId?:string,hint='',scheduleBootstrap=true){
  const payload=await dashboardPayload(userId,hint);
  if(userId)spindle.sendToFrontend(payload,userId);else spindle.sendToFrontend(payload);
  if(scheduleBootstrap&&payload.chatId&&payload.settings?.autoBootstrapExistingChat&&bootstrapEligible(payload.state)&&!bootstrapInFlight.has(payload.chatId))void bootstrapExistingChat(payload.chatId,userId,false);
}
function registerChatEvents(){
  if(chatEventsRegistered)return;
  const handle=async(payload:any,userId?:string)=>{const id=String(payload?.chatId||'');if(userId){if(id){activeChatByUser.set(userId,id);userByChat.set(id,userId);}else activeChatByUser.delete(userId);}await sendDashboard(userId,id,false);if(id){const settings=await loadSettings(userId);const state=await loadState(id);if(settings.autoBootstrapExistingChat&&bootstrapEligible(state))void bootstrapExistingChat(id,userId,false);}};
  spindle.on('CHAT_SWITCHED',handle);
  spindle.on('CHAT_CHANGED',handle);
  spindle.on('PERSONA_CHANGED',async(payload:any,userId?:string)=>{
    if(userId)activePersonaByUser.set(userId,payload?.persona??null);
    await sendDashboard(userId,userId?activeChatByUser.get(userId)||'':'',false);
  });
  chatEventsRegistered=true;
}

function registerFrontend(){
  if(frontendRegistered) return;
  spindle.onFrontendMessage(async(payload:any,userId:string)=>{
    try{
      const type=String(payload?.type||''); const hint=String(payload?.chatId||'');
      if(type==='get_dashboard'){await sendDashboard(userId,hint);return;}
      if(type==='save_settings'){const current=await loadSettings(userId);await saveSettings(normalizeSettings({...current,...object(payload.settings)}),userId);spindle.toast?.success?.('Story Engine settings saved.');await sendDashboard(userId,hint);return;}
      const chatId=await activeChatId(userId,hint);
      if(type==='reset_chat_state'){if(!chatId)throw new Error('No active chat could be detected.');await saveState(chatId,createDefaultState());spindle.toast?.success?.('Story Engine state reset for this chat.');await sendDashboard(userId,chatId);return;}
      if(type==='create_player'){if(!chatId)throw new Error('No active chat could be detected.');await handleCreatePlayer(chatId,payload,userId);return;}
      if(type==='convert_active_persona'){if(!chatId)throw new Error('No active chat could be detected.');await handleConvertActivePersona(chatId,userId);return;}
      if(type==='import_existing_history'){if(!chatId)throw new Error('No active chat could be detected.');await bootstrapExistingChat(chatId,userId,true);return;}
      if(type==='start_adventure'){if(!chatId)throw new Error('No active chat could be detected.');if(!has('chat_mutation'))throw new Error('chat_mutation permission is required.');await spindle.chat.appendMessage(chatId,{role:'user',content:'Begin the adventure at the first concrete moment where I can act.',metadata:{story_engine_start:true}},true);return;}
      if(type==='get_progression_options'){if(!chatId)throw new Error('No active chat could be detected.');await handleProgressionOptions(chatId,userId);return;}
      if(type==='claim_milestone'){if(!chatId)throw new Error('No active chat could be detected.');await handleClaimMilestone(chatId,payload,userId);return;}
      if(type==='apply_prose_suggestion'){if(!chatId)throw new Error('No active chat could be detected.');await handleApplyProseSuggestion(chatId,payload,userId);return;}
      if(type==='dismiss_prose_review'){if(!chatId)return;const st=await loadState(chatId);st.proseReview=null;await saveState(chatId,st);await sendDashboard(userId,chatId);return;}
    }catch(err){spindle.log?.error?.(`Frontend command failed: ${String(err)}`);spindle.toast?.error?.(err instanceof Error?err.message:String(err));spindle.sendToFrontend({type:'command_error',error:err instanceof Error?err.message:String(err)},userId);}
  });
  frontendRegistered=true;
}

async function createAndSwitchStoryPersona(sheet:PlayerSheet,sourcePersona?:any,userId?:string):Promise<any>{
  if(!has('personas'))throw new Error('personas permission is required to create and select the converted persona.');
  const created=await createPersonaForUser({name:sheet.name,title:`${sheet.race} · ${sheet.genre} · Story Engine`,description:renderPersonaDescription(sheet),folder:'Story Engine',is_narrator:false,attached_world_book_id:sourcePersona?.attached_world_book_id||undefined,metadata:{story_engine:{sheetVersion:2,statBuy:15,genre:sheet.genre,sourcePersonaId:sourcePersona?.id||null}}},userId);
  await switchActivePersonaForUser(created.id,userId);
  return created;
}
async function handleCreatePlayer(chatId:string,payload:any,userId:string){
  if(!has('generation'))throw new Error('generation permission is required.');
  const input=payload.input as CharacterDraftInput; const errors=validateCharacterInput(input);if(errors.length)throw new Error(errors.join(' '));
  const settings=await loadSettings(userId);
  const personaConnection=await resolveConnectionId(settings.personaConnectionId,settings.semanticConnectionId,'',userId);
  const result=await quietForUser({messages:buildCharacterPrompt(input),tools:[characterTool()],parameters:{temperature:.35,max_tokens:2200},connection_id:personaConnection,reasoning:{source:'off'}},userId);
  const call=result?.tool_calls?.find((x:any)=>x?.name==='submit_character_sheet')||result?.tool_calls?.[0]; const sheet=normalizeCharacterSheet(call?.args??parseJsonContent(result?.content)??{},input);
  const state=await loadState(chatId);applyPlayerToState(state,sheet);await saveState(chatId,state);
  if(payload.applyMode==='new_persona')await createAndSwitchStoryPersona(sheet,undefined,userId);
  spindle.toast?.success?.('Player sheet created.');spindle.sendToFrontend({type:'player_created',sheet},userId);await sendDashboard(userId,chatId);
}
async function handleConvertActivePersona(chatId:string,userId:string){
  if(!has('generation'))throw new Error('generation permission is required.');if(!has('personas'))throw new Error('personas permission is required.');
  const source=await getActivePersonaForUser(userId);if(!source)throw new Error('No active persona is selected.');
  const settings=await loadSettings(userId);
  const personaConnection=await resolveConnectionId(settings.personaConnectionId,settings.semanticConnectionId,'',userId);
  const result=await quietForUser({messages:buildPersonaConversionPrompt(source),tools:[characterTool()],parameters:{temperature:.25,max_tokens:2200},connection_id:personaConnection,reasoning:{source:'off'}},userId);
  const call=result?.tool_calls?.find((x:any)=>x?.name==='submit_character_sheet')||result?.tool_calls?.[0];const sheet=normalizeConvertedPersonaSheet(call?.args??parseJsonContent(result?.content)??{},source);
  const state=await loadState(chatId);applyPlayerToState(state,sheet);await saveState(chatId,state);
  const created=await createAndSwitchStoryPersona(sheet,source,userId);
  spindle.toast?.success?.(`Converted ${source.name} into a new Story Engine persona and selected it.`);spindle.sendToFrontend({type:'player_created',sheet,personaId:created.id},userId);await sendDashboard(userId,chatId);
}

async function handleProgressionOptions(chatId:string,userId:string){
  const state=await loadState(chatId);if(!state.player)throw new Error('Create a player sheet first.');if(state.progression.pendingMilestones<=0)throw new Error('No progression milestone is pending.');
  const tool={name:'submit_progression_options',description:'Return three distinct ability options and three spell options suitable for the player progression milestone.',parameters:{type:'object',additionalProperties:false,properties:{abilities:{type:'array',minItems:3,maxItems:3,items:{type:'string'}},spells:{type:'array',minItems:3,maxItems:3,items:{type:'string'}}},required:['abilities','spells']}};
  const result=await quietForUser({messages:[{role:'system',content:'Design grounded progression choices for the existing character. Options should extend established themes without sudden unrelated powers. Abilities are useful capabilities, never automatic success. Spells should be bounded and setting-consistent. Call submit_progression_options once.'},{role:'user',content:renderPersonaDescription(state.player)}],tools:[tool],parameters:{temperature:.65,max_tokens:900},connection_id:(await loadSettings(userId)).semanticConnectionId||undefined,reasoning:{source:'off'}},userId);
  const call=result?.tool_calls?.find((x:any)=>x?.name==='submit_progression_options')||result?.tool_calls?.[0];const o=object(call?.args??parseJsonContent(result?.content));spindle.sendToFrontend({type:'progression_options',abilities:Array.isArray(o.abilities)?o.abilities:[],spells:Array.isArray(o.spells)?o.spells:[]},userId);
}

async function handleClaimMilestone(chatId:string,payload:any,userId:string){
  const state=await loadState(chatId);if(!state.player)throw new Error('Create a player sheet first.');if(state.progression.pendingMilestones<=0)throw new Error('No milestone is pending.');
  const stat=String(payload.stat||'');if(!['PHY','MND','CHA'].includes(stat))throw new Error('Choose PHY, MND, or CHA.');if(state.player.stats[stat as 'PHY']>=PROGRESSION_MAX_STAT)throw new Error(`${stat} is already at the progression cap.`);
  const ability=text(payload.ability);if(!ability)throw new Error('Choose or enter one ability.');state.player.stats[stat as 'PHY']+=1;if(!state.player.abilities.some(a=>a.toLowerCase()===ability.toLowerCase()))state.player.abilities.push(ability);
  const spell=text(payload.spell);if(spell && state.player.spells.length<5 && !state.player.spells.some(s=>s.toLowerCase()===spell.toLowerCase()))state.player.spells.push(spell);
  state.progression.milestonesClaimed+=1;state.progression.pendingMilestones=Math.max(0,state.progression.pendingMilestones-1);state.progression.level+=1;increaseMilestoneHealth(state,Object.values(state.npcs).filter(n=>n.companion).map(n=>n.name));await saveState(chatId,state);
  try{const persona=await getActivePersonaForUser(userId);if(persona&&has('personas'))await updatePersonaForUser(persona.id,{description:renderPersonaDescription(state.player),metadata:{...(persona.metadata||{}),story_engine:{sheetVersion:1,genre:state.player.genre,level:state.progression.level}}},userId);}catch{}
  spindle.toast?.success?.(`Level ${state.progression.level} milestone applied.`);await sendDashboard(userId);
}

async function handleApplyProseSuggestion(chatId:string,payload:any,userId:string){
  const state=await loadState(chatId);const review=state.proseReview;if(!review)throw new Error('No prose review is pending.');if(!has('chat_mutation'))throw new Error('chat_mutation permission is required.');
  const settings=await loadSettings(userId);const repaired=review.suggested||await repairProse(review.content,review.findings,settings,userId);if(repaired&&repaired!==review.content)await spindle.chat.updateMessage(chatId,review.messageId,{content:repaired,metadata:{story_engine_prose_guard:'review-applied'}});state.proseReview=null;await saveState(chatId,state);spindle.toast?.success?.('Prose repair applied.');await sendDashboard(userId);
}

function parseJsonContent(content:any):any|null{const s=String(content||'').trim();if(!s)return null;const candidates=[s,s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')];for(const c of candidates){try{return JSON.parse(c);}catch{}}const start=s.indexOf('{'),end=s.lastIndexOf('}');if(start>=0&&end>start){try{return JSON.parse(s.slice(start,end+1));}catch{}}return null;}

registerFrontend();
registerChatEvents();
registerInterceptor();
registerGenerationEvents();
try{spindle.permissions?.onChanged?.(({permission,granted}:any)=>{if(!granted)return;if(permission==='interceptor')registerInterceptor();if(permission==='generation')registerGenerationEvents();});}catch{}
spindle.log?.info?.('Story Engine for Lumiverse loaded');
