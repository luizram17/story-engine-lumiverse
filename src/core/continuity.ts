import type { SemanticLedger, StoryState } from '../shared/types.js';
import { hash32 } from './rng.js';

const RAPPORT_ACTIVE_IDLE_LIMIT_MS = 10 * 60 * 1000;
const RAPPORT_COOLDOWN_MS = 30 * 60 * 1000;
const PARTNER_MEANINGFUL_COOLDOWN_MS = 60 * 60 * 1000;

/** Persist the less-visible continuity ledgers that the upstream Story Engine keeps beside its NPC tracker. */
export function applyContinuitySemantic(state: StoryState, sem: SemanticLedger): string[] {
  const notes: string[] = [];
  const now = Date.now();

  for (const actor of sem.actors) {
    if (!actor.name) continue;
    const key = actor.name;
    const clock = state.continuity.rapportClocks[key] ?? { lastInteractionAt: 0, lastMeaningfulAt: 0, cooldownUntil: 0, partnerMeaningfulUntil: 0 };
    const meaningful = actor.relation === 'benefited' || actor.relation === 'harmed' || actor.relation === 'opposed' || sem.actions.some(a => a.target.toLowerCase() === key.toLowerCase());
    const wasActive = clock.lastInteractionAt > 0 && now - clock.lastInteractionAt <= RAPPORT_ACTIVE_IDLE_LIMIT_MS;
    clock.lastInteractionAt = now;
    if (meaningful && (!wasActive || now >= clock.cooldownUntil)) {
      clock.lastMeaningfulAt = now;
      clock.cooldownUntil = now + RAPPORT_COOLDOWN_MS;
      if (state.npcs[key]?.romanceStage === 'partner' && now >= clock.partnerMeaningfulUntil) clock.partnerMeaningfulUntil = now + PARTNER_MEANINGFUL_COOLDOWN_MS;
    }
    state.continuity.rapportClocks[key] = clock;
  }

  for (const signal of sem.powerActorSignals) {
    if (signal.signal !== 'favor' && signal.signal !== 'grievance' && signal.signal !== 'threat') continue;
    const kind = signal.signal === 'favor' ? 'favor' : 'grievance';
    const list = kind === 'favor' ? state.continuity.latentFavors : state.continuity.latentGrievances;
    const id = `lt_${hash32(`${kind}|${signal.actor}|${signal.magnitude}|${state.turn}`).toString(36)}`;
    if (!list.some(x => x.id === id)) {
      list.push({ id, actor: signal.actor, kind, magnitude: signal.magnitude, reason: `${signal.signal} registered from scene consequences`, createdTurn: state.turn, status: 'active' });
      notes.push(`Latent ${kind} recorded for ${signal.actor}.`);
    }
    upsertWorldArc(state, signal.actor, signal.signal === 'favor' ? 'repay or act on the favor' : signal.signal === 'threat' ? 'contain the perceived threat' : 'act on the grievance', signal.magnitude);
  }

  updatePendingBoundary(state, sem, notes);
  refreshBoundCompanion(state);
  return notes;
}

export function boundaryGate(state: StoryState, sem: SemanticLedger): { mode: 'none'|'grace'|'force'; target: string; type: string; threshold: number; warnings: number } {
  const pending = state.continuity.pendingBoundary;
  const br = sem.boundaryBreak;
  if (br?.present) {
    const valid = pending.active && br.boundaryId === pending.boundaryId && br.target.toLowerCase() === pending.targetNpc.toLowerCase() && normalizeKind(br.kind) === normalizeKind(pending.type);
    if (!valid) return { mode:'none', target:'', type:'', threshold:1, warnings:0 };
    return pending.warnings >= pending.threshold
      ? { mode:'force', target:pending.targetNpc, type:pending.type, threshold:pending.threshold, warnings:pending.warnings }
      : { mode:'grace', target:pending.targetNpc, type:pending.type, threshold:pending.threshold, warnings:pending.warnings };
  }

  const restraint = sem.restraintControl;
  const pressure = restraint?.present ? { present:true, target:restraint.target, kind:'restraint' } : sem.boundaryPressure;
  if (!pressure?.present || !pressure.target) return { mode:'none', target:'', type:'', threshold:1, warnings:0 };
  const npc = state.npcs[pressure.target];
  const crisis = sem.scene.danger === 'crisis' || sem.activeHostileThreat === true || (npc ? npc.fear >= 3 || npc.hostility >= 3 : false);
  const immediateOpposition = !npc || npc.bond <= 1 || crisis || sem.actors.some(a => a.name.toLowerCase() === pressure.target.toLowerCase() && (a.relation === 'opposed' || a.relation === 'harmed'));
  if (immediateOpposition) return { mode:'force', target:pressure.target, type:pressure.kind || 'personal boundary', threshold:1, warnings:0 };

  const threshold = npc.bond >= 4 ? 2 : 1;
  const same = pending.active && pending.targetNpc.toLowerCase() === pressure.target.toLowerCase() && normalizeKind(pending.type) === normalizeKind(pressure.kind);
  const warnings = same ? pending.warnings : 0;
  return warnings >= threshold ? { mode:'force', target:pressure.target, type:pressure.kind, threshold, warnings } : { mode:'grace', target:pressure.target, type:pressure.kind, threshold, warnings };
}

export function upsertKnowledge(state: StoryState, input: any): void {
  const subject = clean(input?.subject, 120); const fact = clean(input?.fact, 600); if (!fact) return;
  const scope = ['private','local','route','faction','regional','legendary'].includes(String(input?.scope)) ? input.scope : 'local';
  const truth = ['true','distorted','false','claimed'].includes(String(input?.truth)) ? input.truth : 'claimed';
  const confidence = ['certain','likely','uncertain'].includes(String(input?.confidence)) ? input.confidence : 'uncertain';
  const key = `${subject.toLowerCase()}|${fact.toLowerCase()}`;
  const existing = state.continuity.userKnowledge.find(x => `${x.subject.toLowerCase()}|${x.fact.toLowerCase()}` === key);
  if (existing) { existing.scope=scope; existing.truth=truth; existing.confidence=confidence; existing.lastConfirmedTurn=state.turn; if(input?.source)existing.source=clean(input.source,160); return; }
  state.continuity.userKnowledge.push({ id:`uk_${hash32(`${key}|${state.turn}`).toString(36)}`, subject, fact, scope, truth, confidence, source:clean(input?.source,160)||undefined, learnedTurn:state.turn, lastConfirmedTurn:state.turn });
}

export function archiveDescription(state: StoryState, input: any): void {
  const label=clean(input?.label,160); const description=clean(input?.description,700); if(!label||!description)return;
  const kind=['npc','place','organization','object','other'].includes(String(input?.kind))?input.kind:'other';
  const key=`${kind}|${label.toLowerCase()}`;
  const existing=state.continuity.descriptiveArchive.find(x=>`${x.kind}|${x.label.toLowerCase()}`===key);
  if(existing){existing.description=description;existing.lastSeenTurn=state.turn;if(input?.promotedName)existing.promotedName=clean(input.promotedName,120);return;}
  state.continuity.descriptiveArchive.push({id:`da_${hash32(`${key}|${state.turn}`).toString(36)}`,label,kind,description,promotedName:clean(input?.promotedName,120)||undefined,firstSeenTurn:state.turn,lastSeenTurn:state.turn});
}

export function consumeThreadsForActor(state: StoryState, actor: string): void {
  for(const list of [state.continuity.latentFavors,state.continuity.latentGrievances]) for(const t of list) if(t.actor.toLowerCase()===actor.toLowerCase()&&t.status==='active')t.status='consumed';
}

export function resolveBoundary(state: StoryState, boundaryId?: string): void {
  const p=state.continuity.pendingBoundary;if(!p.active)return;if(boundaryId&&p.boundaryId!==boundaryId)return;
  p.active=false;
}

export function continuitySummary(state: StoryState): string {
  const favors=state.continuity.latentFavors.filter(x=>x.status==='active').slice(-5).map(x=>`${x.actor}(${x.magnitude})`).join(', ');
  const grievances=state.continuity.latentGrievances.filter(x=>x.status==='active').slice(-5).map(x=>`${x.actor}(${x.magnitude})`).join(', ');
  const knowledge=state.continuity.userKnowledge.slice(-8).map(x=>`${x.subject||'world'}: ${x.fact} [${x.scope}/${x.truth}/${x.confidence}]`).join(' | ');
  const bound=state.continuity.boundCompanion.active?state.continuity.boundCompanion.name:'none';
  const boundary=state.continuity.pendingBoundary.active?`${state.continuity.pendingBoundary.targetNpc}: ${state.continuity.pendingBoundary.type} (${state.continuity.pendingBoundary.warnings}/${state.continuity.pendingBoundary.threshold} warnings)`:'none';
  return [`Bound companion: ${bound}.`,`Pending boundary: ${boundary}.`,favors?`Latent favors: ${favors}.`:'',grievances?`Latent grievances: ${grievances}.`:'',knowledge?`User knowledge ledger: ${knowledge}`:''].filter(Boolean).join('\n');
}

function updatePendingBoundary(state: StoryState, sem: SemanticLedger, notes: string[]): void {
  const br=sem.boundaryBreak;
  if(br?.present){
    const current=state.continuity.pendingBoundary;
    const valid=current.active&&br.boundaryId===current.boundaryId&&br.target.toLowerCase()===current.targetNpc.toLowerCase()&&normalizeKind(br.kind)===normalizeKind(current.type);
    if(!valid){notes.push('Rejected boundaryBreak: it did not match the active pending boundary id/target/type.');return;}
    current.warnings+=1; current.lastTurn=state.turn;
    notes.push(`Pending boundary ${current.boundaryId} continued (${current.warnings}/${current.threshold}).`);
    return;
  }
  const restraint=sem.restraintControl;
  const p=restraint?.present?{present:true,target:restraint.target,kind:'restraint'}:sem.boundaryPressure;
  if(!p?.present||!p.target)return;
  const gate=boundaryGate(state,sem); const current=state.continuity.pendingBoundary;
  const same=current.active&&current.targetNpc.toLowerCase()===p.target.toLowerCase()&&normalizeKind(current.type)===normalizeKind(p.kind);
  const id=same?current.boundaryId:`bd_${hash32(`${p.target}|${normalizeKind(p.kind)}|${state.turn}`).toString(36)}`;
  state.continuity.pendingBoundary={active:true,boundaryId:id,targetNpc:p.target,type:p.kind||'personal boundary',warnings:(same?current.warnings:0)+1,threshold:gate.threshold,setTurn:same?current.setTurn:state.turn,lastTurn:state.turn};
  notes.push(`Pending boundary ${id} stored for ${p.target} (${state.continuity.pendingBoundary.warnings}/${gate.threshold}).`);
}

function refreshBoundCompanion(state: StoryState): void {
  const candidates=Object.values(state.npcs).filter(n=>n.companion&&n.status==='active').sort((a,b)=>b.bond-a.bond||b.lastSeenTurn-a.lastSeenTurn);
  const best=candidates[0]; const bound=state.continuity.boundCompanion;
  if(!best){bound.active=false;bound.name='';return;}
  if(!bound.active||bound.name!==best.name){state.continuity.boundCompanion={active:true,name:best.name,sinceTurn:state.turn,lastMeaningfulTurn:state.turn,notes:[]};}
  else if(best.bond>=3||best.romanceStage!=='none') bound.lastMeaningfulTurn=state.turn;
}

function upsertWorldArc(state: StoryState, actor: string, goal: string, magnitude: number): void {
  let arc=state.continuity.worldArcs.find(x=>x.actor.toLowerCase()===actor.toLowerCase()&&x.status==='active');
  if(!arc){arc={id:`arc_${hash32(`${actor}|${goal}|${state.turn}`).toString(36)}`,actor,goal,stage:1,pressure:magnitude,lastAdvancedTurn:state.turn,status:'active'};state.continuity.worldArcs.push(arc);return;}
  arc.goal=goal;arc.stage=Math.min(5,arc.stage+1);arc.pressure=Math.min(5,Math.max(arc.pressure,magnitude));arc.lastAdvancedTurn=state.turn;
}
function normalizeKind(v:string){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_');}
function clean(v:any,max:number){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max);}
