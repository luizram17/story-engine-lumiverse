import { ensureNpc, rankFromCapabilityPool } from './state.js';
import { hash32 } from './rng.js';
export function classifyDisposition(npc) {
    if (npc.status === 'dead')
        return 'dead';
    if (npc.hostility >= 4)
        return 'hatred';
    if (npc.hostility >= 3)
        return 'hostile';
    if (npc.fear >= 4)
        return 'terrified';
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
    for (const actor of semantic.actors) {
        if (!actor.name)
            continue;
        const existed = Boolean(state.npcs[actor.name]);
        const resolvedRank = rankFromCapabilityPool(actor.capabilityPool, seed, actor.name, actor.rank);
        const npc = ensureNpc(state, actor.name, resolvedRank, actor.role, seed, actor.mainStat);
        const rapport = state.continuity.rapportClocks[actor.name];
        const rapportEligible = !rapport || Date.now() >= rapport.cooldownUntil;
        npc.companion = npc.companion || actor.companion;
        npc.powerActor = npc.powerActor || actor.powerActor;
        const relevant = rolls.find(r => r.target.toLowerCase() === actor.name.toLowerCase());
        const positive = relevant ? isPositive(relevant.outcomeTier) : false;
        const strong = relevant ? ['Critical_Success', 'Moderate_Success'].includes(relevant.outcomeTier) : false;
        const action = relevant ? semantic.actions[relevant.actionIndex] : undefined;
        let change = '';
        // Initial impression is contextual rather than a hardcoded race stereotype: the semantic
        // referee already knows whether this actor is helped, opposed, harmed, or directly engaged.
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
                if (actor.relation === 'benefited') {
                    npc.bond = 1;
                    change = `positive initial impression for ${npc.name}`;
                }
                else if (actor.relation === 'opposed') {
                    npc.hostility = 1;
                    change = `adverse initial impression for ${npc.name}`;
                }
                else if (actor.relation === 'harmed') {
                    npc.hostility = 2;
                    npc.fear = 1;
                    change = `hostile initial impression for ${npc.name}`;
                }
                // Fame/infamy is location-scoped influence, not a universal morality meter. New local
                // NPCs may begin with a small deterministic bias once the user's standing is notable.
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
            if (actor.personalitySummary && !npc.personalitySummary)
                npc.personalitySummary = actor.personalitySummary;
            if (actor.initialRelationshipDescriptors?.length)
                npc.relationshipDescriptors = mergeDescriptors(npc.relationshipDescriptors, actor.initialRelationshipDescriptors);
            if (actor.relationshipContext && !npc.notes.some(n => n === `Established relationship: ${actor.relationshipContext}`))
                npc.notes = [...npc.notes, `Established relationship: ${actor.relationshipContext}`].slice(-20);
        }
        if (actor.relation === 'harmed' || (relevant && action?.harmful && positive)) {
            npc.hostility += strong ? 2 : 1;
            if (strong)
                npc.fear += 1;
            change = `relationship harm toward ${npc.name}`;
        }
        else if (semantic.explicitIntimidationOrCoercion && actor.relation !== 'observer' && positive) {
            npc.fear += strong ? 2 : 1;
            npc.hostility += relevant?.outcomeTier === 'Critical_Success' ? 1 : 0;
            change = `fear increased for ${npc.name}`;
        }
        else if (actor.relation === 'benefited' && (!relevant || positive) && rapportEligible) {
            npc.bond += strong ? 2 : 1;
            change = `bond increased for ${npc.name}`;
        }
        else if (actor.relation === 'direct' && rapportEligible && semantic.actions.some(a => a.kind === 'heal' && a.target.toLowerCase() === actor.name.toLowerCase())) {
            npc.bond += 1;
            change = `aid improved bond with ${npc.name}`;
        }
        if (action?.kind === 'social') {
            const tactic = action.socialTactic || 'none';
            const goal = (action.socialGoal || action.label).slice(0, 120);
            if (npc.lastSocialTactic === tactic && npc.lastSocialGoal === goal && positive) {
                // Repeating the same social lever should not infinitely farm relationship.
                npc.bond = Math.max(0, npc.bond - 1);
                change = `repeated social tactic yielded no extra bond with ${npc.name}`;
            }
            npc.lastSocialTactic = tactic;
            npc.lastSocialGoal = goal;
        }
        const boundaryTarget = semantic.restraintControl?.present ? semantic.restraintControl.target : semantic.boundaryBreak?.present ? semantic.boundaryBreak.target : semantic.boundaryPressure?.present ? semantic.boundaryPressure.target : '';
        const boundaryKind = semantic.restraintControl?.present ? 'restraint' : semantic.boundaryBreak?.present ? semantic.boundaryBreak.kind : semantic.boundaryPressure?.kind || '';
        if (boundaryTarget && boundaryTarget.toLowerCase() === npc.name.toLowerCase()) {
            const same = npc.boundary?.active && npc.boundary.kind.toLowerCase() === boundaryKind.toLowerCase();
            npc.hostility += same ? 2 : 1;
            npc.fear += same ? 1 : 0;
            npc.boundary = {
                id: npc.boundary?.id || `bd_${hash32(`${npc.name}|${boundaryKind}|${state.turn}`).toString(36)}`,
                kind: boundaryKind || 'personal boundary', setTurn: npc.boundary?.setTurn ?? state.turn,
                lastPressuredTurn: state.turn, pressureCount: (npc.boundary?.pressureCount ?? 0) + 1, active: true,
            };
            change = `boundary pressure increased hostility for ${npc.name}`;
        }
        if (semantic.intimacyAdvanceExplicit && actor.relation === 'direct') {
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
export function standingInfluence(state, npcName) {
    const npc = state.npcs[npcName];
    if (!npc)
        return 0;
    return npc.bond - npc.hostility - Math.floor(npc.fear / 2);
}
export function relationshipSummary(npc) {
    const romance = npc.romanceStage !== 'none' ? `; romance ${npc.romanceStage}/I${npc.intimacy}` : '';
    const boundary = npc.boundary?.active ? `; boundary ${npc.boundary.kind}` : '';
    const descriptors = npc.relationshipDescriptors?.length ? `; relationships [${npc.relationshipDescriptors.join(', ')}]` : '';
    return `${npc.name}: ${npc.disposition}; B${npc.bond}/F${npc.fear}/H${npc.hostility}${romance}${boundary}${descriptors}; ${npc.companion ? 'companion' : npc.role}`;
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
