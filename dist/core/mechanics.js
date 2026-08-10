import { DAMAGE_BY_OUTCOME, MAX_ACTIONS } from './config.js';
import { TurnRng } from './rng.js';
import { conditionFromActor, impairmentForCondition, healingForOutcome, safeSceneHealing, healingDcForActor } from './health.js';
import { ensureNpc, rankFromCapabilityPool } from './state.js';
import { relationshipLeverage } from './relationships.js';
import { resolveRandomEvent } from './world.js';
import { generateUniqueNames } from './names.js';
import { deterministicLoot, resolvePlayerEquipmentDefense } from './economy.js';
import { boundaryGate } from './continuity.js';
export function combatOutcome(margin, actionLength) {
    let outcome;
    if (margin >= 8)
        outcome = { outcomeTier: 'Critical_Success', landedActions: 3, outcome: 'dominant_impact', counterPotential: 'none' };
    else if (margin >= 5)
        outcome = { outcomeTier: 'Moderate_Success', landedActions: 2, outcome: 'solid_impact', counterPotential: 'none' };
    else if (margin >= 1)
        outcome = { outcomeTier: 'Minor_Success', landedActions: 1, outcome: 'light_impact', counterPotential: 'none' };
    else if (margin === 0)
        outcome = { outcomeTier: 'Stalemate', landedActions: 0, outcome: 'struggle', counterPotential: 'none' };
    else if (margin >= -3)
        outcome = { outcomeTier: 'Minor_Failure', landedActions: 0, outcome: 'checked', counterPotential: 'light' };
    else if (margin >= -7)
        outcome = { outcomeTier: 'Moderate_Failure', landedActions: 0, outcome: 'deflected', counterPotential: 'medium' };
    else
        outcome = { outcomeTier: 'Critical_Failure', landedActions: 0, outcome: 'avoided', counterPotential: 'severe' };
    outcome.landedActions = Math.min(outcome.landedActions, Math.max(1, Math.min(3, actionLength)));
    return outcome;
}
export function nonHostileOutcome(margin) {
    if (margin >= 1)
        return { outcomeTier: 'Success', landedActions: 1, outcome: 'success', counterPotential: 'none' };
    if (margin === 0)
        return { outcomeTier: 'Stalemate', landedActions: 0, outcome: 'struggle', counterPotential: 'none' };
    return { outcomeTier: 'Failure', landedActions: 0, outcome: 'failure', counterPotential: 'none' };
}
export function resolveTurn(state, semantic, fingerprint, seed, settings) {
    const rng = new TurnRng(seed);
    const actions = semantic.actions.slice(0, MAX_ACTIONS).map(a => ({ ...a }));
    const rolls = [];
    const healthEvents = [];
    const refereeNotes = [];
    for (const actor of semantic.actors) {
        if (!actor.name)
            continue;
        const rank = rankFromCapabilityPool(actor.capabilityPool, seed, actor.name, actor.rank);
        const npc = ensureNpc(state, actor.name, rank, actor.role, seed, actor.mainStat);
        npc.companion = npc.companion || actor.companion;
        npc.powerActor = npc.powerActor || actor.powerActor;
        if (actor.romanceStyle)
            npc.romanceStyle = actor.romanceStyle;
        if (actor.standingInfluence) {
            npc.standingInfluence = actor.standingInfluence;
            npc.standingBasis = actor.standingInfluence === 'none' ? undefined : (actor.standingBasis || npc.standingBasis);
        }
    }
    if (semantic.claimCheck?.present) {
        const c = semantic.claimCheck;
        refereeNotes.push(`Claim check for ${c.target || 'target'}: truth=${c.truth}; access=${c.access}. A successful social roll may improve leverage/presentation but cannot change objective truth or grant knowledge the NPC lacks.`);
    }
    const bGate = boundaryGate(state, semantic);
    if (bGate.mode === 'grace')
        refereeNotes.push(`Boundary grace: ${bGate.target} gets a warning before this access/restraint pressure becomes an opposed roll. Do not narrate compliance or successful control.`);
    else if (bGate.mode === 'force')
        refereeNotes.push(`Boundary contest: ${bGate.target}'s boundary is immediately opposed or its warning threshold was reached; resolve relevant pressure as a contested action.`);
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const targetsBoundary = bGate.target && action.target.toLowerCase() === bGate.target.toLowerCase() && (action.kind === 'restraint' || action.challengeType === 'restraint' || action.kind === 'environment' || action.kind === 'social');
        if (targetsBoundary && bGate.mode === 'grace') {
            continue;
        }
        if (targetsBoundary && bGate.mode === 'force' && !action.rollNeeded) {
            action.rollNeeded = true;
            action.challengeType = action.kind === 'restraint' ? 'restraint' : 'environment';
            action.stat = action.stat === 'NONE' ? 'PHY' : action.stat;
        }
        const availability = validateAvailability(state, action);
        if (!availability.ok) {
            refereeNotes.push(availability.note);
            continue;
        }
        if (action.kind === 'heal' && !action.rollNeeded) {
            const amount = safeSceneHealing(action.healingMagic);
            healthEvents.push({ targetType: action.target ? 'npc' : 'user', target: action.target, kind: 'heal', amount, naturalTreatment: !action.healingMagic });
            refereeNotes.push(`Safe-scene ${action.healingMagic ? 'magical' : 'natural'} aid heals ${amount}.`);
            continue;
        }
        if (!action.rollNeeded || action.challengeType === 'none')
            continue;
        const result = resolveAction(state, action, i, rng, seed);
        rolls.push(result);
        buildHealthEvents(action, result, healthEvents);
    }
    const proactivity = settings.proactivity ? resolveProactivity(state, semantic, rolls, rng) : [];
    const aggression = resolveNpcAggression(state, semantic, rolls, proactivity, rng);
    for (const a of aggression)
        if (a.damage > 0)
            healthEvents.push({ targetType: 'user', target: '', kind: 'damage', amount: a.damage });
    const randomEvent = resolveRandomEvent(state, semantic, rng, settings.randomEvents, settings.randomEventChance);
    const generatedNames = generateUniqueNames(state, Math.max(semantic.namesNeeded.length, 8), seed, settings.nameStyle);
    const lootResult = resolveLootSearch(state, semantic, seed, refereeNotes);
    const xpAward = calculateXp(rolls);
    return { turnId: `se_${state.turn + 1}_${fingerprint}`, turn: state.turn + 1, fingerprint, semantic, rolls, aggression, proactivity, randomEvent, generatedNames, healthEvents, refereeNotes, xpAward, lootResult, handoff: '', createdAt: Date.now() };
}
function validateAvailability(state, action) {
    const player = state.player;
    if (!player)
        return { ok: true, note: '' };
    if (action.itemUse) {
        const wanted = action.itemUse.toLowerCase();
        const owned = [...player.inventory, ...player.gear].some(x => x.toLowerCase() === wanted || x.toLowerCase().includes(wanted));
        if (!owned)
            return { ok: false, note: `Unavailable item: ${action.itemUse}. Do not narrate it as owned or successfully used.` };
    }
    if (action.abilityUse) {
        const wanted = action.abilityUse.toLowerCase();
        const known = [...player.abilities, ...player.spells, ...player.naturalWeapons].some(x => x.toLowerCase() === wanted || x.toLowerCase().includes(wanted));
        if (!known)
            return { ok: false, note: `Unavailable ability/spell/natural weapon: ${action.abilityUse}. Do not grant the attempted capability.` };
    }
    if (action.supernatural && action.abilityUse && !player.spells.some(x => x.toLowerCase().includes(action.abilityUse.toLowerCase())) && !player.abilities.some(x => x.toLowerCase().includes(action.abilityUse.toLowerCase())))
        return { ok: false, note: `Supernatural effect ${action.abilityUse} is not established on the player sheet.` };
    return { ok: true, note: '' };
}
function resolveAction(state, action, index, rng, seed) {
    const stat = action.stat === 'NONE' ? chooseUserStat(action) : action.stat;
    const playerStat = state.player?.stats[stat] ?? 1;
    const userCondition = conditionFromActor(state.health.user);
    const impairment = Math.max(-8, impairmentForCondition(userCondition));
    const userDie = rng.d20();
    const userTotal = userDie + playerStat + impairment;
    let oppositionStat = 0;
    let oppositionDie = rng.d20();
    if (action.kind === 'heal') {
        const targetHealth = action.target ? state.health.npcs[action.target] : state.health.user;
        const dc = targetHealth ? healingDcForActor(targetHealth) : 13;
        oppositionStat = dc - 10;
        oppositionDie = 10;
    }
    else if (action.target && action.challengeType !== 'environment') {
        const actor = state.npcs[action.target] ?? ensureNpc(state, action.target, 'Average', 'NPC', seed);
        const targetStat = action.targetStat && action.targetStat !== 'NONE' ? action.targetStat : chooseOppositionStat(action);
        oppositionStat = actor.stats[targetStat];
        const health = state.health.npcs[action.target];
        if (health)
            oppositionStat += Math.max(-8, impairmentForCondition(conditionFromActor(health)));
    }
    else {
        oppositionStat = difficultyBonus(action.difficulty);
        oppositionDie = 10;
    }
    const oppositionTotal = oppositionDie + oppositionStat;
    const margin = userTotal - oppositionTotal;
    const tier = ['mundane_combat', 'supernatural_combat'].includes(action.challengeType) ? combatOutcome(margin, action.actionLength) : nonHostileOutcome(margin);
    return { actionIndex: index, label: action.label, challengeType: action.challengeType, userDie, userStat: playerStat + impairment, userTotal, oppositionDie, oppositionStat, oppositionTotal, margin, ...tier, target: action.target };
}
function buildHealthEvents(action, result, events) {
    if (action.kind === 'heal') {
        const amt = healingForOutcome(result.outcomeTier, action.healingMagic);
        if (amt > 0)
            events.push({ targetType: action.target ? 'npc' : 'user', target: action.target, kind: 'heal', amount: amt, naturalTreatment: !action.healingMagic });
        return;
    }
    if (!action.harmful || !['mundane_combat', 'supernatural_combat'].includes(action.challengeType))
        return;
    // Story Engine's health scale maps the outcome tier itself to damage (3/6/9).
    // landedActions controls narration/number of hits, not a second damage multiplier.
    const dmg = DAMAGE_BY_OUTCOME[result.outcomeTier] ?? 0;
    if (dmg <= 0)
        return;
    if (action.target)
        events.push({ targetType: 'npc', target: action.target, kind: 'damage', amount: dmg, nonlethal: action.harmMode === 'nonlethal' });
}
export function resolveProactivity(state, sem, rolls, rng) {
    const candidates = [];
    for (const actor of sem.actors) {
        const npc = state.npcs[actor.name];
        if (!npc || npc.status !== 'active')
            continue;
        const relation = relationshipLeverage(state, actor.name);
        const opposed = actor.relation === 'opposed' || actor.relation === 'harmed';
        const crisis = sem.scene.danger === 'crisis';
        const forced = opposed && rolls.some(r => r.target === actor.name && r.counterPotential !== 'none');
        const tier = forced ? 'FORCED' : crisis ? 'HIGH' : npc.companion ? 'MEDIUM' : Math.abs(relation) >= 3 ? 'MEDIUM' : 'LOW';
        const threshold = forced ? 0 : tier === 'HIGH' ? 8 : tier === 'MEDIUM' ? 10 : 13;
        const die = forced ? 20 : rng.d20();
        const proactive = forced || die >= threshold;
        let intent = 'NONE';
        let target = '';
        if (proactive) {
            if (opposed || npc.hostility >= 3) {
                intent = crisis || forced || npc.hostility >= 4 ? 'ESCALATE_VIOLENCE' : 'THREAT_OR_POSTURE';
                target = '{{user}}';
            }
            else if (npc.companion && crisis) {
                if (npc.hostility >= 2 || npc.fear >= 3 || (npc.bond <= 1 && rng.chance(.2)))
                    intent = 'Companion_Abandon';
                else if (npc.bond >= 3 && rng.chance(.5))
                    intent = 'Companion_Protect';
                else
                    intent = 'Companion_Assist';
                target = '{{user}}';
            }
            else if (npc.romanceStage === 'partner' && npc.bond >= 3) {
                const clock = state.continuity.rapportClocks[npc.name];
                intent = clock && Date.now() < clock.partnerMeaningfulUntil ? 'PLAN_OR_BANTER' : rng.chance(.35) ? 'Partner_Protect' : 'Partner_Affection';
                target = '{{user}}';
            }
            else if (npc.romanceStage === 'interest' || npc.romanceStage === 'dating') {
                intent = npc.romanceStyle === 'nervous' ? 'Romantic_Hesitant_Initiative' : npc.romanceStyle === 'flirt' ? 'Romantic_Flirt' : rng.chance(.4) ? 'Romantic_Flirt' : 'Thoughtful_Gift';
                target = '{{user}}';
            }
            else if (npc.bond >= 3) {
                intent = rng.chance(.25) ? 'Thoughtful_Gift' : 'SUPPORT_ACT';
                target = '{{user}}';
            }
            else {
                intent = 'PLAN_OR_BANTER';
                target = '{{user}}';
            }
            // Recognized authority/status can constrain an unsolicited attack's outward expression,
            // but never cancels self-defense, retaliation, counters, active combat, or boundary response.
            if (intent === 'ESCALATE_VIOLENCE' && target === '{{user}}' && npc.standingInfluence === 'constrained' && !forced) {
                const harmfulUserAction = sem.actions.some(a => a.harmful && a.target && sameName(a.target, npc.name));
                const boundaryResponse = (sem.restraintControl?.present && sameName(sem.restraintControl.target, npc.name)) || (sem.boundaryPressure?.present && sameName(sem.boundaryPressure.target, npc.name)) || (sem.boundaryBreak?.present && sameName(sem.boundaryBreak.target, npc.name));
                const establishedCombat = sem.activeHostileThreat === true || sem.scene.danger === 'crisis' || opposed || harmfulUserAction || boundaryResponse;
                if (!establishedCombat) {
                    intent = 'THREAT_OR_POSTURE';
                    target = '{{user}}';
                }
            }
        }
        candidates.push({ npc: actor.name, proactive, tier, die, threshold, intent, target });
    }
    return candidates.sort((a, b) => b.die - a.die).slice(0, 3);
}
export function resolveNpcAggression(state, sem, rolls, proactivity, rng) {
    const results = [];
    const defense = resolvePlayerEquipmentDefense(state);
    for (const p of proactivity) {
        if (!p.proactive || p.intent !== 'ESCALATE_VIOLENCE')
            continue;
        const npc = state.npcs[p.npc];
        if (!npc || npc.status !== 'active')
            continue;
        const failedAgainst = rolls.find(r => r.target === p.npc && r.counterPotential !== 'none');
        const source = failedAgainst ? 'forced_counter' : 'proactivity';
        const counterBonus = failedAgainst ? { light: 2, medium: 4, severe: 6, none: 0 }[failedAgainst.counterPotential] : 0;
        const npcStat = Math.max(npc.stats.PHY, npc.stats.MND);
        const userBase = Math.max(state.player?.stats.PHY ?? 1, state.player?.stats.MND ?? 1);
        const userImpair = Math.max(-8, impairmentForCondition(conditionFromActor(state.health.user)));
        const npcHealth = state.health.npcs[npc.name];
        const npcImpair = npcHealth ? Math.max(-8, impairmentForCondition(conditionFromActor(npcHealth))) : 0;
        const npcDie = rng.d20(), userDie = rng.d20();
        const npcTotal = npcDie + npcStat + npcImpair + counterBonus;
        const defenseBonus = defense?.bonus ?? 0;
        const userTotal = userDie + userBase + userImpair + defenseBonus;
        const margin = npcTotal - userTotal;
        const outcome = margin >= 5 ? 'npc_overpowers' : margin >= 1 ? 'npc_succeeds' : margin === 0 ? 'stalemate' : 'npc_fails';
        const damage = outcome === 'npc_overpowers' ? 6 : outcome === 'npc_succeeds' ? 3 : 0;
        results.push({ npc: npc.name, label: `${npc.name} attacks {{user}}`, npcDie, npcStat: npcStat + npcImpair + counterBonus, npcTotal, userDie, userStat: userBase + userImpair, defenseBonus, userTotal, margin, outcome, damage, source });
    }
    return results.slice(0, 3);
}
function resolveLootSearch(state, semantic, seed, notes) {
    const loot = semantic.loot;
    if (!loot?.present)
        return null;
    if (!['humanoid', 'monster'].includes(loot.targetKind)) {
        notes.push(`Loot search for ${loot.target || 'target'} is not a tracked corpse/body; deterministic corpse loot was not generated.`);
        return { target: loot.target, status: 'not_applicable' };
    }
    const npc = state.npcs[loot.target];
    if (!npc) {
        notes.push(`Loot search rejected: ${loot.target || 'target'} is not a tracked NPC/body.`);
        return { target: loot.target, status: 'unknown_target' };
    }
    const health = state.health.npcs[npc.name];
    if (!health?.dead) {
        notes.push(`Loot search rejected: ${npc.name} is not verified dead in hidden health state.`);
        return { target: npc.name, status: 'target_not_dead' };
    }
    if (npc.lootSearchCompleted) {
        notes.push(`Loot search already completed for ${npc.name}; do not generate a second deterministic loot envelope.`);
        return { target: npc.name, status: 'already_searched' };
    }
    const envelope = deterministicLoot(`${seed}|${npc.name}`, npc.rank, state.player?.genre || 'Fantasy', loot.targetKind);
    return { target: npc.name, status: 'ok', ...envelope };
}
function calculateXp(rolls) {
    let xp = 0;
    for (const r of rolls) {
        if (r.outcomeTier === 'Critical_Success')
            xp += 30;
        else if (r.outcomeTier === 'Moderate_Success')
            xp += 20;
        else if (['Minor_Success', 'Success'].includes(r.outcomeTier))
            xp += 10;
    }
    return Math.min(60, xp);
}
function chooseUserStat(a) { if (a.challengeType === 'social')
    return 'CHA'; if (a.challengeType === 'supernatural_combat')
    return 'MND'; return 'PHY'; }
function chooseOppositionStat(a) { if (a.challengeType === 'social')
    return 'CHA'; if (a.challengeType === 'supernatural_combat')
    return 'MND'; return 'PHY'; }
function difficultyBonus(d) { return { 1: 0, 2: 0, 3: 4, 4: 8, 5: 12 }[d] ?? 4; }
function sameName(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); }
