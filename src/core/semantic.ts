import type { CapabilityPool, ChallengeType, Rank, SemanticAction, SemanticActor, SemanticLedger, StatKey, Weather } from '../shared/types.js';
import { MAX_ACTIONS } from './config.js';
import { object, text, bool, clampInt } from './state.js';

const challengeTypes: ChallengeType[]=['none','social','mundane_combat','supernatural_combat','restraint','stealth','environment'];
const stats: Array<StatKey|'NONE'>=['PHY','MND','CHA','NONE'];
const ranks:Rank[]=['Weak','Average','Trained','Elite','Boss'];
const capabilityPools:CapabilityPool[]=['common','trained','elite','boss'];
const weathers:Weather[]=['clear','partly_cloudy','cloudy','overcast','light_rain','heavy_rain','storm'];

export function semanticTool() {
  return {
    name:'submit_story_ledger',
    description:'Submit the semantic story-action ledger. Extract only explicit or well-established scene facts; do not resolve dice or invent outcomes.',
    parameters:{
      type:'object', additionalProperties:false,
      properties:{
        summary:{type:'string'},
        actions:{type:'array',maxItems:3,items:{type:'object',additionalProperties:false,properties:{
          label:{type:'string'},kind:{type:'string',enum:['attack','social','stealth','environment','restraint','heal','loot','transaction','other']},target:{type:'string'},challengeType:{type:'string',enum:challengeTypes},rollNeeded:{type:'boolean'},stat:{type:'string',enum:stats},targetStat:{type:'string',enum:stats},difficulty:{type:'integer',minimum:1,maximum:5},actionLength:{type:'integer',minimum:1,maximum:3},harmful:{type:'boolean'},harmMode:{type:'string',enum:['none','lethal','nonlethal','restraint_control']},supernatural:{type:'boolean'},healingMagic:{type:'boolean'},abilityUse:{type:'string'},itemUse:{type:'string'},socialTactic:{type:'string',enum:['diplomacy','bluff','intimidate','none']},socialGoal:{type:'string'}
        },required:['label','kind','target','challengeType','rollNeeded','stat','difficulty','actionLength','harmful','harmMode','supernatural','healingMagic']}},
        actors:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},role:{type:'string'},rank:{type:'string',enum:ranks},capabilityPool:{type:'string',enum:capabilityPools},mainStat:{type:'string',enum:['PHY','MND','CHA','Balanced']},relation:{type:'string',enum:['direct','opposed','benefited','harmed','observer','neutral']},powerActor:{type:'boolean'},companion:{type:'boolean'},initialBond:{type:'integer',minimum:0,maximum:4},initialFear:{type:'integer',minimum:0,maximum:4},initialHostility:{type:'integer',minimum:0,maximum:4},initialRomanceStage:{type:'string',enum:['none','interest','dating','partner']},initialIntimacy:{type:'integer',minimum:0,maximum:4},personalityArchetype:{type:'string'},personalitySummary:{type:'string'},initialNotes:{type:'array',items:{type:'string'},maxItems:8},relationshipContext:{type:'string'},initialRelationshipDescriptors:{type:'array',items:{type:'string'},maxItems:12},evidence:{type:'string'}},required:['name','role','rank','relation','powerActor','companion']}},
        explicitIntimidationOrCoercion:{type:'boolean'}, intimacyAdvanceExplicit:{type:'boolean'},
        boundaryPressure:{type:'object',additionalProperties:false,properties:{present:{type:'boolean'},target:{type:'string'},kind:{type:'string'}},required:['present','target','kind']},
        restraintControl:{type:'object',additionalProperties:false,properties:{present:{type:'boolean'},target:{type:'string'},evidence:{type:'string'}},required:['present','target']},
        boundaryBreak:{type:'object',additionalProperties:false,properties:{present:{type:'boolean'},boundaryId:{type:'string'},target:{type:'string'},kind:{type:'string'},response:{type:'string'},evidence:{type:'string'}},required:['present','boundaryId','target','kind']},
        claimCheck:{type:'object',additionalProperties:false,properties:{present:{type:'boolean'},target:{type:'string'},claim:{type:'string'},truth:{type:'string',enum:['true','false','uncertain','claimed']},access:{type:'string',enum:['knows_true','knows_false','can_verify','cannot_verify','unknown']},stakesImpact:{type:'boolean'}},required:['present','target','claim','truth','access','stakesImpact']},
        activeHostileThreat:{type:'boolean'},
        scene:{type:'object',additionalProperties:false,properties:{location:{type:'string'},area:{type:'string'},indoors:{type:'boolean'},timeAdvance:{type:'integer',minimum:0,maximum:4},weather:{type:'string',enum:['',...weathers]},publicWitnesses:{type:'boolean'},danger:{type:'string',enum:['calm','active','crisis']}},required:['publicWitnesses','danger']},
        transaction:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['none','quote','pay','gain','lose']},amount:{type:'number'},currency:{type:'string'},item:{type:'string'},target:{type:'string'}},required:['kind']},
        loot:{type:'object',additionalProperties:false,properties:{present:{type:'boolean'},target:{type:'string'},targetKind:{type:'string',enum:['humanoid','monster','container','other']},rank:{type:'string',enum:ranks}},required:['present','target','targetKind','rank']},
        memoryFacts:{type:'array',items:{type:'object',additionalProperties:false,properties:{fact:{type:'string'},scope:{type:'string',enum:['scene','location','world','user','npc']},subject:{type:'string'},salience:{type:'integer',minimum:1,maximum:5}},required:['fact','scope']}},
        namesNeeded:{type:'array',items:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['npc','place','organization']},hint:{type:'string'}},required:['kind','hint']}},
        powerActorSignals:{type:'array',items:{type:'object',additionalProperties:false,properties:{actor:{type:'string'},signal:{type:'string',enum:['notice','favor','grievance','threat','opportunity']},magnitude:{type:'integer',minimum:1,maximum:3}},required:['actor','signal','magnitude']}}
      },
      required:['summary','actions','actors','explicitIntimidationOrCoercion','intimacyAdvanceExplicit','scene','memoryFacts','namesNeeded','powerActorSignals']
    }
  };
}

export function buildSemanticPrompt(input:{ userMessage:string; history:string; stateContext:string }):Array<{role:'system'|'user';content:string}> {
  return [
    {role:'system',content:`You are the semantic referee for a roleplay simulation. Convert the latest USER INPUT into a strict ledger for deterministic code. Never decide dice, success, failure, damage, relationship changes, or prose. Extract only what is explicit in the input or clearly established in CONTEXT.

ROLL GATE: rollNeeded=true only for a fresh unresolved external stake: danger/harm, meaningful contested access or resources, secret acquisition, pursuit/escape, meaningful social leverage, stealth against a specific living detector, or a nontrivial obstacle. Do not roll for harmless conversation, flavor, introspection, already-decided facts, ordinary continuity, safe aid, impossible/unavailable item use, or searching already-established dead remains without a separate hazard.

Challenge routing: social for persuasion/deception/intimidation; mundane_combat for ordinary harmful attacks; supernatural_combat for magical/psychic harmful attacks; restraint for non-harmful physical control contests (harmMode=restraint_control); stealth only against a specific living detector; environment for hazards, locks, chase, terrain, objects and nonliving opposition.

ACTION BUDGET: represent at most three action units total. A sequence such as “stab three times” is one action with actionLength=3. Three different attempted actions are three entries with actionLength=1 each. Never exceed three total actionLength across all entries.

AVAILABILITY: if the user explicitly invokes an item, spell, named ability, or natural weapon, write its exact short name into itemUse/abilityUse. Do not assume it exists. The deterministic layer will verify ownership/capability. Abilities do not grant automatic success or a numeric bonus by themselves.

SOCIAL: record tactic and a short socialGoal. Mark explicitIntimidationOrCoercion only when actual coercive pressure occurs. A social success changes leverage/presentation, never objective truth. When a meaningful factual claim is central to a contested social action, fill claimCheck with the claim's established truth status and what the target can actually know or verify.

BOUNDARIES: intimacyAdvanceExplicit is only for an explicit attempt to advance romantic/sexual intimacy. boundaryPressure is for object/space/departure or other established access boundaries, not ordinary flirting or disagreement. restraintControl is for physical restraint/control. boundaryBreak is ONLY for continuation/escalation after a pending boundary already shown in STATE CONTEXT, and its boundaryId/target/kind must match exactly; otherwise present=false.

HOSTILITY: activeHostileThreat=true only when an active, immediate hostile threat already exists in the scene.

NPC CAPABILITY: for a newly encountered actor, choose a capabilityPool from common/trained/elite/boss based on established fiction, plus mainStat PHY/MND/CHA/Balanced. rank is only a conservative fallback/summary; deterministic code assigns a stable new-NPC rank from the pool and then persists it. Never change an established NPC's rank from the tracker.

ESTABLISHED STARTING RELATIONSHIPS / TRAITS: when a newly encountered tracker entry is already established by the roleplay as having ANY pre-existing relationship or stable trait, preserve it directly. This includes positive, negative, mixed, familial, romantic, professional, hierarchical, coercive, competitive, indebted, loyal, fearful, hostile, estranged, protective, mentor/student, former-partner and other setting-specific relationships. Populate initialBond/initialFear/initialHostility, initialRomanceStage/initialIntimacy, personalityArchetype/personalitySummary, initialNotes, relationshipContext, and initialRelationshipDescriptors as appropriate. relationshipContext is a concise natural-language explanation; initialRelationshipDescriptors is a list of short freeform labels such as ["older sister", "protective"], ["sworn enemy", "former commander"], or ["rival", "mutual respect"]. These are facts that were already true before the current action, not turn-result changes. Do not force a new NPC to neutral when context establishes otherwise, and do not assume positive relationships are the only non-neutral starting state.

For unnamed NPCs, use a stable descriptive label rather than inventing a proper name; namesNeeded may request a future generated name. Call submit_story_ledger exactly once.`},
    {role:'user',content:`STATE CONTEXT:\n${input.stateContext}\n\nRECENT ROLEPLAY:\n${input.history}\n\nLATEST USER INPUT:\n${input.userMessage}`}
  ];
}

export function normalizeSemanticLedger(value:unknown):SemanticLedger {
  const src=object(value); const scene=object(src.scene); const bp=object(src.boundaryPressure); const restraint=object(src.restraintControl); const boundaryBreak=object(src.boundaryBreak); const claim=object(src.claimCheck); const tx=object(src.transaction); const loot=object(src.loot);
  let budget=MAX_ACTIONS;
  const actions=(Array.isArray(src.actions)?src.actions:[]).slice(0,MAX_ACTIONS).map(normalizeAction).filter(a=>{
    if(budget<=0)return false;
    a.actionLength=Math.max(1,Math.min(a.actionLength,budget)) as 1|2|3;
    budget-=a.actionLength;
    return true;
  });
  return {
    summary:text(src.summary).slice(0,500),
    actions,
    actors:(Array.isArray(src.actors)?src.actors:[]).slice(0,40).map(normalizeActor).filter(a=>a.name),
    explicitIntimidationOrCoercion:bool(src.explicitIntimidationOrCoercion,false),
    intimacyAdvanceExplicit:bool(src.intimacyAdvanceExplicit,false),
    boundaryPressure:bp && Object.keys(bp).length?{present:bool(bp.present,false),target:text(bp.target),kind:text(bp.kind)}:undefined,
    restraintControl:Object.keys(restraint).length?{present:bool(restraint.present,false),target:text(restraint.target),evidence:text(restraint.evidence)||undefined}:undefined,
    boundaryBreak:Object.keys(boundaryBreak).length?{present:bool(boundaryBreak.present,false),boundaryId:text(boundaryBreak.boundaryId),target:text(boundaryBreak.target),kind:text(boundaryBreak.kind),response:text(boundaryBreak.response)||undefined,evidence:text(boundaryBreak.evidence)||undefined}:undefined,
    claimCheck:Object.keys(claim).length?{present:bool(claim.present,false),target:text(claim.target),claim:text(claim.claim).slice(0,500),truth:['true','false','uncertain','claimed'].includes(String(claim.truth))?claim.truth:'claimed',access:['knows_true','knows_false','can_verify','cannot_verify','unknown'].includes(String(claim.access))?claim.access:'unknown',stakesImpact:bool(claim.stakesImpact,false)}:undefined,
    activeHostileThreat:bool(src.activeHostileThreat,false),
    scene:{
      location:text(scene.location)||undefined, area:text(scene.area)||undefined, indoors:typeof scene.indoors==='boolean'?scene.indoors:undefined,
      timeAdvance:clampInt(scene.timeAdvance,0,4,0) as 0|1|2|3|4,
      weather:weathers.includes(String(scene.weather) as Weather)?scene.weather as Weather:'', publicWitnesses:bool(scene.publicWitnesses,false),
      danger:['calm','active','crisis'].includes(String(scene.danger))?scene.danger as any:'calm',
    },
    transaction:Object.keys(tx).length?{kind:['none','quote','pay','gain','lose'].includes(String(tx.kind))?tx.kind:'none',amount:Number.isFinite(Number(tx.amount))?Number(tx.amount):undefined,currency:text(tx.currency)||undefined,item:text(tx.item)||undefined,target:text(tx.target)||undefined}:undefined,
    loot:Object.keys(loot).length?{present:bool(loot.present,false),target:text(loot.target),targetKind:['humanoid','monster','container','other'].includes(String(loot.targetKind))?loot.targetKind:'other',rank:ranks.includes(String(loot.rank) as Rank)?loot.rank as Rank:'Average'}:undefined,
    memoryFacts:(Array.isArray(src.memoryFacts)?src.memoryFacts:[]).slice(0,20).map((x:any)=>{const o=object(x);return{fact:text(o.fact).slice(0,600),scope:['scene','location','world','user','npc'].includes(String(o.scope))?o.scope:'world',subject:text(o.subject)||undefined,salience:clampInt(o.salience,1,5,2)}}).filter((x:any)=>x.fact) as any,
    namesNeeded:(Array.isArray(src.namesNeeded)?src.namesNeeded:[]).slice(0,12).map((x:any)=>{const o=object(x);return{kind:['npc','place','organization'].includes(String(o.kind))?o.kind:'npc',hint:text(o.hint).slice(0,160)}}) as any,
    powerActorSignals:(Array.isArray(src.powerActorSignals)?src.powerActorSignals:[]).slice(0,12).map((x:any)=>{const o=object(x);return{actor:text(o.actor),signal:['notice','favor','grievance','threat','opportunity'].includes(String(o.signal))?o.signal:'notice',magnitude:clampInt(o.magnitude,1,3,1) as 1|2|3}}).filter((x:any)=>x.actor) as any,
  };
}

export function fallbackSemanticLedger(userMessage:string):SemanticLedger {
  const lower=userMessage.toLowerCase();
  const harmful=/\b(attack|hit|stab|shoot|slash|punch|kick|kill|strike|blast|burn|cut|smash|fire at)\b/i.test(userMessage);
  const social=/\b(persuad|convinc|threaten|intimidat|lie to|deceiv|bargain|negotiate)\b/i.test(userMessage);
  const stealth=/\b(sneak|hide from|avoid detection|stealth)\b/i.test(userMessage);
  const heal=/\b(heal|treat|bandage|cure)\b/i.test(userMessage);
  const challengeType:ChallengeType=harmful?'mundane_combat':social?'social':stealth?'stealth':'none';
  const action:SemanticAction={label:userMessage.slice(0,160),kind:harmful?'attack':social?'social':stealth?'stealth':heal?'heal':'other',target:'',challengeType,rollNeeded:challengeType!=='none',stat:challengeType==='social'?'CHA':'PHY',difficulty:3,actionLength:1,harmful,harmMode:harmful?(lower.includes('kill')?'lethal':'nonlethal'):'none',supernatural:false,healingMagic:false,socialTactic:social?(lower.includes('intimid')||lower.includes('threat')?'intimidate':lower.includes('lie')||lower.includes('deceiv')?'bluff':'diplomacy'):'none',socialGoal:social?userMessage.slice(0,100):''};
  return {summary:userMessage.slice(0,300),actions:[action],actors:[],explicitIntimidationOrCoercion:/\b(threaten|intimidat|coerc)\b/i.test(userMessage),intimacyAdvanceExplicit:/\b(kiss|date|romance|sex|intimate)\b/i.test(userMessage),scene:{publicWitnesses:false,danger:harmful?'active':'calm'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]};
}

function normalizeAction(value:unknown):SemanticAction{
  const o=object(value); const challenge=challengeTypes.includes(String(o.challengeType) as ChallengeType)?o.challengeType as ChallengeType:'none'; const kind=['attack','social','stealth','environment','restraint','heal','loot','transaction','other'].includes(String(o.kind))?o.kind as SemanticAction['kind']:'other';
  return {label:text(o.label).slice(0,200),kind,target:text(o.target).slice(0,120),challengeType:challenge,rollNeeded:bool(o.rollNeeded,false),stat:stats.includes(String(o.stat) as any)?o.stat as any:'NONE',targetStat:stats.includes(String(o.targetStat) as any)?o.targetStat as any:'NONE',difficulty:clampInt(o.difficulty,1,5,3) as 1|2|3|4|5,actionLength:clampInt(o.actionLength,1,3,1) as 1|2|3,harmful:bool(o.harmful,false),harmMode:['none','lethal','nonlethal','restraint_control'].includes(String(o.harmMode))?o.harmMode:(challenge==='restraint'?'restraint_control':'none'),supernatural:bool(o.supernatural,false),healingMagic:bool(o.healingMagic,false),abilityUse:text(o.abilityUse)||undefined,itemUse:text(o.itemUse)||undefined,socialTactic:['diplomacy','bluff','intimidate','none'].includes(String(o.socialTactic))?o.socialTactic:'none',socialGoal:text(o.socialGoal).slice(0,160)||undefined};
}
function normalizeActor(value:unknown):SemanticActor{const o=object(value);return{name:text(o.name).slice(0,120),role:text(o.role).slice(0,120)||'NPC',rank:ranks.includes(String(o.rank) as Rank)?o.rank as Rank:'Average',capabilityPool:capabilityPools.includes(String(o.capabilityPool) as CapabilityPool)?o.capabilityPool as CapabilityPool:undefined,mainStat:['PHY','MND','CHA','Balanced'].includes(String(o.mainStat))?o.mainStat as any:undefined,relation:['direct','opposed','benefited','harmed','observer','neutral'].includes(String(o.relation))?o.relation:'neutral',powerActor:bool(o.powerActor,false),companion:bool(o.companion,false),initialBond:o.initialBond==null?undefined:clampInt(o.initialBond,0,4,0),initialFear:o.initialFear==null?undefined:clampInt(o.initialFear,0,4,0),initialHostility:o.initialHostility==null?undefined:clampInt(o.initialHostility,0,4,0),initialRomanceStage:['none','interest','dating','partner'].includes(String(o.initialRomanceStage))?o.initialRomanceStage as any:undefined,initialIntimacy:o.initialIntimacy==null?undefined:clampInt(o.initialIntimacy,0,4,0),personalityArchetype:text(o.personalityArchetype).slice(0,80)||undefined,personalitySummary:text(o.personalitySummary).slice(0,500)||undefined,initialNotes:Array.isArray(o.initialNotes)?o.initialNotes.map((x:any)=>text(x)).filter(Boolean).slice(0,8):undefined,relationshipContext:text(o.relationshipContext).slice(0,300)||undefined,initialRelationshipDescriptors:Array.isArray(o.initialRelationshipDescriptors)?o.initialRelationshipDescriptors.map((x:any)=>text(x).slice(0,100)).filter(Boolean).slice(0,12):undefined,evidence:text(o.evidence).slice(0,240)||undefined};}
