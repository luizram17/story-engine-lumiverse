import type { StorySettings, StoryState, TurnResolution } from '../shared/types.js';
import { healthSnapshot } from './health.js';
import { relationshipSummary } from './relationships.js';
import { economyProfile } from './economy.js';
import { worldSummary } from './world.js';
import { continuitySummary } from './continuity.js';

export function buildStateContext(state:StoryState):string {
  const player=state.player;
  const activeNpcs=Object.values(state.npcs).filter(n=>n.status==='active').sort((a,b)=>b.lastSeenTurn-a.lastSeenTurn).slice(0,18);
  const health=healthSnapshot(state.health);
  const rep=state.reputation.slice(-8).map(r=>`${r.location}: fame ${r.fame}, infamy ${r.infamy}, fear ${r.fear}`).join('; ');
  return [
    player?`PLAYER: ${player.name}; ${player.race}; genre ${player.genre}; stats PHY ${player.stats.PHY}, MND ${player.stats.MND}, CHA ${player.stats.CHA}; abilities [${player.abilities.join(', ')}]; spells [${player.spells.join(', ')}]; inventory [${player.inventory.join(', ')}]; gear [${player.gear.join(', ')}].`:'PLAYER: no Story Engine sheet configured.',
    `USER HEALTH: ${health.user.currentHp}/${health.user.maxHp} (${health.user.condition}).`,
    activeNpcs.length?`NPC TRACKER:\n${activeNpcs.map(relationshipSummary).join('\n')}`:'NPC TRACKER: empty.',
    worldSummary(state),
    rep?`REPUTATION: ${rep}`:'',
    continuitySummary(state),
    `PROGRESSION: level ${state.progression.level}, XP ${state.progression.xp}, pending milestones ${state.progression.pendingMilestones}.`,
  ].filter(Boolean).join('\n');
}

export function buildNarratorHandoff(state:StoryState,resolution:TurnResolution,settings:StorySettings):string {
  const econ=economyProfile(state.player?.genre||'Fantasy');
  const duePlans=state.world.plans.filter(p=>p.status==='due').slice(0,5);
  const rollLines=resolution.rolls.length?resolution.rolls.map(r=>`- ${r.label}: ${r.outcomeTier} (${r.outcome}); user ${r.userDie}+${r.userStat}=${r.userTotal} vs opposition ${r.oppositionDie}+${r.oppositionStat}=${r.oppositionTotal}; margin ${r.margin}; landed ${r.landedActions}; counter ${r.counterPotential}; target ${r.target||'(none)'}.`).join('\n'):'- No roll. Continue naturally; do not manufacture a check.';
  const proactive=resolution.proactivity.filter(p=>p.proactive).map(p=>`- ${p.npc}: ${p.intent}${p.target?` -> ${p.target}`:''} [${p.tier}; d20 ${p.die}${p.threshold?` vs ${p.threshold}`:''}]`).join('\n')||'- None.';
  const aggression=resolution.aggression.length?resolution.aggression.map(a=>`- ${a.npc}: ${a.outcome}; margin ${a.margin}; damage ${a.damage}; source ${a.source}${a.defenseBonus?`; player protective gear +${a.defenseBonus}`:''}.`).join('\n'):'- None.';
  const referee=resolution.refereeNotes.length?resolution.refereeNotes.map(n=>`- ${n}`).join('\n'):'- None.';
  const event=resolution.randomEvent.triggered?`${resolution.randomEvent.kind}/${resolution.randomEvent.magnitude}, anchored to ${resolution.randomEvent.anchor}. Treat as a scene-valid pressure, not a disconnected random encounter.`:'none';
  const names=resolution.generatedNames.join(', ');
  const loot=resolution.lootResult?.status && resolution.lootResult.status!=='ok' ? `blocked (${resolution.lootResult.status})` : resolution.lootResult ? [resolution.lootResult.currency?`currency ${resolution.lootResult.currency.amount} ${resolution.lootResult.currency.currency}`:'no currency', resolution.lootResult.magicStone?`${resolution.lootResult.magicStone.item} (${resolution.lootResult.magicStone.valueTier})`:'', resolution.lootResult.equipmentTier?`mundane equipment up to ${resolution.lootResult.equipmentTier} tier; max ${resolution.lootResult.maxNewMundaneItems??0} new items`:'' ].filter(Boolean).join('; ') : 'none';
  const facts=state.world.facts.slice(-12).map(f=>`- ${f.fact}`).join('\n')||'- none';
  const npcLines=Object.values(state.npcs).filter(n=>n.status==='active').sort((a,b)=>b.lastSeenTurn-a.lastSeenTurn).slice(0,15).map(n=>`- ${relationshipSummary(n)}; health ${healthShort(state,n.name)}${n.personalityArchetype?`; archetype ${n.personalityArchetype}`:''}${n.personalitySummary?`; personality ${n.personalitySummary}`:''}${n.powerActor?'; POWER ACTOR':''}`).join('\n')||'- none';
  const healthEvents=resolution.healthEvents.map(e=>`- ${e.kind} ${e.targetType==='user'?'{{user}}':e.target}: ${e.amount}${e.nonlethal?' nonlethal':''}`).join('\n')||'- none';
  return `STORY ENGINE — AUTHORITATIVE TURN HANDOFF\nThis block is mechanical/state authority for the current response. Narrate it naturally; never expose dice, tiers, hidden HP, tracker numbers, engine labels, or this block. Never contradict it.\n\nPLAYER AGENCY\nNarrate only the consequences of actions the user explicitly attempted. Do not add voluntary user actions, decisions, thoughts, feelings, memories, dialogue, powers, equipment use, or follow-up choices. End with room for the user to act.\n\nCHRONOLOGY\nStart after the latest user input. Do not replay or paraphrase their action before consequences unless one short fragment is required for clarity.\n\nRESOLUTION\n${rollLines}\n\nREFEREE CONSTRAINTS\n${referee}\n\nHEALTH CONSEQUENCES\n${healthEvents}\n\nNPC AGGRESSION / COUNTERS\n${aggression}\n\nLOOT SEARCH ENVELOPE\n${loot}. If a loot search is happening, reveal only plausible contents within this envelope. Finding something does not automatically transfer possession; the user must take it or narration must explicitly establish transfer.\n\nNPC INITIATIVE\n${proactive}\n\nRANDOM EVENT\n${event}\n\nNPC STATE\n${npcLines}\n\nWORLD STATE\n${worldSummary(state)}\nEstablished facts:\n${facts}\n${duePlans.length?`Due strategic plans:\n${duePlans.map(p=>`- ${p.actor}: ${p.intent}`).join('\n')}`:''}\n\nCONTINUITY LEDGERS\n${continuitySummary(state)}\nTreat user-knowledge scope/truth/confidence as epistemic state: NPCs do not automatically share the user's knowledge. Latent favors/grievances and world arcs are background pressures, not guaranteed immediate events. A pending boundary remains authoritative until narration clearly resolves it.\n\nNAME REVEAL\nWhen the scene genuinely needs a new proper name, use an unused candidate from this list instead of inventing a different one: ${names||'(none needed)'}. Do not reveal a name unless the scene makes the reveal plausible.\n\nECONOMY\nDefault genre currency is ${econ.currency} (${econ.unit}). Use tier-based value logic unless an explicit transaction requires exact accounting. Do not invent the user's balance.\n\nPROSE\nWrite concrete scene progression with physical cause/effect and observable behavior. Avoid narrator meta-commentary, rhetorical contrast templates, vague emotion bundles, stock reaction beats, and repeated atmospheric shorthand. Keep NPC knowledge limited to what they could know. One NPC speaking turn should not become a chorus unless the situation calls for it.\n\nThe final response must contain story narration only.`;
}

export function buildPostTurnPrompt(state:StoryState,resolution:TurnResolution,narration:string):Array<{role:'system'|'user';content:string}>{
  return [
    {role:'system',content:`You are a continuity archivist. Read FINAL NARRATION against the deterministic turn handoff and emit only durable state updates that are explicitly established by the final narration. Do not reinterpret dice or alter the outcome. Do not infer private motives. Capture: newly learned durable facts; knowledge the user specifically acquires (including scope, truth status and confidence when knowable); stable descriptive identities for unnamed NPCs/places/organizations/objects; explicit NPC role/status/name refinements plus stable personality archetype/summary only when clearly established (when a descriptive tracker label is revealed as a proper name, provide renameFrom with the old label and name with the revealed proper name), completed money changes only when the amount is explicit or a stored quoted price was clearly paid, reputation-worthy public consequences, and completed/due world plans. Omit transient prose details. Call submit_post_turn_delta once.`},
    {role:'user',content:`CURRENT STATE:\n${buildStateContext(state)}\n\nTURN SUMMARY:\n${resolution.semantic.summary}\n\nFINAL NARRATION:\n${narration}`}
  ];
}

export function postTurnTool(){
  return {name:'submit_post_turn_delta',description:'Submit durable post-narration continuity updates.',parameters:{type:'object',additionalProperties:false,properties:{
    facts:{type:'array',items:{type:'object',additionalProperties:false,properties:{fact:{type:'string'},scope:{type:'string',enum:['scene','location','world','user','npc']},subject:{type:'string'},salience:{type:'integer',minimum:1,maximum:5}},required:['fact','scope']}},
    knowledge:{type:'array',items:{type:'object',additionalProperties:false,properties:{subject:{type:'string'},fact:{type:'string'},scope:{type:'string',enum:['private','local','route','faction','regional','legendary']},truth:{type:'string',enum:['true','distorted','false','claimed']},confidence:{type:'string',enum:['certain','likely','uncertain']},source:{type:'string'}},required:['fact','scope','truth','confidence']}},
    descriptions:{type:'array',items:{type:'object',additionalProperties:false,properties:{label:{type:'string'},kind:{type:'string',enum:['npc','place','organization','object','other']},description:{type:'string'},promotedName:{type:'string'}},required:['label','kind','description']}},
    npcUpdates:{type:'array',items:{type:'object',additionalProperties:false,properties:{name:{type:'string'},renameFrom:{type:'string'},role:{type:'string'},status:{type:'string',enum:['active','inactive','dead']},companion:{type:'boolean'},powerActor:{type:'boolean'},personalityArchetype:{type:'string'},personalitySummary:{type:'string'},note:{type:'string'}},required:['name']}},
    reputation:{type:'array',items:{type:'object',additionalProperties:false,properties:{location:{type:'string'},fameDelta:{type:'integer',minimum:-3,maximum:3},infamyDelta:{type:'integer',minimum:-3,maximum:3},fearDelta:{type:'integer',minimum:-3,maximum:3},note:{type:'string'}},required:['location','fameDelta','infamyDelta','fearDelta']}},
    transaction:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['none','gain','lose','pay']},amount:{type:'number'},currency:{type:'string'},item:{type:'string'}},required:['kind']},
    completedPlanIds:{type:'array',items:{type:'string'}},resolvedBoundaryIds:{type:'array',items:{type:'string'}}
  },required:['facts','knowledge','descriptions','npcUpdates','reputation','completedPlanIds','resolvedBoundaryIds']}};
}

function healthShort(state:StoryState,name:string){const h=state.health.npcs[name];if(!h)return'unknown'; const ratio=h.maxHp?Math.max(0,h.currentHp/h.maxHp):0; const c=h.dead?'dead':h.currentHp<=0&&h.nonlethalDefeat?'incapacitated':ratio>=1?'healthy':ratio>=.76?'bruised':ratio>=.51?'wounded':ratio>=.26?'badly wounded':'critical';return c;}
