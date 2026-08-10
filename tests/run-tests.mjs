import assert from 'node:assert/strict';
import { combatOutcome, nonHostileOutcome, resolveTurn } from '../dist/core/mechanics.js';
import { createDefaultState, normalizeState, ensureNpc, rankFromCapabilityPool, makeCoreSnapshot, restoreCoreSnapshot } from '../dist/core/state.js';
import { conditionFromActor, applyDamage, applyHeal, safeSceneHealing } from '../dist/core/health.js';
import { deterministicLoot, addCurrency, resolvePlayerEquipmentDefense } from '../dist/core/economy.js';
import { collectProseFindings } from '../dist/core/prose.js';
import { generateUniqueNames } from '../dist/core/names.js';
import { normalizeSemanticLedger } from '../dist/core/semantic.js';
import { applyContinuitySemantic, boundaryGate, upsertKnowledge } from '../dist/core/continuity.js';
import { extractOocCommands, stripOocCommands, normalizeMutationBatch, applyMutationBatch } from '../dist/core/commands.js';
import { validateCharacterInput } from '../dist/core/character.js';
import { updateRelationships } from '../dist/core/relationships.js';
import { applyWorldSemantic } from '../dist/core/world.js';

assert.equal(combatOutcome(8,3).outcomeTier,'Critical_Success');
assert.equal(combatOutcome(5,3).landedActions,2);
assert.equal(combatOutcome(1,1).landedActions,1);
assert.equal(combatOutcome(8,1).landedActions,1);
assert.equal(combatOutcome(0,3).outcomeTier,'Stalemate');
assert.equal(combatOutcome(-2,3).counterPotential,'light');
assert.equal(combatOutcome(-5,3).counterPotential,'medium');
assert.equal(combatOutcome(-8,3).counterPotential,'severe');
assert.equal(nonHostileOutcome(1).outcomeTier,'Success');
assert.equal(nonHostileOutcome(-1).outcomeTier,'Failure');


// Scene presence is explicit when known and conservative when semantic fallback cannot establish it.
const presenceState=createDefaultState();
const presentNpc=ensureNpc(presenceState,'Mira','Average','friend','presence-seed');
presenceState.world.presentNpcs=['Mira'];
const unknownPresence=normalizeSemanticLedger({summary:'small talk',actions:[],actors:[],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{publicWitnesses:false,danger:'calm'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
assert.equal(unknownPresence.scene.presentNpcs,undefined);
applyWorldSemantic(presenceState,unknownPresence,'presence-unknown');
assert.deepEqual(presenceState.world.presentNpcs,['Mira'],'unknown semantic presence must not clear an established scene');
const changedPresence=normalizeSemanticLedger({summary:'Mira leaves, guard remains',actions:[],actors:[],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{presentNpcs:['Gate Guard'],publicWitnesses:true,danger:'calm'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
applyWorldSemantic(presenceState,changedPresence,'presence-known');
assert.deepEqual(presenceState.world.presentNpcs,['Gate Guard']);
const legacyPresence=normalizeState({...createDefaultState(),version:7,turn:3,world:{...createDefaultState().world,presentNpcs:undefined},npcs:{Mira:{...presentNpc,lastSeenTurn:3,status:'active'}}});
assert.deepEqual(legacyPresence.world.presentNpcs,['Mira'],'v7 migration should conservatively recover NPCs seen on the current turn');


// Starting character point-buy is exactly 15, with 1-9 per stat.
assert.deepEqual(validateCharacterInput({name:'Balanced',race:'Human',genre:'Fantasy',concept:'',appearance:'',backstory:'',stats:{PHY:5,MND:5,CHA:5}}),[]);
assert.ok(validateCharacterInput({name:'Too strong',race:'Human',genre:'Fantasy',concept:'',appearance:'',backstory:'',stats:{PHY:8,MND:8,CHA:8}}).some(x=>x.includes('15')));

// OOC extraction is isolated from IC text and structured mutations can retcon story data.
assert.deepEqual(extractOocCommands('I nod. ((Mira is my best friend)) Then I leave. ((Add a sword to my inventory))'),['Mira is my best friend','Add a sword to my inventory']);
assert.equal(stripOocCommands('I nod. ((secret admin)) Then I leave.'),'I nod. Then I leave.');
const commandState=createDefaultState();commandState.player={name:'Hero',race:'Human',genre:'Fantasy',appearance:'',stats:{PHY:5,MND:5,CHA:5},naturalWeapons:[],abilities:[],spells:[],inventory:[],currency:[],gear:[],anchors:[]};
const batch=normalizeMutationBatch({summary:'retcon',operations:[{op:'append',path:['player','inventory'],value:'Sword'},{op:'set',path:['npcs','Mira','bond'],value:4},{op:'set',path:['npcs','Mira','role'],value:'best friend'}]});
const commandApplied=applyMutationBatch(commandState,batch).state;
assert.ok(commandApplied.player.inventory.includes('Sword'));assert.equal(commandApplied.npcs.Mira.bond,4);assert.ok(commandApplied.health.npcs.Mira);

// A newly established NPC may begin with a non-neutral relationship and stable traits.
const establishedState=createDefaultState();
const establishedSem=normalizeSemanticLedger({summary:'meet old friend',actions:[],actors:[{name:'Lena',role:'childhood friend',rank:'Average',relation:'direct',powerActor:false,companion:true,initialBond:4,initialFear:0,initialHostility:0,personalityArchetype:'Protective confidante',personalitySummary:'Treats the player as her closest friend.',relationshipContext:'Best friends since childhood',initialRelationshipDescriptors:['childhood best friend','protective confidante']}],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{publicWitnesses:false,danger:'calm'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
updateRelationships(establishedState,establishedSem,[],'established');
assert.equal(establishedState.npcs.Lena.bond,4);
assert.deepEqual(establishedState.npcs.Lena.relationshipDescriptors,['childhood best friend','protective confidante']);
const hostileState=createDefaultState();
const hostileSem=normalizeSemanticLedger({summary:'meet old enemy',actions:[],actors:[{name:'Varek',role:'former commander',rank:'Trained',relation:'direct',powerActor:false,companion:false,initialBond:0,initialFear:1,initialHostility:4,relationshipContext:'Sworn enemies after a military betrayal',initialRelationshipDescriptors:['sworn enemy','former commander','mutual history']}],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{publicWitnesses:false,danger:'calm'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
updateRelationships(hostileState,hostileSem,[],'hostile-seed');
assert.equal(hostileState.npcs.Varek.hostility,4);
assert.equal(hostileState.npcs.Varek.disposition,'hatred');
assert.ok(hostileState.npcs.Varek.relationshipDescriptors.includes('sworn enemy'));
assert.equal(establishedState.npcs.Lena.companion,true);assert.match(establishedState.npcs.Lena.notes.join(' '),/Best friends since childhood/);

assert.equal(conditionFromActor({maxHp:100,currentHp:100,dead:false,nonlethalDefeat:false}),'healthy');
assert.equal(conditionFromActor({maxHp:100,currentHp:76,dead:false,nonlethalDefeat:false}),'bruised');
assert.equal(conditionFromActor({maxHp:100,currentHp:75,dead:false,nonlethalDefeat:false}),'wounded');
assert.equal(conditionFromActor({maxHp:100,currentHp:51,dead:false,nonlethalDefeat:false}),'wounded');
assert.equal(conditionFromActor({maxHp:100,currentHp:50,dead:false,nonlethalDefeat:false}),'badly_wounded');
assert.equal(conditionFromActor({maxHp:100,currentHp:26,dead:false,nonlethalDefeat:false}),'badly_wounded');
assert.equal(conditionFromActor({maxHp:100,currentHp:25,dead:false,nonlethalDefeat:false}),'critical');
const actor={maxHp:10,currentHp:10,dead:false,nonlethalDefeat:false};
applyDamage(actor,3); assert.equal(conditionFromActor(actor),'wounded');
applyDamage(actor,4); assert.equal(conditionFromActor(actor),'badly_wounded');
applyHeal(actor,7); assert.equal(conditionFromActor(actor),'healthy');
applyDamage(actor,999,true); assert.equal(conditionFromActor(actor),'incapacitated');
assert.equal(safeSceneHealing(false),3); assert.equal(safeSceneHealing(true),9);

const state=createDefaultState();
state.player={name:'Test',race:'Human',genre:'Fantasy',appearance:'',stats:{PHY:8,MND:8,CHA:8},naturalWeapons:[],abilities:['Battle Focus'],spells:['Mend'],inventory:['rope'],currency:[],gear:['steel breastplate'],anchors:[]};
state.economy.equipmentTiers=[{item:'steel breastplate',tier:'expensive'}];
assert.equal(resolvePlayerEquipmentDefense(state)?.bonus,2);
const npc=ensureNpc(state,'Guard','Trained','guard','seed');
assert.ok(npc.stats.PHY>=5&&npc.stats.PHY<=8);
const snap=makeCoreSnapshot(state); state.turn=99; state.player.stats.PHY=1; restoreCoreSnapshot(state,snap); assert.equal(state.turn,0); assert.equal(state.player.stats.PHY,8);
// Capability-pool rank assignment is deterministic and established NPC rank is immutable across later semantic guesses.
const poolRank1=rankFromCapabilityPool('common','pool-seed','Newcomer','Boss');
const poolRank2=rankFromCapabilityPool('common','pool-seed','Newcomer','Weak');
assert.equal(poolRank1,poolRank2);
const stableNpc=ensureNpc(state,'Stable Rank','Elite','veteran','rank-seed');
ensureNpc(state,'Stable Rank','Weak','veteran','rank-seed-2');
assert.equal(stableNpc.rank,'Elite');


const a=deterministicLoot('same','Elite','Fantasy','humanoid');
const b=deterministicLoot('same','Elite','Fantasy','humanoid'); assert.deepEqual(a,b);
assert.deepEqual(addCurrency([{currency:'silver',amount:10}],'silver',5),[{currency:'silver',amount:15}]);

const names1=generateUniqueNames(state,8,'seed','Balanced Fantasy');
state.names.used.push(...names1);
const names2=generateUniqueNames(state,8,'seed2','Balanced Fantasy');
assert.equal(new Set([...names1,...names2]).size,names1.length+names2.length);


const continuityState=createDefaultState();
const friend=ensureNpc(continuityState,'Mira','Average','companion','continuity-seed');friend.companion=true;friend.bond=4;
const pressureSem=normalizeSemanticLedger({summary:'push boundary',actions:[{label:'try to enter anyway',kind:'environment',target:'Mira',challengeType:'environment',rollNeeded:false,stat:'PHY',difficulty:3,actionLength:1,harmful:false,harmMode:'none',supernatural:false,healingMagic:false}],actors:[{name:'Mira',role:'companion',rank:'Average',relation:'direct',powerActor:false,companion:true}],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,boundaryPressure:{present:true,target:'Mira',kind:'space_access'},scene:{publicWitnesses:false,danger:'calm'},memoryFacts:[],namesNeeded:[],powerActorSignals:[{actor:'Mira',signal:'favor',magnitude:2}]});
assert.equal(boundaryGate(continuityState,pressureSem).mode,'grace');
applyContinuitySemantic(continuityState,pressureSem);
assert.equal(continuityState.continuity.pendingBoundary.warnings,1);
assert.equal(continuityState.continuity.pendingBoundary.threshold,2);
assert.equal(continuityState.continuity.boundCompanion.name,'Mira');
assert.equal(continuityState.continuity.latentFavors.length,1);
upsertKnowledge(continuityState,{subject:'Mira',fact:'The east gate opens at dawn.',scope:'local',truth:'claimed',confidence:'likely',source:'Mira'});
assert.equal(continuityState.continuity.userKnowledge[0]?.scope,'local');
applyContinuitySemantic(continuityState,pressureSem);
assert.equal(boundaryGate(continuityState,pressureSem).mode,'force');


const corpse=ensureNpc(state,'Fallen Scout','Average','scout','corpse-seed');
state.health.npcs[corpse.name].currentHp=0; state.health.npcs[corpse.name].dead=true;
const lootSem=normalizeSemanticLedger({summary:'search corpse',actions:[],actors:[{name:'Fallen Scout',role:'scout',rank:'Boss',capabilityPool:'common',mainStat:'PHY',relation:'neutral',powerActor:false,companion:false}],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{publicWitnesses:false,danger:'calm'},loot:{present:true,target:'Fallen Scout',targetKind:'humanoid',rank:'Boss'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
const corpseLoot=resolveTurn(state,lootSem,'loot','loot-seed',{randomEvents:false,randomEventChance:0,proactivity:false,nameStyle:'Balanced Fantasy'});
assert.equal(corpseLoot.lootResult?.status,'ok');
assert.equal(corpseLoot.lootResult?.target,'Fallen Scout');
corpse.lootSearchCompleted=true;
const corpseLootAgain=resolveTurn(state,lootSem,'loot2','loot-seed-2',{randomEvents:false,randomEventChance:0,proactivity:false,nameStyle:'Balanced Fantasy'});
assert.equal(corpseLootAgain.lootResult?.status,'already_searched');

const findings=collectProseFindings('For a moment, the air seemed to thicken. His eyes darkened.');
assert.ok(findings.length>=2);

const sem=normalizeSemanticLedger({summary:'attack',actions:[{label:'slash',kind:'attack',target:'Guard',challengeType:'mundane_combat',rollNeeded:true,stat:'PHY',difficulty:3,actionLength:3,harmful:true,harmMode:'nonlethal',supernatural:false,healingMagic:false}],actors:[{name:'Guard',role:'guard',rank:'Trained',relation:'opposed',powerActor:false,companion:false}],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{publicWitnesses:true,danger:'active'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
const r1=resolveTurn(state,sem,'fp','stable-seed',{randomEvents:true,randomEventChance:.08,proactivity:true,nameStyle:'Balanced Fantasy'});
const fresh=createDefaultState();fresh.player=structuredClone(state.player);fresh.economy.equipmentTiers=structuredClone(state.economy.equipmentTiers);ensureNpc(fresh,'Guard','Trained','guard','seed');
const r2=resolveTurn(fresh,sem,'fp','stable-seed',{randomEvents:true,randomEventChance:.08,proactivity:true,nameStyle:'Balanced Fantasy'});
assert.deepEqual(r1.rolls,r2.rolls);
assert.ok(r1.healthEvents.filter(e=>e.target==='Guard'&&e.kind==='damage').every(e=>[3,6,9].includes(e.amount)),'combat damage must be tier damage, never multiplied by hit count');

const safeHeal=normalizeSemanticLedger({summary:'safe aid',actions:[{label:'mend wounds',kind:'heal',target:'',challengeType:'none',rollNeeded:false,stat:'MND',difficulty:1,actionLength:1,harmful:false,harmMode:'none',supernatural:true,healingMagic:true,abilityUse:'Mend'}],actors:[],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{publicWitnesses:false,danger:'calm'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
const healed=resolveTurn(state,safeHeal,'heal','heal-seed',{randomEvents:false,randomEventChance:0,proactivity:false,nameStyle:'Balanced Fantasy'});
assert.equal(healed.healthEvents[0]?.amount,9);

const unavailable=normalizeSemanticLedger({summary:'use absent gun',actions:[{label:'shoot',kind:'attack',target:'Guard',challengeType:'mundane_combat',rollNeeded:true,stat:'PHY',difficulty:3,actionLength:1,harmful:true,harmMode:'lethal',supernatural:false,healingMagic:false,itemUse:'pistol'}],actors:[{name:'Guard',role:'guard',rank:'Trained',relation:'opposed',powerActor:false,companion:false}],explicitIntimidationOrCoercion:false,intimacyAdvanceExplicit:false,scene:{publicWitnesses:true,danger:'active'},memoryFacts:[],namesNeeded:[],powerActorSignals:[]});
const blocked=resolveTurn(state,unavailable,'blocked','blocked-seed',{randomEvents:false,randomEventChance:0,proactivity:false,nameStyle:'Balanced Fantasy'});
assert.equal(blocked.rolls.length,0); assert.ok(blocked.refereeNotes.some(n=>n.includes('Unavailable item')));

console.log('Story Engine core tests passed');
