import type { MemoryFact, RandomEventResult, SemanticLedger, StoryState, Weather } from '../shared/types.js';
import { MAX_MEMORY_FACTS } from './config.js';
import { TurnRng, hash32 } from './rng.js';

const timeOrder = ['morning','afternoon','evening','night'] as const;
const weatherFlow: Record<Weather, Weather[]> = {
  clear:['clear','clear','partly_cloudy','cloudy'],
  partly_cloudy:['clear','partly_cloudy','cloudy','overcast'],
  cloudy:['partly_cloudy','cloudy','overcast','light_rain'],
  overcast:['cloudy','overcast','light_rain','heavy_rain'],
  light_rain:['overcast','light_rain','heavy_rain','cloudy'],
  heavy_rain:['light_rain','heavy_rain','storm','overcast'],
  storm:['heavy_rain','storm','overcast','cloudy'],
};

export function applyWorldSemantic(state: StoryState, sem: SemanticLedger, seed: string): string[] {
  const notes: string[] = [];
  if (sem.scene.location && sem.scene.location !== state.world.location) {
    state.world.location = sem.scene.location; notes.push(`Location: ${sem.scene.location}`);
  }
  if (sem.scene.area) state.world.area = sem.scene.area;
  if (typeof sem.scene.indoors === 'boolean') state.world.indoors = sem.scene.indoors;
  if (sem.scene.timeAdvance) advanceTime(state, sem.scene.timeAdvance, seed);
  if (sem.scene.weather) state.world.weather = sem.scene.weather;
  for (const fact of sem.memoryFacts) addMemoryFact(state, fact.fact, fact.scope, fact.subject, fact.salience ?? 2);
  activateDuePlans(state);
  return notes;
}

export function advanceTime(state: StoryState, slots: number, seed: string): void {
  const n = Math.max(0, Math.min(12, Math.floor(slots)));
  for (let i=0;i<n;i++) {
    const idx = timeOrder.indexOf(state.world.time);
    const next = (idx + 1) % timeOrder.length;
    if (next === 0) {
      state.world.dayIndex += 1;
      const rng = new TurnRng(`${seed}|weather|day:${state.world.dayIndex}`);
      state.world.weather = rng.pick(weatherFlow[state.world.weather]);
    }
    state.world.time = timeOrder[next]!;
  }
}

export function addMemoryFact(state: StoryState, fact: string, scope: MemoryFact['scope']='world', subject?: string, salience=2): void {
  const clean = fact.replace(/\s+/g,' ').trim().slice(0,600);
  if (!clean) return;
  const key = `${scope}|${subject||''}|${clean.toLowerCase()}`;
  const existing = state.world.facts.find(f => `${f.scope}|${f.subject||''}|${f.fact.toLowerCase()}` === key);
  if (existing) {
    existing.lastConfirmedTurn = state.turn;
    existing.salience = Math.max(existing.salience, Math.max(1,Math.min(5,salience)));
    return;
  }
  state.world.facts.push({ id:`mf_${hash32(`${key}|${state.turn}`).toString(36)}`, fact:clean, scope, subject, salience:Math.max(1,Math.min(5,salience)), createdTurn:state.turn, lastConfirmedTurn:state.turn });
  state.world.facts = state.world.facts.slice(-MAX_MEMORY_FACTS);
}

export function resolveRandomEvent(state: StoryState, sem: SemanticLedger, rng: TurnRng, enabled: boolean, chance: number): RandomEventResult {
  if (!enabled || sem.scene.danger === 'crisis') return { triggered:false, die:0, kind:'none', magnitude:'minor', anchor:'' };
  const roll = rng.d100();
  if (roll > Math.round(chance * 100)) return { triggered:false, die:roll, kind:'none', magnitude:'minor', anchor:'' };
  const chaos = rng.d20();
  const kind: RandomEventResult['kind'] = chaos <= 5 ? 'hostile' : chaos <= 10 ? 'complication' : chaos <= 15 ? 'interruption' : 'beneficial';
  const magnitude: RandomEventResult['magnitude'] = (chaos === 1 || chaos === 20) ? 'major' : (chaos <= 3 || chaos >= 18) ? 'moderate' : 'minor';
  const anchors = [state.world.area, state.world.location, sem.actors[0]?.name, sem.summary].filter(Boolean) as string[];
  return { triggered:true, die:chaos, kind, magnitude, anchor:rng.pick(anchors.length ? anchors : ['current scene']) };
}

export function applyPowerActorSignals(state: StoryState, sem: SemanticLedger): string[] {
  const notes: string[] = [];
  for (const signal of sem.powerActorSignals) {
    const npc = state.npcs[signal.actor];
    if (!npc) continue;
    npc.powerActor = true;
    const marker = `Power signal: ${signal.signal} (${signal.magnitude})`;
    npc.notes = [...npc.notes.filter(x=>!x.startsWith('Power signal:')), marker].slice(-20);
    if (signal.signal === 'grievance' || signal.signal === 'threat') npc.hostility = Math.min(4, npc.hostility + (signal.magnitude >= 3 ? 1 : 0));
    if (signal.signal === 'favor') npc.bond = Math.min(4, npc.bond + (signal.magnitude >= 3 ? 1 : 0));
    const due = state.turn + Math.max(1, 5 - signal.magnitude);
    state.world.plans.push({ id:`plan_${hash32(`${signal.actor}|${signal.signal}|${state.turn}`).toString(36)}`, actor:signal.actor, intent:planIntent(signal.signal), dueTurn:due, status:'pending' });
    notes.push(`${signal.actor} registered ${signal.signal}; strategic consequence due ~turn ${due}.`);
  }
  state.world.plans = state.world.plans.slice(-80);
  return notes;
}

export function activateDuePlans(state: StoryState): void {
  for (const p of state.world.plans) if (p.status === 'pending' && p.dueTurn <= state.turn) p.status = 'due';
}

export function worldSummary(state: StoryState): string {
  const due = state.world.plans.filter(p=>p.status==='due').slice(0,5).map(p=>`${p.actor}: ${p.intent}`);
  const facts = [...state.world.facts].sort((a,b)=>b.salience-a.salience || b.lastConfirmedTurn-a.lastConfirmedTurn).slice(0,10).map(f=>f.fact);
  return [
    `Scene: ${state.world.location || '(unknown)'}${state.world.area ? ` / ${state.world.area}` : ''}; day ${state.world.dayIndex}, ${state.world.time}; weather ${state.world.weather}; ${state.world.indoors?'indoors':'outdoors'}.`,
    facts.length ? `Established facts: ${facts.join(' | ')}` : '',
    due.length ? `Due off-screen plans: ${due.join(' | ')}` : '',
  ].filter(Boolean).join('\n');
}

function planIntent(signal:string){ return ({notice:'observe and assess',favor:'consider repayment or aid',grievance:'prepare retaliation, leverage, or an indirect agent',threat:'counter or contain the threat, including intermediaries or covert agents when appropriate',opportunity:'pursue the opening directly or through agents'} as any)[signal] || 'act on new information'; }
