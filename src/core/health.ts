import type { HealthActor, HealthState, OutcomeTier, StoryState } from '../shared/types.js';
import { DAMAGE_BY_OUTCOME, MAGIC_HEAL_BY_OUTCOME, NATURAL_HEAL_BY_OUTCOME } from './config.js';

export type HealthCondition = 'healthy' | 'bruised' | 'wounded' | 'badly_wounded' | 'critical' | 'incapacitated' | 'dead';

export function conditionFromActor(actor: HealthActor): HealthCondition {
  const max = Math.max(1, actor.maxHp);
  const hp = Math.max(0, Math.min(max, actor.currentHp));
  if (actor.dead) return 'dead';
  if (hp <= 0) return actor.nonlethalDefeat ? 'incapacitated' : 'dead';
  const ratio = hp / max;
  if (ratio >= 1) return 'healthy';
  if (ratio >= 0.76) return 'bruised';
  if (ratio >= 0.51) return 'wounded';
  if (ratio >= 0.26) return 'badly_wounded';
  return 'critical';
}

export function impairmentForCondition(condition: HealthCondition): number {
  return ({ healthy:0, bruised:-1, wounded:-2, badly_wounded:-4, critical:-6, incapacitated:-999, dead:-999 } as const)[condition];
}

export function damageForOutcome(tier: OutcomeTier): number { return DAMAGE_BY_OUTCOME[tier] ?? 0; }
export function healingForOutcome(tier: OutcomeTier, magic: boolean): number {
  return (magic ? MAGIC_HEAL_BY_OUTCOME : NATURAL_HEAL_BY_OUTCOME)[tier] ?? 0;
}
export function safeSceneHealing(magic:boolean):number { return magic ? 9 : 3; }

export function healingDcForCondition(condition:HealthCondition):number {
  return ({healthy:13,bruised:13,wounded:16,badly_wounded:19,critical:19,incapacitated:19,dead:19} as const)[condition];
}

export function healingDcForActor(actor:HealthActor):number { return healingDcForCondition(conditionFromActor(actor)); }

export function applyDamage(actor: HealthActor, amount: number, nonlethal = false, fatal = false): void {
  if (actor.dead) return;
  const dmg = Math.max(0, Math.floor(amount));
  actor.currentHp = fatal ? 0 : Math.max(0, actor.currentHp - dmg);
  actor.lastDamageAt = Date.now();
  actor.lastDamageStateKey = `damage:${actor.lastDamageAt}:${actor.currentHp}/${actor.maxHp}`;
  actor.naturalTreatmentKey = '';
  if (fatal || (actor.currentHp <= 0 && !nonlethal)) {
    actor.dead = true;
    actor.nonlethalDefeat = false;
  } else if (actor.currentHp <= 0 && nonlethal) {
    actor.dead = false;
    actor.nonlethalDefeat = true;
  }
}

export function applyHeal(actor: HealthActor, amount: number, naturalTreatment=false): boolean {
  if (actor.dead) return false;
  const heal=Math.max(0,Math.floor(amount)); if(!heal)return false;
  if(naturalTreatment){
    const damageKey=actor.lastDamageStateKey||`state:${actor.currentHp}/${actor.maxHp}`;
    if(actor.naturalTreatmentKey===damageKey)return false;
    actor.naturalTreatmentKey=damageKey;actor.naturalTreatmentAt=Date.now();
  }
  const before=actor.currentHp;
  actor.currentHp = Math.min(actor.maxHp, actor.currentHp + heal);
  if (actor.currentHp > 0) actor.nonlethalDefeat = false;
  if(actor.currentHp>=actor.maxHp)actor.naturalTreatmentKey='';
  return actor.currentHp!==before;
}

export function getActorHealth(state: StoryState, targetType: 'user' | 'npc', target = ''): HealthActor | null {
  if (targetType === 'user') return state.health.user;
  return state.health.npcs[target] ?? null;
}

export function applyHealthEvents(state: StoryState, events: Array<{ targetType:'user'|'npc'; target:string; kind:'damage'|'heal'; amount:number; nonlethal?:boolean; fatal?:boolean; naturalTreatment?:boolean }>): void {
  for (const event of events) {
    const actor = getActorHealth(state, event.targetType, event.target);
    if (!actor) continue;
    if (event.kind === 'damage') applyDamage(actor, event.amount, event.nonlethal, event.fatal);
    else applyHeal(actor, event.amount, event.naturalTreatment===true);
    if (event.targetType === 'npc' && state.npcs[event.target]) {
      const c = conditionFromActor(actor);
      if (c === 'dead') state.npcs[event.target]!.status = 'dead';
      state.npcs[event.target]!.notes = updateConditionNote(state.npcs[event.target]!.notes, c);
    }
  }
}

export function applyNaturalRecovery(state:StoryState,days:number):void{
  const amount=Math.max(0,Math.floor(days))*2;
  if(!amount)return;
  applyHeal(state.health.user,amount);
  for(const npc of Object.values(state.npcs)) if(npc.companion && npc.status!=='dead' && state.health.npcs[npc.name]) applyHeal(state.health.npcs[npc.name]!,amount);
}

export function increaseMilestoneHealth(state: StoryState, companionNames: string[] = []): void {
  state.health.user.maxHp += 1;
  state.health.user.currentHp = Math.min(state.health.user.maxHp, state.health.user.currentHp + 1);
  for (const name of companionNames) {
    const actor = state.health.npcs[name];
    if (!actor || actor.dead) continue;
    actor.maxHp += 1;
    actor.currentHp = Math.min(actor.maxHp, actor.currentHp + 1);
  }
}

export function healthSnapshot(health: HealthState): any {
  return {
    user: { ...health.user, condition: conditionFromActor(health.user) },
    npcs: Object.fromEntries(Object.entries(health.npcs).map(([name, actor]) => [name, { ...actor, condition: conditionFromActor(actor) }])),
  };
}

function updateConditionNote(notes: string[], condition: HealthCondition): string[] {
  const filtered = notes.filter(n => !n.startsWith('Condition:'));
  return [...filtered, `Condition: ${condition}`].slice(-20);
}
