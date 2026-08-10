import type { StoryState, StorySettings, PlayerSheet, NpcTrackerEntry, Rank, CapabilityPool, StatKey } from '../shared/types.js';
import { DEFAULT_SETTINGS, HP_RANGE_BY_RANK, MAX_AUDITS, MAX_COMMAND_AUDITS, MAX_MEMORY_FACTS, MAX_NPCS, MAX_USED_NAMES, STATE_VERSION, RANK_STATS } from './config.js';
import { TurnRng } from './rng.js';

const blankStats = () => ({ PHY: 1, MND: 1, CHA: 1 });

export function createDefaultState(): StoryState {
  return {
    version: STATE_VERSION,
    turn: 0,
    player: null,
    npcs: {},
    health: { user: { maxHp: 10, currentHp: 10, dead: false, nonlethalDefeat: false }, npcs: {} },
    world: { location: '', area: '', indoors: false, dayIndex: 1, time: 'morning', weather: 'clear', facts: [], plans: [] },
    reputation: [],
    progression: { xp: 0, level: 1, milestonesClaimed: 0, pendingMilestones: 0, history: [] },
    economy: { pendingPrice: null, equipmentTiers: [] },
    names: { used: [], style: 'Balanced Fantasy' },
    continuity: {
      latentFavors: [], latentGrievances: [], userKnowledge: [], descriptiveArchive: [],
      boundCompanion: { active:false, name:'', sinceTurn:0, lastMeaningfulTurn:0, notes:[] },
      pendingBoundary: { active:false, boundaryId:'', targetNpc:'', type:'', warnings:0, threshold:1, setTurn:0, lastTurn:0 },
      rapportClocks: {}, worldArcs: [],
    },
    bootstrap: { status:'none', sourceMessageCount:0 },
    commandHistory: [],
    pending: null,
    lastResolution: null,
    audits: [],
    proseReview: null,
    rollback: null,
    updatedAt: Date.now(),
  };
}

export function normalizeSettings(value: unknown): StorySettings {
  const src = object(value);
  return {
    ...DEFAULT_SETTINGS,
    ...src,
    enabled: bool(src.enabled, DEFAULT_SETTINGS.enabled),
    semanticEnabled: bool(src.semanticEnabled, DEFAULT_SETTINGS.semanticEnabled),
    semanticConnectionId: text(src.semanticConnectionId),
    personaConnectionId: text(src.personaConnectionId),
    commandConnectionId: text(src.commandConnectionId),
    bootstrapConnectionId: text(src.bootstrapConnectionId),
    oocCommandsEnabled: bool(src.oocCommandsEnabled, DEFAULT_SETTINGS.oocCommandsEnabled),
    autoBootstrapExistingChat: bool(src.autoBootstrapExistingChat, DEFAULT_SETTINGS.autoBootstrapExistingChat),
    semanticTemperature: clampNum(src.semanticTemperature, 0, 2, DEFAULT_SETTINGS.semanticTemperature),
    recentMessageCount: Math.round(clampNum(src.recentMessageCount, 4, 50, DEFAULT_SETTINGS.recentMessageCount)),
    proseGuardMode: ['off','review','automatic'].includes(String(src.proseGuardMode)) ? src.proseGuardMode as StorySettings['proseGuardMode'] : DEFAULT_SETTINGS.proseGuardMode,
    proseGuardConnectionId: text(src.proseGuardConnectionId),
    proseGuardExtraPhrases: stringList(src.proseGuardExtraPhrases).slice(0, 100),
    randomEvents: bool(src.randomEvents, true),
    randomEventChance: clampNum(src.randomEventChance, 0, 0.5, DEFAULT_SETTINGS.randomEventChance),
    proactivity: bool(src.proactivity, true),
    powerActors: bool(src.powerActors, true),
    progression: bool(src.progression, true),
    trackerPostPass: bool(src.trackerPostPass, true),
    showTrackerWidget: bool(src.showTrackerWidget, true),
    nameStyle: text(src.nameStyle) || DEFAULT_SETTINGS.nameStyle,
    debug: bool(src.debug, false),
  };
}

export function normalizeState(value: unknown): StoryState {
  const base = createDefaultState();
  const src = object(value);
  const player = normalizePlayer(src.player);
  const npcs: Record<string, NpcTrackerEntry> = {};
  const rawNpcs = object(src.npcs);
  for (const [name, raw] of Object.entries(rawNpcs).slice(-MAX_NPCS)) {
    const n = normalizeNpc(name, raw);
    if (n.name) npcs[n.name] = n;
  }
  const healthSrc = object(src.health);
  const userHealth = normalizeHealthActor(object(healthSrc.user), 10);
  const npcHealth: StoryState['health']['npcs'] = {};
  for (const [name, npc] of Object.entries(object(healthSrc.npcs))) {
    const rank = npcs[name]?.rank ?? 'Average';
    const [lo, hi] = HP_RANGE_BY_RANK[rank];
    npcHealth[name] = normalizeHealthActor(object(npc), Math.round((lo + hi) / 2));
  }
  const world = object(src.world);
  const progression = object(src.progression);
  const economy = object(src.economy);
  const names = object(src.names);
  const continuity = object(src.continuity);
  const bootstrap = object(src.bootstrap);
  const boundCompanion=object(continuity.boundCompanion); const pendingBoundary=object(continuity.pendingBoundary);
  return {
    version: STATE_VERSION,
    turn: Math.max(0, Math.floor(num(src.turn, 0))),
    player,
    npcs,
    health: { user: userHealth, npcs: npcHealth },
    world: {
      location: text(world.location), area: text(world.area), indoors: bool(world.indoors, false),
      dayIndex: Math.max(1, Math.floor(num(world.dayIndex, 1))),
      time: ['morning','afternoon','evening','night'].includes(String(world.time)) ? world.time as any : 'morning',
      weather: ['clear','partly_cloudy','cloudy','overcast','light_rain','heavy_rain','storm'].includes(String(world.weather)) ? world.weather as any : 'clear',
      facts: Array.isArray(world.facts) ? world.facts.slice(-MAX_MEMORY_FACTS).filter(Boolean) as any : [],
      plans: Array.isArray(world.plans) ? world.plans.slice(-80).filter(Boolean) as any : [],
    },
    reputation: Array.isArray(src.reputation) ? src.reputation.slice(-80).map(normalizeReputation).filter(Boolean) as any : [],
    progression: {
      xp: Math.max(0, Math.floor(num(progression.xp, 0))),
      level: Math.max(1, Math.floor(num(progression.level, 1))),
      milestonesClaimed: Math.max(0, Math.floor(num(progression.milestonesClaimed, 0))),
      pendingMilestones: Math.max(0, Math.floor(num(progression.pendingMilestones, 0))),
      history: Array.isArray(progression.history) ? progression.history.slice(-48) as any : [],
    },
    economy: {
      pendingPrice: economy.pendingPrice && typeof economy.pendingPrice === 'object' ? economy.pendingPrice as any : null,
      equipmentTiers: Array.isArray(economy.equipmentTiers) ? economy.equipmentTiers.slice(-80) as any : [],
    },
    names: { used: stringList(names.used).slice(-MAX_USED_NAMES), style: text(names.style) || 'Balanced Fantasy' },
    continuity: {
      latentFavors: Array.isArray(continuity.latentFavors) ? continuity.latentFavors.slice(-120) as any : [],
      latentGrievances: Array.isArray(continuity.latentGrievances) ? continuity.latentGrievances.slice(-120) as any : [],
      userKnowledge: Array.isArray(continuity.userKnowledge) ? continuity.userKnowledge.slice(-240) as any : [],
      descriptiveArchive: Array.isArray(continuity.descriptiveArchive) ? continuity.descriptiveArchive.slice(-240) as any : [],
      boundCompanion: { active:bool(boundCompanion.active,false), name:text(boundCompanion.name), sinceTurn:Math.max(0,Math.floor(num(boundCompanion.sinceTurn,0))), lastMeaningfulTurn:Math.max(0,Math.floor(num(boundCompanion.lastMeaningfulTurn,0))), notes:stringList(boundCompanion.notes).slice(-20) },
      pendingBoundary: { active:bool(pendingBoundary.active,false), boundaryId:text(pendingBoundary.boundaryId), targetNpc:text(pendingBoundary.targetNpc), type:text(pendingBoundary.type), warnings:Math.max(0,Math.floor(num(pendingBoundary.warnings,0))), threshold:Math.max(1,Math.min(2,Math.floor(num(pendingBoundary.threshold,1)))), setTurn:Math.max(0,Math.floor(num(pendingBoundary.setTurn,0))), lastTurn:Math.max(0,Math.floor(num(pendingBoundary.lastTurn,0))) },
      rapportClocks: normalizeRapportClocks(continuity.rapportClocks),
      worldArcs: Array.isArray(continuity.worldArcs) ? continuity.worldArcs.slice(-120) as any : [],
    },
    bootstrap: {
      status: ['none','importing','ready','failed'].includes(String(bootstrap.status)) ? bootstrap.status as any : 'none',
      sourceMessageCount: Math.max(0,Math.floor(num(bootstrap.sourceMessageCount,0))),
      importedAt: num(bootstrap.importedAt,0)||undefined,
      lastMessageId: text(bootstrap.lastMessageId)||undefined,
      error: text(bootstrap.error)||undefined,
    },
    commandHistory: Array.isArray(src.commandHistory) ? src.commandHistory.slice(-MAX_COMMAND_AUDITS).filter(Boolean) as any : [],
    pending: src.pending && typeof src.pending === 'object' ? src.pending as any : null,
    lastResolution: src.lastResolution && typeof src.lastResolution === 'object' ? src.lastResolution as any : null,
    audits: Array.isArray(src.audits) ? src.audits.slice(-MAX_AUDITS) as any : [],
    proseReview: src.proseReview && typeof src.proseReview === 'object' ? src.proseReview as any : null,
    rollback: src.rollback && typeof src.rollback === 'object' ? src.rollback as any : null,
    updatedAt: num(src.updatedAt, Date.now()),
  };
}

export function rankFromCapabilityPool(pool: CapabilityPool | undefined, seed: string, name: string, fallback: Rank = 'Average'): Rank {
  if (!pool) return fallback;
  const roll = new TurnRng(`${seed}|capability-pool|${name}|${pool}`).int(1, 100);
  if (pool === 'boss') return 'Boss';
  if (pool === 'elite') return roll <= 20 ? 'Trained' : 'Elite';
  if (pool === 'trained') return roll <= 20 ? 'Average' : roll <= 90 ? 'Trained' : 'Elite';
  return roll <= 15 ? 'Weak' : roll <= 95 ? 'Average' : roll <= 99 ? 'Trained' : 'Elite';
}

export function ensureNpc(state: StoryState, name: string, rank: Rank = 'Average', role = 'NPC', seed = '', mainStat: StatKey | 'Balanced' = 'Balanced'): NpcTrackerEntry {
  const clean = text(name).slice(0, 120);
  if (!clean) throw new Error('NPC name required');
  let npc = state.npcs[clean];
  if (!npc) {
    const rng = new TurnRng(`${seed}|npc|${clean}|${rank}`);
    const { min: lo, max: hi } = RANK_STATS[rank];
    const stats = { PHY: rng.int(lo,hi), MND: rng.int(lo,hi), CHA: rng.int(lo,hi) };
    if (mainStat !== 'Balanced') stats[mainStat] = Math.max(stats[mainStat], hi);
    npc = state.npcs[clean] = {
      name: clean, role, rank, stats, bond: 0, fear: 0, hostility: 0, disposition: 'neutral', status: 'active', companion: false,
      powerActor: false, romanceStage:'none', intimacy:0, boundary:null, notes: [], gear: [], currency: [], relationshipDescriptors: [], introducedTurn: state.turn, lastSeenTurn: state.turn,
      lootSearchCompleted:false,
    };
  }
  npc.lastSeenTurn = state.turn;
  if (role && npc.role === 'NPC') npc.role = role;
  // Rank/stats are persistent identity. A later semantic pass cannot silently re-roll or reclassify an established NPC.
  if (!state.health.npcs[clean]) {
    const [lo, hi] = HP_RANGE_BY_RANK[npc.rank];
    const rng = new TurnRng(`${seed}|hp|${clean}`);
    const maxHp = rng.int(lo, hi);
    state.health.npcs[clean] = { maxHp, currentHp: maxHp, dead: false, nonlethalDefeat: false };
  }
  return npc;
}

export function pruneState(state: StoryState): StoryState {
  state.audits = state.audits.slice(-MAX_AUDITS);
  state.commandHistory = state.commandHistory.slice(-MAX_COMMAND_AUDITS);
  state.world.facts = dedupeFacts(state.world.facts).slice(-MAX_MEMORY_FACTS);
  state.names.used = [...new Set(state.names.used.map(x => x.trim()).filter(Boolean))].slice(-MAX_USED_NAMES);
  state.continuity.latentFavors=state.continuity.latentFavors.slice(-120);
  state.continuity.latentGrievances=state.continuity.latentGrievances.slice(-120);
  state.continuity.userKnowledge=state.continuity.userKnowledge.slice(-240);
  state.continuity.descriptiveArchive=state.continuity.descriptiveArchive.slice(-240);
  state.continuity.worldArcs=state.continuity.worldArcs.slice(-120);
  const entries = Object.values(state.npcs).sort((a,b) => b.lastSeenTurn - a.lastSeenTurn).slice(0, MAX_NPCS);
  state.npcs = Object.fromEntries(entries.map(n => [n.name, n]));
  state.updatedAt = Date.now();
  return state;
}

function normalizePlayer(value: unknown): PlayerSheet | null {
  if (!value || typeof value !== 'object') return null;
  const src = object(value);
  const st = object(src.stats);
  const player: PlayerSheet = {
    name: text(src.name), race: text(src.race), genre: text(src.genre) || 'Fantasy', age: Number.isFinite(Number(src.age)) ? Number(src.age) : undefined,
    appearance: text(src.appearance),
    stats: { PHY: clampInt(st.PHY,1,10,1), MND: clampInt(st.MND,1,10,1), CHA: clampInt(st.CHA,1,10,1) },
    naturalWeapons: stringList(src.naturalWeapons), abilities: stringList(src.abilities), spells: stringList(src.spells), inventory: stringList(src.inventory),
    currency: Array.isArray(src.currency) ? src.currency as any : [], gear: stringList(src.gear), anchors: stringList(src.anchors), concept: text(src.concept), backstory: text(src.backstory),
  };
  return player.name || player.race || player.appearance ? player : null;
}
function normalizeNpc(name: string, value: unknown): NpcTrackerEntry {
  const src = object(value); const stats = object(src.stats);
  const rank = ['Weak','Average','Trained','Elite','Boss'].includes(String(src.rank)) ? src.rank as Rank : 'Average';
  const midpoint=Math.round((RANK_STATS[rank].min+RANK_STATS[rank].max)/2);
  return {
    name: text(src.name) || text(name), role: text(src.role) || 'NPC', rank,
    stats: { PHY: clampInt(stats.PHY,1,14,midpoint), MND: clampInt(stats.MND,1,14,midpoint), CHA: clampInt(stats.CHA,1,14,midpoint) },
    bond: clampInt(src.bond,0,4,0), fear: clampInt(src.fear,0,4,0), hostility: clampInt(src.hostility,0,4,0),
    disposition: text(src.disposition) || 'neutral', status: ['active','inactive','dead'].includes(String(src.status)) ? src.status as any : 'active',
    companion: bool(src.companion,false), powerActor: bool(src.powerActor,false),
    romanceStage: ['none','interest','dating','partner'].includes(String(src.romanceStage)) ? src.romanceStage as any : 'none',
    intimacy: clampInt(src.intimacy,0,4,0), boundary: src.boundary && typeof src.boundary==='object' ? src.boundary as any : null,
    lastSocialTactic: text(src.lastSocialTactic)||undefined, lastSocialGoal: text(src.lastSocialGoal)||undefined,
    notes: stringList(src.notes).slice(-20), gear: stringList(src.gear),
    currency: Array.isArray(src.currency) ? src.currency as any : [], introducedTurn: Math.max(0,Math.floor(num(src.introducedTurn,0))), lastSeenTurn: Math.max(0,Math.floor(num(src.lastSeenTurn,0))),
    lootSearchCompleted: bool(src.lootSearchCompleted,false), personalityArchetype:text(src.personalityArchetype)||undefined, personalitySummary:text(src.personalitySummary)||undefined, relationshipDescriptors:stringList(src.relationshipDescriptors).slice(0,16),
  };
}

function normalizeReputation(value: unknown) {
  const src=object(value); const location=text(src.location); if(!location)return null;
  return { location, fame:clampInt(src.fame,-20,20,0), infamy:clampInt(src.infamy,-20,20,0), fear:clampInt(src.fear,-20,20,0), notes:stringList(src.notes).slice(-20) };
}
function normalizeRapportClocks(value: unknown): StoryState['continuity']['rapportClocks'] {
  const out:StoryState['continuity']['rapportClocks']={};
  for(const [name,raw] of Object.entries(object(value))){ const c=object(raw); out[name]={lastInteractionAt:Math.max(0,num(c.lastInteractionAt,0)),lastMeaningfulAt:Math.max(0,num(c.lastMeaningfulAt,0)),cooldownUntil:Math.max(0,num(c.cooldownUntil,0)),partnerMeaningfulUntil:Math.max(0,num(c.partnerMeaningfulUntil,0))}; }
  return out;
}

function normalizeHealthActor(src: Record<string, any>, fallbackMax: number) {
  const maxHp = Math.max(1, Math.floor(num(src.maxHp, fallbackMax)));
  return { maxHp, currentHp: clampInt(src.currentHp, 0, maxHp, maxHp), dead: bool(src.dead,false), nonlethalDefeat: bool(src.nonlethalDefeat,false), lastDamageAt: num(src.lastDamageAt,0) || undefined };
}
function dedupeFacts(facts: any[]) { const seen = new Set<string>(); return facts.filter(f => { const k = `${f?.scope}|${f?.subject}|${String(f?.fact||'').toLowerCase()}`; if (!f?.fact || seen.has(k)) return false; seen.add(k); return true; }); }
export function object(v: unknown): Record<string, any> { return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string,any> : {}; }
export function text(v: unknown): string { return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); }
export function stringList(v: unknown): string[] { return Array.isArray(v) ? v.map(text).filter(Boolean) : typeof v === 'string' ? v.split(/\r?\n|,/).map(text).filter(Boolean) : []; }
export function num(v: unknown, fallback=0): number { const n=Number(v); return Number.isFinite(n)?n:fallback; }
export function clampNum(v: unknown,min:number,max:number,fallback:number) { return Math.max(min,Math.min(max,num(v,fallback))); }
export function clampInt(v: unknown,min:number,max:number,fallback:number) { return Math.round(clampNum(v,min,max,fallback)); }
export function bool(v: unknown,fallback=false): boolean { if(typeof v==='boolean') return v; if(v==='true'||v==='Y'||v===1) return true; if(v==='false'||v==='N'||v===0) return false; return fallback; }

export function makeCoreSnapshot(state: StoryState): unknown {
  return JSON.parse(JSON.stringify({ turn:state.turn, player:state.player, npcs:state.npcs, health:state.health, world:state.world, reputation:state.reputation, progression:state.progression, economy:state.economy, names:state.names, continuity:state.continuity }));
}

export function restoreCoreSnapshot(state: StoryState, base: unknown): StoryState {
  const b=object(base);
  state.turn=Math.max(0,Math.floor(num(b.turn,state.turn)));
  state.player=b.player as any ?? null; state.npcs=object(b.npcs) as any; state.health=(b.health as any) ?? createDefaultState().health; state.world=(b.world as any) ?? createDefaultState().world; state.reputation=Array.isArray(b.reputation)?b.reputation as any:[]; state.progression=(b.progression as any) ?? createDefaultState().progression; state.economy=(b.economy as any) ?? createDefaultState().economy; state.names=(b.names as any) ?? createDefaultState().names; state.continuity=(b.continuity as any) ?? createDefaultState().continuity;
  return normalizeState({...state, rollback:state.rollback, audits:state.audits, lastResolution:state.lastResolution, pending:state.pending, proseReview:state.proseReview});
}
