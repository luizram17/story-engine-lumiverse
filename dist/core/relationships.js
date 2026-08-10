import { ensureNpc, rankFromCapabilityPool } from './state.js';
import { hash32 } from './rng.js';
const SLOW_BOND_KEYS = ['respectfulContact', 'cooperation', 'comfortInProximity', 'boundaryRespect', 'sharedRoutine', 'playfulness', 'teamwork', 'personalAttention'];
const RAPPORT_COOLDOWN_MS = 30 * 60 * 1000;
export function classifyDisposition(npc) {
    if (npc.status === 'dead')
        return 'dead';
    if (npc.hostility >= 4)
        return 'hatred';
    if (npc.fear >= 4)
        return 'terrified';
    if (npc.hostility >= 3)
        return 'hostile';
    if (npc.fear >= 3)
        return 'afraid';
    if (npc.bond >= 4)
        return npc.romanceStage === 'partner' ? 'devoted partner' : 'devoted';
    if (npc.bond >= 3)
        return npc.romanceStage === 'dating' ? 'romantically warm' : 'warm';
    if (npc.bond >= 2)
        return 'friendly';
    if (npc.hostility >= 2)
        return 'resentful';
    if (npc.fear >= 2)
        return 'wary';
    return 'neutral';
}
export function enforceRelationshipInvariants(npc) {
    npc.bond = clamp(npc.bond, 0, 4);
    npc.fear = clamp(npc.fear, 0, 4);
    npc.hostility = clamp(npc.hostility, 0, 4);
    npc.intimacy = clamp(npc.intimacy, 0, 4);
    if (npc.fear >= 3 || npc.hostility >= 3) {
        npc.bond = Math.min(npc.bond, 1);
        npc.intimacy = Math.min(npc.intimacy, 1);
        if (npc.romanceStage === 'partner' || npc.romanceStage === 'dating')
            npc.romanceStage = 'interest';
    }
    if (npc.intimacy <= 0 && npc.romanceStage !== 'none')
        npc.romanceStage = 'none';
    else if (npc.intimacy >= 4)
        npc.romanceStage = 'partner';
    else if (npc.intimacy >= 2 && npc.romanceStage === 'none')
        npc.romanceStage = 'interest';
    npc.disposition = classifyDisposition(npc);
}
export function updateRelationships(state, semantic, rolls, seed) {
    const notes = [];
    const now = Date.now();
    for (const actor of semantic.actors) {
        if (!actor.name)
            continue;
        const existed = Boolean(state.npcs[actor.name]);
        const resolvedRank = rankFromCapabilityPool(actor.capabilityPool, seed, actor.name, actor.rank);
        const npc = ensureNpc(state, actor.name, resolvedRank, actor.role, seed, actor.mainStat);
        const clock = state.continuity.rapportClocks[actor.name] ?? (state.continuity.rapportClocks[actor.name] = { rapport: 0, lastInteractionAt: 0, lastMeaningfulAt: 0, cooldownUntil: 0, partnerMeaningfulUntil: 0 });
        const relevant = rolls.find(r => r.target.toLowerCase() === actor.name.toLowerCase());
        const positive = relevant ? isPositive(relevant.outcomeTier) : false;
        const strong = relevant ? ['Critical_Success', 'Moderate_Success'].includes(relevant.outcomeTier) : false;
        const action = relevant ? semantic.actions[relevant.actionIndex] : undefined;
        const relation = effectiveRelation(actor, semantic);
        const individuallyAware = (semantic.npcAwareOfUser || []).some(n => sameName(n, actor.name)) || ['direct', 'benefited', 'harmed', 'opposed'].includes(relation);
        let change = '';
        npc.companion = npc.companion || actor.companion;
        npc.powerActor = npc.powerActor || actor.powerActor;
        if (actor.romanceStyle)
            npc.romanceStyle = actor.romanceStyle;
        if (actor.standingInfluence) {
            npc.standingInfluence = actor.standingInfluence;
            npc.standingBasis = actor.standingInfluence === 'none' ? undefined : (actor.standingBasis || npc.standingBasis);
        }
        mergeSlowBondEvidence(npc, actor, state.turn);
        const boundaryTarget = semantic.restraintControl?.present ? semantic.restraintControl.target : semantic.boundaryBreak?.present ? semantic.boundaryBreak.target : semantic.boundaryPressure?.present ? semantic.boundaryPressure.target : '';
        const boundaryKind = semantic.restraintControl?.present ? 'restraint' : semantic.boundaryBreak?.present ? semantic.boundaryBreak.kind : semantic.boundaryPressure?.kind || '';
        const boundaryTargetsNpc = Boolean(boundaryTarget && sameName(boundaryTarget, npc.name));
        const negativeEncounter = relation === 'harmed' || relation === 'opposed' || Boolean(relevant && action?.harmful && positive) || semantic.explicitIntimidationOrCoercion || boundaryTargetsNpc;
        // Rapport is the slow familiarity gate from the original engine. The current
        // qualifying interaction changes rapport before Bond thresholds are evaluated.
        if (individuallyAware) {
            clock.lastInteractionAt = now;
            if (negativeEncounter) {
                clock.rapport = Math.max(0, (clock.rapport || 0) - 1);
            }
            else if (now >= clock.cooldownUntil) {
                clock.rapport = Math.min(5, (clock.rapport || 0) + 1);
                clock.lastMeaningfulAt = now;
                clock.cooldownUntil = now + RAPPORT_COOLDOWN_MS;
            }
        }
        // Initial relationship can be anything already established by canon/history.
        if (!existed) {
            const explicitInitial = actor.initialBond != null || actor.initialFear != null || actor.initialHostility != null || actor.initialRomanceStage != null || actor.initialIntimacy != null || Boolean(actor.relationshipContext) || Boolean(actor.initialRelationshipDescriptors?.length);
            if (actor.initialBond != null)
                npc.bond = actor.initialBond;
            if (actor.initialFear != null)
                npc.fear = actor.initialFear;
            if (actor.initialHostility != null)
                npc.hostility = actor.initialHostility;
            if (actor.initialRomanceStage)
                npc.romanceStage = actor.initialRomanceStage;
            if (actor.initialIntimacy != null)
                npc.intimacy = actor.initialIntimacy;
            if (actor.personalityArchetype)
                npc.personalityArchetype = actor.personalityArchetype;
            if (actor.personalitySummary)
                npc.personalitySummary = actor.personalitySummary;
            if (actor.initialNotes?.length)
                npc.notes = [...npc.notes, ...actor.initialNotes].slice(-20);
            if (actor.relationshipContext)
                npc.notes = [...npc.notes, `Established relationship: ${actor.relationshipContext}`].slice(-20);
            if (actor.initialRelationshipDescriptors?.length)
                npc.relationshipDescriptors = mergeDescriptors(npc.relationshipDescriptors, actor.initialRelationshipDescriptors);
            if (explicitInitial)
                change = `established starting relationship/traits loaded for ${npc.name}`;
            if (!explicitInitial) {
                if (relation === 'benefited') {
                    npc.bond = 1;
                    change = `positive initial impression for ${npc.name}`;
                }
                else if (relation === 'opposed') {
                    npc.hostility = 1;
                    change = `adverse initial impression for ${npc.name}`;
                }
                else if (relation === 'harmed') {
                    npc.hostility = 2;
                    npc.fear = 1;
                    change = `hostile initial impression for ${npc.name}`;
                }
                const rep = state.reputation.find(r => r.location.toLowerCase() === state.world.location.toLowerCase());
                if (rep) {
                    if (rep.fame >= 3)
                        npc.bond += rep.fame >= 8 ? 2 : 1;
                    if (rep.infamy >= 3)
                        npc.hostility += rep.infamy >= 8 ? 2 : 1;
                    if (rep.fear >= 3)
                        npc.fear += rep.fear >= 8 ? 2 : 1;
                    if (rep.infamy >= 6)
                        npc.hostility += 1;
                    if (rep.fame >= 3 || rep.infamy >= 3 || rep.fear >= 3)
                        change = `local reputation influenced ${npc.name}'s initial impression`;
                }
            }
        }
        else {
            if (actor.personalityArchetype && !npc.personalityArchetype)
                npc.personalityArchetype = actor.personalityArchetype;
            if (actor.personalitySummary && (!npc.personalitySummary || npc.personalitySummary.startsWith('temperament:')))
                npc.personalitySummary = actor.personalitySummary;
            if (actor.initialRelationshipDescriptors?.length)
                npc.relationshipDescriptors = mergeDescriptors(npc.relationshipDescriptors, actor.initialRelationshipDescriptors);
            if (actor.relationshipContext && !npc.notes.some(n => n === `Established relationship: ${actor.relationshipContext}`))
                npc.notes = [...npc.notes, `Established relationship: ${actor.relationshipContext}`].slice(-20);
        }
        if (relation === 'harmed' || (relevant && action?.harmful && positive)) {
            npc.hostility += strong ? 2 : 1;
            if (strong)
                npc.fear += 1;
            change = `relationship harm toward ${npc.name}`;
        }
        else if (semantic.explicitIntimidationOrCoercion && relation !== 'observer' && positive) {
            npc.fear += strong ? 2 : 1;
            npc.hostility += relevant?.outcomeTier === 'Critical_Success' ? 1 : 0;
            change = `fear increased for ${npc.name}`;
        }
        else if (relation === 'benefited' && (!relevant || positive)) {
            const before = npc.bond;
            applyBondGain(npc, strong ? 2 : 1, clock.rapport);
            if (npc.bond !== before)
                change = `bond increased for ${npc.name}`;
        }
        else if (relation === 'direct' && semantic.actions.some(a => a.kind === 'heal' && a.target.toLowerCase() === actor.name.toLowerCase())) {
            const before = npc.bond;
            applyBondGain(npc, 1, clock.rapport);
            if (npc.bond !== before)
                change = `aid improved bond with ${npc.name}`;
        }
        if (action?.kind === 'social') {
            const tactic = action.socialTactic || 'none';
            const goal = (action.socialGoal || action.label).slice(0, 120);
            if (npc.lastSocialTactic === tactic && npc.lastSocialGoal === goal && positive) {
                // Same lever cannot farm Bond. Undo only this turn's generic gain, never established history.
                if (change.startsWith('bond increased'))
                    npc.bond = Math.max(0, npc.bond - 1);
                change = `repeated social tactic yielded no extra bond with ${npc.name}`;
            }
            npc.lastSocialTactic = tactic;
            npc.lastSocialGoal = goal;
        }
        if (boundaryTargetsNpc) {
            const same = npc.boundary?.active && npc.boundary.kind.toLowerCase() === boundaryKind.toLowerCase();
            npc.hostility += same ? 2 : 1;
            npc.fear += same ? 1 : 0;
            npc.boundary = { id: npc.boundary?.id || `bd_${hash32(`${npc.name}|${boundaryKind}|${state.turn}`).toString(36)}`, kind: boundaryKind || 'personal boundary', setTurn: npc.boundary?.setTurn ?? state.turn, lastPressuredTurn: state.turn, pressureCount: (npc.boundary?.pressureCount ?? 0) + 1, active: true };
            change = `boundary pressure increased hostility for ${npc.name}`;
        }
        if (semantic.intimacyAdvanceExplicit && relation === 'direct') {
            if (npc.boundary?.active || npc.hostility >= 2 || npc.fear >= 3) {
                npc.hostility += 1;
                change = `intimacy advance crossed an active boundary for ${npc.name}`;
            }
            else if (npc.bond >= 3 && positive) {
                npc.intimacy += strong ? 2 : 1;
                if (npc.intimacy >= 3)
                    npc.romanceStage = 'dating';
                else if (npc.intimacy >= 1)
                    npc.romanceStage = 'interest';
                change = `intimacy advanced with ${npc.name}`;
            }
        }
        enforceRelationshipInvariants(npc);
        if (change)
            notes.push(change);
    }
    return notes;
}
/** Relationship-derived proactivity weight. This is intentionally not "standing". */
export function relationshipLeverage(state, npcName) {
    const npc = state.npcs[npcName];
    if (!npc)
        return 0;
    return npc.bond - npc.hostility - Math.floor(npc.fear / 2);
}
/** Backward-compatible alias for older callers; use relationshipLeverage in new code. */
export const standingInfluence = relationshipLeverage;
export function slowBondEligible(state, npc) {
    const clock = state.continuity.rapportClocks[npc.name];
    return npc.bond === 3 && npc.fear < 3 && npc.hostility < 3 && (clock?.rapport || 0) >= 5 && npc.slowBondEvidence.blockers.length === 0 && distinctSlowBondCategories(npc) >= 2;
}
export function relationshipSummary(npc) {
    const romance = npc.romanceStage !== 'none' ? `; romance ${npc.romanceStage}/I${npc.intimacy} (${npc.romanceStyle})` : '';
    const boundary = npc.boundary?.active ? `; boundary ${npc.boundary.kind}` : '';
    const descriptors = npc.relationshipDescriptors?.length ? `; relationships [${npc.relationshipDescriptors.join(', ')}]` : '';
    const standing = npc.standingInfluence !== 'none' ? `; standing ${npc.standingInfluence}${npc.standingBasis ? ` (${npc.standingBasis})` : ''}` : '';
    return `${npc.name}: ${npc.disposition}; B${npc.bond}/F${npc.fear}/H${npc.hostility}${romance}${boundary}${descriptors}${standing}; ${npc.companion ? 'companion' : npc.role}`;
}
function mergeSlowBondEvidence(npc, actor, turn) {
    if (npc.slowBondEvidence.lastUpdatedTurn !== turn) {
        for (const key of SLOW_BOND_KEYS)
            if (actor.slowBondEvidence?.[key])
                npc.slowBondEvidence.counts[key] = Math.min(20, (npc.slowBondEvidence.counts[key] || 0) + 1);
        npc.slowBondEvidence.blockers = (actor.slowBondBlockers || []).map(x => String(x).trim()).filter(Boolean).slice(-12);
        npc.slowBondEvidence.lastUpdatedTurn = turn;
    }
}
function distinctSlowBondCategories(npc) { return SLOW_BOND_KEYS.filter(k => (npc.slowBondEvidence.counts[k] || 0) > 0).length; }
function applyBondGain(npc, amount, rapport) {
    if (amount <= 0 || npc.bond >= 4)
        return;
    // One relationship step per qualifying encounter. Rapport gates prevent one strong
    // result from jumping multiple social tiers. This mirrors the original progression
    // shape while retaining this port's 0-based neutral floor.
    if (npc.bond <= 0) {
        if (rapport >= 1)
            npc.bond = 1;
        return;
    }
    if (npc.bond === 1) {
        if (rapport >= 1)
            npc.bond = 2;
        return;
    }
    if (npc.bond === 2) {
        if (rapport >= 3)
            npc.bond = 3;
        return;
    }
    if (npc.bond === 3) {
        const eligible = npc.fear < 3 && npc.hostility < 3 && rapport >= 5 && npc.slowBondEvidence.blockers.length === 0 && distinctSlowBondCategories(npc) >= 2;
        if (eligible)
            npc.bond = 4;
    }
}
function effectiveRelation(actor, semantic) {
    if ((semantic.harmedObservers || []).some(n => sameName(n, actor.name)))
        return 'harmed';
    if ((semantic.benefitedObservers || []).some(n => sameName(n, actor.name)))
        return 'benefited';
    return actor.relation;
}
function mergeDescriptors(existing, incoming) { const out = [...(existing || [])]; const seen = new Set(out.map(x => x.toLowerCase())); for (const raw of incoming) {
    const v = String(raw || '').trim().slice(0, 100);
    if (v && !seen.has(v.toLowerCase())) {
        out.push(v);
        seen.add(v.toLowerCase());
    }
} return out.slice(-16); }
function isPositive(tier) { return ['Success', 'Minor_Success', 'Moderate_Success', 'Critical_Success'].includes(tier); }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Math.round(v))); }
function sameName(a, b) { return a.trim().toLowerCase() === b.trim().toLowerCase(); }
