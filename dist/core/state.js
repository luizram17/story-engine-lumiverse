import { DEFAULT_SETTINGS, HP_RANGE_BY_RANK, MAX_AUDITS, MAX_COMMAND_AUDITS, MAX_MEMORY_FACTS, MAX_NPCS, MAX_USED_NAMES, STATE_VERSION, RANK_STATS } from './config.js';
import { TurnRng } from './rng.js';
const blankStats = () => ({ PHY: 1, MND: 1, CHA: 1 });
const blankSlowBondCounts = () => ({
    respectfulContact: 0, cooperation: 0, comfortInProximity: 0, boundaryRespect: 0,
    sharedRoutine: 0, playfulness: 0, teamwork: 0, personalAttention: 0,
});
const GENERIC_PERSONALITY_SEEDS = [
    'temperament: guarded and practical; speech: concise and skeptical; interaction: tests claims before trusting; intensity:medium',
    'temperament: formal and dutiful; speech: precise and rule-minded; interaction: values procedure and responsibility; intensity:medium',
    'temperament: warm and direct; speech: plain reassurance; interaction: offers practical help while expecting honesty; intensity:medium',
    'temperament: dry and observant; speech: understated and ironic; interaction: watches before committing; intensity:medium',
    'temperament: cautious and conflict-averse; speech: qualified and careful; interaction: seeks safety before commitment; intensity:medium',
    'temperament: proud and status-conscious; speech: polished and corrective; interaction: protects reputation and expects respect; intensity:medium',
    'temperament: playful and socially bold; speech: quick banter; interaction: tests reactions through humor; intensity:medium',
    'temperament: patient and analytical; speech: measured explanations; interaction: asks questions before acting; intensity:medium',
    'temperament: ambitious and calculating; speech: controlled compliments and strategic questions; interaction: weighs leverage and future value; intensity:medium',
    'temperament: gentle and reserved; speech: careful and indirect; interaction: avoids pressure and helps through small acts; intensity:medium',
    'temperament: blunt and action-first; speech: plain challenges; interaction: trusts visible competence over promises; intensity:medium',
    'temperament: secretive and careful; speech: partial answers and controlled omissions; interaction: protects information and redirects scrutiny; intensity:medium',
];
export function createDefaultState() {
    return {
        version: STATE_VERSION,
        turn: 0,
        player: null,
        npcs: {},
        health: { user: { maxHp: 10, currentHp: 10, dead: false, nonlethalDefeat: false }, npcs: {} },
        world: { reputationLocation: '', location: '', area: '', indoors: false, positionEstablished: false, dayIndex: 1, time: 'morning', timeEstablished: false, weather: 'clear', weatherRemainingSlots: 2, weatherEstablished: false, presentNpcs: [], facts: [], plans: [] },
        reputation: [],
        progression: { xp: 0, level: 1, milestonesClaimed: 0, pendingMilestones: 0, history: [] },
        economy: { pendingPrice: null, equipmentTiers: [] },
        names: { used: [], style: 'Balanced Fantasy' },
        continuity: {
            latentFavors: [], latentGrievances: [], userKnowledge: [], descriptiveArchive: [],
            boundCompanion: { active: false, name: '', sinceTurn: 0, lastMeaningfulTurn: 0, notes: [] },
            pendingBoundary: { active: false, boundaryId: '', targetNpc: '', type: '', warnings: 0, threshold: 1, setTurn: 0, lastTurn: 0 },
            rapportClocks: {}, worldArcs: [],
        },
        bootstrap: { status: 'none', sourceMessageCount: 0 },
        commandHistory: [],
        pending: null,
        lastResolution: null,
        audits: [],
        proseReview: null,
        rollback: null,
        updatedAt: Date.now(),
    };
}
export function normalizeSettings(value) {
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
        proseGuardMode: ['off', 'review', 'automatic'].includes(String(src.proseGuardMode)) ? src.proseGuardMode : DEFAULT_SETTINGS.proseGuardMode,
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
export function normalizeState(value) {
    const base = createDefaultState();
    const src = object(value);
    const player = normalizePlayer(src.player);
    const npcs = {};
    const rawNpcs = object(src.npcs);
    for (const [name, raw] of Object.entries(rawNpcs).slice(-MAX_NPCS)) {
        const n = normalizeNpc(name, raw);
        if (n.name)
            npcs[n.name] = n;
    }
    const healthSrc = object(src.health);
    const userHealth = normalizeHealthActor(object(healthSrc.user), 10);
    const npcHealth = {};
    for (const [name, npc] of Object.entries(object(healthSrc.npcs))) {
        const rank = npcs[name]?.rank ?? 'Average';
        const [lo, hi] = HP_RANGE_BY_RANK[rank];
        npcHealth[name] = normalizeHealthActor(object(npc), Math.round((lo + hi) / 2));
    }
    for (const [name, npc] of Object.entries(npcs)) {
        if (!npcHealth[name]) {
            const [lo, hi] = HP_RANGE_BY_RANK[npc.rank];
            const maxHp = Math.round((lo + hi) / 2);
            npcHealth[name] = { maxHp, currentHp: maxHp, dead: npc.status === 'dead', nonlethalDefeat: false };
        }
        if (npc.companion && npcHealth[name].maxHp < 10) {
            const actor = npcHealth[name];
            const delta = 10 - actor.maxHp;
            actor.maxHp = 10;
            actor.currentHp = Math.min(actor.maxHp, actor.currentHp + delta);
        }
    }
    const world = object(src.world);
    const normalizedTurn = Math.max(0, Math.floor(num(src.turn, 0)));
    const legacyPresence = !Array.isArray(world.presentNpcs) && normalizedTurn > 0
        ? Object.values(npcs).filter(n => n.status === 'active' && n.lastSeenTurn === normalizedTurn).map(n => n.name)
        : [];
    const progression = object(src.progression);
    const economy = object(src.economy);
    const names = object(src.names);
    const continuity = object(src.continuity);
    const bootstrap = object(src.bootstrap);
    const boundCompanion = object(continuity.boundCompanion);
    const pendingBoundary = object(continuity.pendingBoundary);
    return {
        version: STATE_VERSION,
        turn: normalizedTurn,
        player,
        npcs,
        health: { user: userHealth, npcs: npcHealth },
        world: (() => {
            const location = text(world.location);
            const area = text(world.area);
            const indoors = bool(world.indoors, false);
            const dayIndex = Math.max(1, Math.floor(num(world.dayIndex, 1)));
            const time = ['morning', 'afternoon', 'evening', 'night'].includes(String(world.time)) ? world.time : 'morning';
            const weatherValue = ['clear', 'partly_cloudy', 'cloudy', 'overcast', 'light_rain', 'heavy_rain', 'storm'].includes(String(world.weather)) ? world.weather : 'clear';
            const positionEstablished = typeof world.positionEstablished === 'boolean' ? world.positionEstablished : Boolean(location || area || indoors);
            const timeEstablished = typeof world.timeEstablished === 'boolean' ? world.timeEstablished : Boolean(dayIndex !== 1 || time !== 'morning');
            const weatherRemainingSlots = clampInt(world.weatherRemainingSlots, 0, 8, 2);
            const weatherEstablished = typeof world.weatherEstablished === 'boolean' ? world.weatherEstablished : Boolean(weatherValue !== 'clear' || weatherRemainingSlots !== 2);
            return { reputationLocation: text(world.reputationLocation) || location, location, area, indoors, positionEstablished, dayIndex, time, timeEstablished, weather: weatherValue, weatherRemainingSlots, weatherEstablished, presentNpcs: [...new Set((Array.isArray(world.presentNpcs) ? stringList(world.presentNpcs) : legacyPresence).map(x => x.slice(0, 120)))].slice(0, 40), facts: Array.isArray(world.facts) ? world.facts.slice(-MAX_MEMORY_FACTS).filter(Boolean) : [], plans: normalizeWorldPlans(world.plans) };
        })(),
        reputation: Array.isArray(src.reputation) ? src.reputation.slice(-80).map(normalizeReputation).filter(Boolean) : [],
        progression: {
            xp: Math.max(0, Math.floor(num(progression.xp, 0))),
            level: Math.max(1, Math.floor(num(progression.level, 1))),
            milestonesClaimed: Math.max(0, Math.floor(num(progression.milestonesClaimed, 0))),
            pendingMilestones: Math.max(0, Math.floor(num(progression.pendingMilestones, 0))),
            history: Array.isArray(progression.history) ? progression.history.slice(-48) : [],
        },
        economy: {
            pendingPrice: economy.pendingPrice && typeof economy.pendingPrice === 'object' ? economy.pendingPrice : null,
            equipmentTiers: Array.isArray(economy.equipmentTiers) ? economy.equipmentTiers.slice(-80) : [],
        },
        names: { used: stringList(names.used).slice(-MAX_USED_NAMES), style: text(names.style) || 'Balanced Fantasy' },
        continuity: {
            latentFavors: Array.isArray(continuity.latentFavors) ? continuity.latentFavors.slice(-120) : [],
            latentGrievances: Array.isArray(continuity.latentGrievances) ? continuity.latentGrievances.slice(-120) : [],
            userKnowledge: Array.isArray(continuity.userKnowledge) ? continuity.userKnowledge.slice(-240) : [],
            descriptiveArchive: normalizeDescriptiveArchive(continuity.descriptiveArchive),
            boundCompanion: { active: bool(boundCompanion.active, false), name: text(boundCompanion.name), sinceTurn: Math.max(0, Math.floor(num(boundCompanion.sinceTurn, 0))), lastMeaningfulTurn: Math.max(0, Math.floor(num(boundCompanion.lastMeaningfulTurn, 0))), notes: stringList(boundCompanion.notes).slice(-20) },
            pendingBoundary: { active: bool(pendingBoundary.active, false), boundaryId: text(pendingBoundary.boundaryId), targetNpc: text(pendingBoundary.targetNpc), type: text(pendingBoundary.type), warnings: Math.max(0, Math.floor(num(pendingBoundary.warnings, 0))), threshold: Math.max(1, Math.min(2, Math.floor(num(pendingBoundary.threshold, 1)))), setTurn: Math.max(0, Math.floor(num(pendingBoundary.setTurn, 0))), lastTurn: Math.max(0, Math.floor(num(pendingBoundary.lastTurn, 0))) },
            rapportClocks: normalizeRapportClocks(continuity.rapportClocks),
            worldArcs: Array.isArray(continuity.worldArcs) ? continuity.worldArcs.slice(-120) : [],
        },
        bootstrap: {
            status: ['none', 'importing', 'ready', 'failed'].includes(String(bootstrap.status)) ? bootstrap.status : 'none',
            sourceMessageCount: Math.max(0, Math.floor(num(bootstrap.sourceMessageCount, 0))),
            importedAt: num(bootstrap.importedAt, 0) || undefined,
            lastMessageId: text(bootstrap.lastMessageId) || undefined,
            error: text(bootstrap.error) || undefined,
        },
        commandHistory: Array.isArray(src.commandHistory) ? src.commandHistory.slice(-MAX_COMMAND_AUDITS).filter(Boolean) : [],
        pending: src.pending && typeof src.pending === 'object' ? src.pending : null,
        lastResolution: src.lastResolution && typeof src.lastResolution === 'object' ? src.lastResolution : null,
        audits: Array.isArray(src.audits) ? src.audits.slice(-MAX_AUDITS) : [],
        proseReview: src.proseReview && typeof src.proseReview === 'object' ? src.proseReview : null,
        rollback: src.rollback && typeof src.rollback === 'object' ? src.rollback : null,
        updatedAt: num(src.updatedAt, Date.now()),
    };
}
export function rankFromCapabilityPool(pool, seed, name, fallback = 'Average') {
    if (!pool)
        return fallback;
    const roll = new TurnRng(`${seed}|capability-pool|${name}|${pool}`).int(1, 100);
    if (pool === 'boss')
        return 'Boss';
    if (pool === 'elite')
        return roll <= 20 ? 'Trained' : 'Elite';
    if (pool === 'trained')
        return roll <= 20 ? 'Average' : roll <= 90 ? 'Trained' : 'Elite';
    return roll <= 15 ? 'Weak' : roll <= 95 ? 'Average' : roll <= 99 ? 'Trained' : 'Elite';
}
export function ensureNpc(state, name, rank = 'Average', role = 'NPC', seed = '', mainStat = 'Balanced') {
    const clean = text(name).slice(0, 120);
    if (!clean)
        throw new Error('NPC name required');
    let npc = state.npcs[clean];
    if (!npc) {
        const rng = new TurnRng(`${seed}|npc|${clean}|${rank}`);
        const { min: lo, max: hi } = RANK_STATS[rank];
        const stats = { PHY: rng.int(lo, hi), MND: rng.int(lo, hi), CHA: rng.int(lo, hi) };
        if (mainStat !== 'Balanced')
            stats[mainStat] = Math.max(stats[mainStat], hi);
        npc = state.npcs[clean] = {
            name: clean, role, rank, stats, bond: 0, fear: 0, hostility: 0, disposition: 'neutral', status: 'active', companion: false,
            powerActor: false, romanceStage: 'none', intimacy: 0, boundary: null, notes: [], aliases: [], gear: [], inventory: [], currency: [], wounds: [], conditions: [], relationshipDescriptors: [], introducedTurn: state.turn, lastSeenTurn: state.turn,
            romanceStyle: 'auto', standingInfluence: 'none', slowBondEvidence: { counts: blankSlowBondCounts(), blockers: [], lastUpdatedTurn: 0 },
            lootSearchCompleted: false,
        };
        const profileRng = new TurnRng(`${seed}|personality|${clean}`);
        npc.personalitySummary = GENERIC_PERSONALITY_SEEDS[profileRng.int(0, GENERIC_PERSONALITY_SEEDS.length - 1)];
    }
    npc.lastSeenTurn = state.turn;
    if (role && npc.role === 'NPC')
        npc.role = role;
    // Rank/stats are persistent identity. A later semantic pass cannot silently re-roll or reclassify an established NPC.
    if (!state.health.npcs[clean]) {
        const [lo, hi] = HP_RANGE_BY_RANK[npc.rank];
        const rng = new TurnRng(`${seed}|hp|${clean}`);
        const maxHp = rng.int(lo, hi);
        state.health.npcs[clean] = { maxHp, currentHp: maxHp, dead: false, nonlethalDefeat: false };
    }
    return npc;
}
export function pruneState(state) {
    state.audits = state.audits.slice(-MAX_AUDITS);
    state.commandHistory = state.commandHistory.slice(-MAX_COMMAND_AUDITS);
    state.world.presentNpcs = [...new Set(stringList(state.world.presentNpcs).map(x => x.slice(0, 120)))].slice(0, 40);
    state.world.facts = dedupeFacts(state.world.facts).slice(-MAX_MEMORY_FACTS);
    state.names.used = [...new Set(state.names.used.map(x => x.trim()).filter(Boolean))].slice(-MAX_USED_NAMES);
    state.continuity.latentFavors = state.continuity.latentFavors.slice(-120);
    state.continuity.latentGrievances = state.continuity.latentGrievances.slice(-120);
    state.continuity.userKnowledge = state.continuity.userKnowledge.slice(-240);
    state.continuity.descriptiveArchive = state.continuity.descriptiveArchive.slice(-240);
    state.continuity.worldArcs = state.continuity.worldArcs.slice(-120);
    const entries = Object.values(state.npcs).sort((a, b) => b.lastSeenTurn - a.lastSeenTurn).slice(0, MAX_NPCS);
    state.npcs = Object.fromEntries(entries.map(n => [n.name, n]));
    state.updatedAt = Date.now();
    return state;
}
function normalizePlayer(value) {
    if (!value || typeof value !== 'object')
        return null;
    const src = object(value);
    const st = object(src.stats);
    const player = {
        name: text(src.name), race: text(src.race), genre: text(src.genre) || 'Fantasy', age: Number.isFinite(Number(src.age)) ? Number(src.age) : undefined,
        gender: text(src.gender) || undefined, userNonHuman: typeof src.userNonHuman === 'boolean' ? src.userNonHuman : undefined, bloodline: text(src.bloodline) || undefined, origin: text(src.origin) || undefined, priorRoleOrTraining: text(src.priorRoleOrTraining) || undefined,
        appearance: text(src.appearance),
        stats: { PHY: clampInt(st.PHY, 1, 10, 1), MND: clampInt(st.MND, 1, 10, 1), CHA: clampInt(st.CHA, 1, 10, 1) },
        naturalWeapons: stringList(src.naturalWeapons), abilities: stringList(src.abilities), spells: stringList(src.spells), inventory: stringList(src.inventory),
        currency: normalizeCurrencyEntries(src.currency), gear: stringList(src.gear), anchors: stringList(src.anchors), concept: text(src.concept), backstory: text(src.backstory),
        wounds: stringList(src.wounds).slice(-30), conditions: stringList(src.conditions).slice(-30), tasks: stringList(src.tasks).slice(-40), commitments: stringList(src.commitments).slice(-40),
    };
    return player.name || player.race || player.appearance ? player : null;
}
function normalizeNpc(name, value) {
    const src = object(value);
    const stats = object(src.stats);
    const rank = ['Weak', 'Average', 'Trained', 'Elite', 'Boss'].includes(String(src.rank)) ? src.rank : 'Average';
    const midpoint = Math.round((RANK_STATS[rank].min + RANK_STATS[rank].max) / 2);
    return {
        name: text(src.name) || text(name), role: text(src.role) || 'NPC', rank,
        stats: { PHY: clampInt(stats.PHY, 1, 14, midpoint), MND: clampInt(stats.MND, 1, 14, midpoint), CHA: clampInt(stats.CHA, 1, 14, midpoint) },
        bond: clampInt(src.bond, 0, 4, 0), fear: clampInt(src.fear, 0, 4, 0), hostility: clampInt(src.hostility, 0, 4, 0),
        disposition: text(src.disposition) || 'neutral', status: ['active', 'inactive', 'dead'].includes(String(src.status)) ? src.status : 'active',
        companion: bool(src.companion, false), powerActor: bool(src.powerActor, false),
        romanceStage: ['none', 'interest', 'dating', 'partner'].includes(String(src.romanceStage)) ? src.romanceStage : 'none',
        intimacy: clampInt(src.intimacy, 0, 4, 0), boundary: src.boundary && typeof src.boundary === 'object' ? src.boundary : null,
        lastSocialTactic: text(src.lastSocialTactic) || undefined, lastSocialGoal: text(src.lastSocialGoal) || undefined,
        notes: stringList(src.notes).slice(-20), aliases: stringList(src.aliases).slice(-20), gear: stringList(src.gear), inventory: stringList(src.inventory).slice(-60),
        currency: normalizeCurrencyEntries(src.currency), wounds: stringList(src.wounds).slice(-30), conditions: stringList(src.conditions).slice(-30), introducedTurn: Math.max(0, Math.floor(num(src.introducedTurn, 0))), lastSeenTurn: Math.max(0, Math.floor(num(src.lastSeenTurn, 0))),
        lootSearchCompleted: bool(src.lootSearchCompleted, false), personalityArchetype: text(src.personalityArchetype) || undefined, personalitySummary: text(src.personalitySummary) || undefined, relationshipDescriptors: stringList(src.relationshipDescriptors).slice(0, 16),
        romanceStyle: ['auto', 'nervous', 'flirt'].includes(String(src.romanceStyle)) ? src.romanceStyle : 'auto',
        standingInfluence: ['none', 'aware', 'constrained'].includes(String(src.standingInfluence)) ? src.standingInfluence : 'none', standingBasis: text(src.standingBasis) || undefined,
        slowBondEvidence: normalizeSlowBondEvidence(src.slowBondEvidence),
    };
}
function normalizeWorldPlans(value) {
    if (!Array.isArray(value))
        return [];
    return value.slice(-80).map((raw, planIndex) => { const o = object(raw); const status = ['pending', 'due', 'completed', 'cancelled'].includes(String(o.status)) ? o.status : 'pending'; const kind = ['scheduled', 'npc', 'faction', 'power_actor'].includes(String(o.kind)) ? o.kind : undefined; const ev = Array.isArray(o.evidence) ? o.evidence.slice(-12).map((r, evidenceIndex) => { const e = object(r); const route = ['location', 'actor', 'news', 'investigation'].includes(String(e.route)) ? e.route : 'news'; return { id: text(e.id) || `we_legacy_${planIndex}_${evidenceIndex}`, topic: text(e.topic).slice(0, 160), text: text(e.text).slice(0, 500), route, location: text(e.location) || undefined, actor: text(e.actor) || undefined, discovered: bool(e.discovered, false), discoveredTurn: num(e.discoveredTurn, 0) || undefined }; }).filter((e) => e.text) : []; return { id: text(o.id), actor: text(o.actor), intent: text(o.intent), kind, cause: text(o.cause) || undefined, consequences: stringList(o.consequences).slice(-8), evidence: ev, createdTurn: Math.max(0, Math.floor(num(o.createdTurn, 0))) || undefined, updatedTurn: Math.max(0, Math.floor(num(o.updatedTurn, 0))) || undefined, cancellationReason: text(o.cancellationReason) || undefined, dueTurn: Math.max(0, Math.floor(num(o.dueTurn, 0))), status }; }).filter((p) => p.id && p.actor && p.intent);
}
function normalizeDescriptiveArchive(value) {
    if (!Array.isArray(value))
        return [];
    return value.slice(-240).map(raw => { const o = object(raw); const kind = ['npc', 'place', 'location', 'organization', 'faction', 'event', 'object', 'other'].includes(String(o.kind)) ? o.kind : 'other'; return { id: text(o.id), label: text(o.label), kind, description: text(o.description).slice(0, 700), promotedName: text(o.promotedName) || undefined, affiliation: text(o.affiliation) || undefined, history: stringList(o.history).slice(-12), connections: stringList(o.connections).slice(-12), lastKnownStatus: text(o.lastKnownStatus) || undefined, lastKnownLocation: text(o.lastKnownLocation) || undefined, evidence: stringList(o.evidence).slice(-10), firstSeenTurn: Math.max(0, Math.floor(num(o.firstSeenTurn, 0))), lastSeenTurn: Math.max(0, Math.floor(num(o.lastSeenTurn, 0))) }; }).filter((x) => x.id && x.label && x.description);
}
function normalizeReputation(value) {
    const src = object(value);
    const location = text(src.location);
    if (!location)
        return null;
    return { location, fame: clampInt(src.fame, -20, 20, 0), infamy: clampInt(src.infamy, -20, 20, 0), fear: clampInt(src.fear, -20, 20, 0), notes: stringList(src.notes).slice(-20) };
}
function normalizeRapportClocks(value) {
    const out = {};
    for (const [name, raw] of Object.entries(object(value))) {
        const c = object(raw);
        out[name] = { rapport: clampInt(c.rapport, 0, 5, 0), lastInteractionAt: Math.max(0, num(c.lastInteractionAt, 0)), lastMeaningfulAt: Math.max(0, num(c.lastMeaningfulAt, 0)), cooldownUntil: Math.max(0, num(c.cooldownUntil, 0)), partnerMeaningfulUntil: Math.max(0, num(c.partnerMeaningfulUntil, 0)) };
    }
    return out;
}
function normalizeSlowBondEvidence(value) {
    const src = object(value), counts = object(src.counts), out = blankSlowBondCounts();
    for (const k of Object.keys(out))
        out[k] = clampInt(counts[k], 0, 20, 0);
    return { counts: out, blockers: stringList(src.blockers).slice(-12), lastUpdatedTurn: Math.max(0, Math.floor(num(src.lastUpdatedTurn, 0))) };
}
function normalizeCurrencyEntries(value) {
    if (!Array.isArray(value))
        return [];
    const merged = new Map();
    for (const raw of value) {
        const o = object(raw), currency = text(o.currency).slice(0, 60), amount = num(o.amount, 0);
        if (!currency || !Number.isFinite(amount))
            continue;
        const key = currency.toLowerCase();
        const prev = merged.get(key);
        merged.set(key, { currency: prev?.currency || currency, amount: (prev?.amount || 0) + amount });
    }
    return [...merged.values()].filter(x => Math.abs(x.amount) > 1e-9).slice(-30);
}
function normalizeHealthActor(src, fallbackMax) {
    const maxHp = Math.max(1, Math.floor(num(src.maxHp, fallbackMax)));
    return { maxHp, currentHp: clampInt(src.currentHp, 0, maxHp, maxHp), dead: bool(src.dead, false), nonlethalDefeat: bool(src.nonlethalDefeat, false), lastDamageAt: num(src.lastDamageAt, 0) || undefined, lastDamageStateKey: text(src.lastDamageStateKey) || undefined, naturalTreatmentKey: text(src.naturalTreatmentKey) || undefined, naturalTreatmentAt: num(src.naturalTreatmentAt, 0) || undefined };
}
function dedupeFacts(facts) { const seen = new Set(); return facts.filter(f => { const k = `${f?.scope}|${f?.subject}|${String(f?.fact || '').toLowerCase()}`; if (!f?.fact || seen.has(k))
    return false; seen.add(k); return true; }); }
export function object(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
export function text(v) { return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim(); }
export function stringList(v) { return Array.isArray(v) ? v.map(text).filter(Boolean) : typeof v === 'string' ? v.split(/\r?\n|,/).map(text).filter(Boolean) : []; }
export function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
export function clampNum(v, min, max, fallback) { return Math.max(min, Math.min(max, num(v, fallback))); }
export function clampInt(v, min, max, fallback) { return Math.round(clampNum(v, min, max, fallback)); }
export function bool(v, fallback = false) { if (typeof v === 'boolean')
    return v; if (v === 'true' || v === 'Y' || v === 1)
    return true; if (v === 'false' || v === 'N' || v === 0)
    return false; return fallback; }
export function makeCoreSnapshot(state) {
    return JSON.parse(JSON.stringify({ turn: state.turn, player: state.player, npcs: state.npcs, health: state.health, world: state.world, reputation: state.reputation, progression: state.progression, economy: state.economy, names: state.names, continuity: state.continuity }));
}
export function restoreCoreSnapshot(state, base) {
    const b = object(base);
    state.turn = Math.max(0, Math.floor(num(b.turn, state.turn)));
    state.player = b.player ?? null;
    state.npcs = object(b.npcs);
    state.health = b.health ?? createDefaultState().health;
    state.world = b.world ?? createDefaultState().world;
    state.reputation = Array.isArray(b.reputation) ? b.reputation : [];
    state.progression = b.progression ?? createDefaultState().progression;
    state.economy = b.economy ?? createDefaultState().economy;
    state.names = b.names ?? createDefaultState().names;
    state.continuity = b.continuity ?? createDefaultState().continuity;
    return normalizeState({ ...state, rollback: state.rollback, audits: state.audits, lastResolution: state.lastResolution, pending: state.pending, proseReview: state.proseReview });
}
