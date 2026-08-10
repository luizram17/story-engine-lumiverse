import type { StoryState } from '../shared/types.js';
import { ensureNpc, normalizeState, object, text } from './state.js';
import { enforceRelationshipInvariants } from './relationships.js';

export interface StoryMutation {
  op: 'set' | 'increment' | 'append' | 'remove_value' | 'delete' | 'merge';
  path: Array<string | number>;
  value?: unknown;
}

export interface StoryMutationBatch {
  summary: string;
  operations: StoryMutation[];
}

const ALLOWED_ROOTS = new Set(['turn','player','npcs','health','world','reputation','progression','economy','names','continuity']);
const BLOCKED_ROOTS = new Set(['version','pending','lastResolution','audits','proseReview','rollback','bootstrap','commandHistory','updatedAt']);

export function extractOocCommands(input:string):string[]{
  const out:string[]=[];
  const re=/\(\(([\s\S]*?)\)\)/g;
  let match:RegExpExecArray|null;
  while((match=re.exec(input))!==null){const value=String(match[1]||'').trim();if(value)out.push(value);}
  return out.slice(0,24);
}

export function stripOocCommands(input:string):string{
  return input.replace(/\(\(([\s\S]*?)\)\)/g,' ').replace(/[ \t]{2,}/g,' ').replace(/\n[ \t]+/g,'\n').trim();
}

export function mutationTool(name='apply_story_state_changes', description='Apply authoritative Story Engine mechanical-state changes.'){
  return {
    name,
    description,
    parameters:{
      type:'object',additionalProperties:false,
      properties:{
        summary:{type:'string'},
        operations:{type:'array',maxItems:80,items:{
          type:'object',additionalProperties:false,
          properties:{
            op:{type:'string',enum:['set','increment','append','remove_value','delete','merge']},
            path:{type:'array',minItems:1,maxItems:8,items:{anyOf:[{type:'string'},{type:'integer'}]}},
            value:{},
          },required:['op','path']
        }}
      },required:['summary','operations']
    }
  };
}

export function normalizeMutationBatch(value:unknown):StoryMutationBatch{
  const o=object(value);
  const operations:Array<StoryMutation>=[];
  for(const raw of Array.isArray(o.operations)?o.operations:[]){
    const r=object(raw); const op=String(r.op||'');
    if(!['set','increment','append','remove_value','delete','merge'].includes(op))continue;
    const path=(Array.isArray(r.path)?r.path:[]).filter(x=>typeof x==='string'||Number.isInteger(x)).slice(0,8) as Array<string|number>;
    if(!path.length)continue;
    const root=String(path[0]); if(!ALLOWED_ROOTS.has(root)||BLOCKED_ROOTS.has(root))continue;
    operations.push({op:op as StoryMutation['op'],path,value:r.value});
  }
  return {summary:text(o.summary).slice(0,600),operations:operations.slice(0,80)};
}

export function commandAssistantPrompt(commands:string[],stateContext:string,recentContext:string):Array<{role:'system'|'user';content:string}>{
  return [
    {role:'system',content:`You are Story Engine's Command Assistant. The user has written explicit OOC administrative commands inside double parentheses. These commands are authoritative retcons/edits to Story Engine mechanical story state, not in-character dialogue and not suggestions. Translate them into structured state mutations and call apply_story_state_changes once.

You may alter any STORY DATA namespace exposed below: turn, player, npcs, health, world, reputation, progression, economy, names, continuity. You may set, increment, append, remove, delete, or merge values. Do not alter internal engine transaction/bookkeeping fields such as pending resolutions, rollback, audits, bootstrap status, command history, version, or prose review.

Path format is an array. Examples:
- Add a sword to player inventory: ["player","inventory"] with op append and value "Sword".
- Define any relationship: set the appropriate Bond/Fear/Hostility and append short freeform labels to ["npcs","Mira","relationshipDescriptors"]. Examples include best friend, sibling, sworn enemy, rival, ex-partner, mentor, debtor, captor, employer, subordinate, trusted ally, or any setting-specific relationship. Positive, negative, and mixed relationships are equally valid.
- Set level: ["progression","level"].
- Set PHY: ["player","stats","PHY"].
- Set NPC status: ["npcs","Mira","status"].
- Set who is physically present right now: ["world","presentNpcs"] with the complete list of tracker names/stable labels.
- Add a world fact: append to ["world","facts"] with a complete fact object.

Resolve pronouns such as “he”, “she”, “they”, or “that NPC” from RECENT CONTEXT and the tracker. Prefer the most recently relevant established actor. Never invent a target when reference remains genuinely ambiguous; in that case make no mutation for that clause and explain the ambiguity in summary. If a command says something simply becomes true, make it true mechanically even if it is a retcon. If an NPC gives the player an item, add it to the player's inventory and optionally remove it from the NPC only if that possession is represented in state. Keep values compatible with existing Story Engine shapes.`},
    {role:'user',content:`OOC COMMANDS ONLY:\n${commands.map((c,i)=>`${i+1}. ${c}`).join('\n')}\n\nCURRENT STORY ENGINE STATE:\n${stateContext}\n\nRECENT RP CONTEXT FOR REFERENCE RESOLUTION:\n${recentContext||'(none)'}`}
  ];
}

export function bootstrapAssistantPrompt(transcriptChunk:string,stateContext:string,personaContext:string,chunkIndex:number,chunkCount:number):Array<{role:'system'|'user';content:string}>{
  return [
    {role:'system',content:`You are Story Engine's History Import Assistant. Attach Story Engine to an already-running Lumiverse roleplay by reading the supplied transcript chunk and translating facts already established in the RP into Story Engine state mutations. Call apply_story_state_changes once.

This is reconstruction, not creative generation. Preserve unusual starting conditions exactly when established. An NPC may begin with any positive, negative, mixed, familial, romantic, professional, hierarchical, coercive, competitive or setting-specific relationship to the user; they may also already be a companion, power actor, injured, dead, wealthy, indebted, feared, trusted, estranged, etc. Capture stable personality traits, roles, relationships, inventory/currency transfers, world/location facts, the COMPLETE current scene NPC list in ["world","presentNpcs"] when the chunk establishes who is physically present, user knowledge, reputation, companion status, progression implications, and durable continuity. Do not reset facts derived from earlier chunks unless later transcript evidence explicitly supersedes them.

When a player sheet does not exist, you may create it from the active persona and transcript. Create the complete player object in the same mutation batch so partial identity data is not lost during normalization. Creation stats use PHY/MND/CHA, each 1-9, totaling exactly 15. Prefer a grounded distribution matching demonstrated competence. Starting abilities/inventory should be supported by persona/history. Do not fabricate secret powers or unsupported possessions.

For NPCs, use bond/fear/hostility 0-4 and set them directly when the established relationship warrants it. Preserve the TYPE of relationship separately in relationshipDescriptors using short freeform labels (for example best friend, older sister, sworn enemy, rival with mutual respect, former lover, mentor, employer, captor). Best friend may warrant bond 4; a sworn enemy may warrant high hostility; an abusive superior may combine fear and hostility; family status alone does not imply positive Bond. Stable non-base traits belong in relationshipDescriptors, role, personalityArchetype, personalitySummary, notes, companion, powerActor, romanceStage/intimacy, gear/currency, and continuity ledgers as appropriate.

Only mutate STORY DATA namespaces: turn, player, npcs, health, world, reputation, progression, economy, names, continuity. Internal engine bookkeeping is off limits.`},
    {role:'user',content:`HISTORY IMPORT CHUNK ${chunkIndex}/${chunkCount}\n\nACTIVE PERSONA CONTEXT:\n${personaContext||'(none)'}\n\nCURRENT DERIVED STORY ENGINE STATE:\n${stateContext}\n\nTRANSCRIPT CHUNK:\n${transcriptChunk}`}
  ];
}

export function applyMutationBatch(input:StoryState,batch:StoryMutationBatch):{state:StoryState;notes:string[]}{
  let draft:any=JSON.parse(JSON.stringify(input));
  const notes:string[]=[];
  for(const mutation of batch.operations){
    try{applyOne(draft,mutation);notes.push(`${mutation.op} ${formatPath(mutation.path)}`);}catch(err){notes.push(`Skipped ${formatPath(mutation.path)}: ${err instanceof Error?err.message:String(err)}`);}
  }
  const state=normalizeState(draft);
  for(const npc of Object.values(state.npcs)){ ensureNpc(state,npc.name,npc.rank,npc.role,`mutation|${state.turn}`, 'Balanced'); enforceRelationshipInvariants(npc); }
  return {state,notes};
}

function applyOne(root:any,m:StoryMutation){
  const path=m.path;
  if(!path.length)throw new Error('empty path');
  const rootName=String(path[0]);
  if(!ALLOWED_ROOTS.has(rootName)||BLOCKED_ROOTS.has(rootName))throw new Error('path root not allowed');
  if(path.length===1){
    if(m.op==='delete')throw new Error('cannot delete a root namespace');
    if(m.op==='set'){root[rootName]=clone(m.value);return;}
    if(m.op==='merge'){root[rootName]=deepMerge(root[rootName],m.value);return;}
    if(m.op==='increment'){root[rootName]=Number(root[rootName]||0)+Number(m.value||0);return;}
    if(m.op==='append'){if(!Array.isArray(root[rootName]))root[rootName]=[];root[rootName].push(clone(m.value));return;}
    if(m.op==='remove_value'){if(Array.isArray(root[rootName]))root[rootName]=root[rootName].filter((x:any)=>!sameValue(x,m.value));return;}
  }
  const parent=getParent(root,path,m.op==='set'||m.op==='merge'||m.op==='append'||m.op==='increment');
  const key=path[path.length-1] as any;
  if(m.op==='set'){parent[key]=clone(m.value);return;}
  if(m.op==='delete'){if(Array.isArray(parent)&&typeof key==='number')parent.splice(key,1);else delete parent[key];return;}
  if(m.op==='increment'){parent[key]=Number(parent[key]||0)+Number(m.value||0);return;}
  if(m.op==='append'){if(!Array.isArray(parent[key]))parent[key]=[];parent[key].push(clone(m.value));return;}
  if(m.op==='remove_value'){if(Array.isArray(parent[key]))parent[key]=parent[key].filter((x:any)=>!sameValue(x,m.value));return;}
  if(m.op==='merge'){parent[key]=deepMerge(parent[key],m.value);return;}
}

function getParent(root:any,path:Array<string|number>,create:boolean){
  let cur=root;
  for(let i=0;i<path.length-1;i++){
    const key=path[i] as any;
    const next=path[i+1];
    if(cur[key]==null){if(!create)throw new Error(`missing ${String(key)}`);cur[key]=typeof next==='number'?[]:{};}
    if(typeof cur[key]!=='object')throw new Error(`non-container ${String(key)}`);
    cur=cur[key];
  }
  return cur;
}
function deepMerge(a:any,b:any):any{
  if(!b||typeof b!=='object'||Array.isArray(b))return clone(b);
  const out=a&&typeof a==='object'&&!Array.isArray(a)?{...a}:{};
  for(const [k,v] of Object.entries(b))out[k]=v&&typeof v==='object'&&!Array.isArray(v)?deepMerge(out[k],v):clone(v);
  return out;
}
function clone(v:any){return v===undefined?undefined:JSON.parse(JSON.stringify(v));}
function sameValue(a:any,b:any){try{return JSON.stringify(a)===JSON.stringify(b);}catch{return a===b;}}
function formatPath(path:Array<string|number>){return path.map(x=>typeof x==='number'?`[${x}]`:String(x)).join('.');}
