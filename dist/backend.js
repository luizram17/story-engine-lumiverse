import { DEFAULT_SETTINGS, SETTINGS_GLOBAL_KEY, STATE_CHAT_KEY, XP_MILESTONE, PROGRESSION_MAX_STAT } from './core/config.js';
import { createDefaultState, normalizeSettings, normalizeState, pruneState, ensureNpc, rankFromCapabilityPool, makeCoreSnapshot, restoreCoreSnapshot, object, text } from './core/state.js';
import { fingerprintText } from './core/rng.js';
import { semanticTool, buildSemanticPrompt, normalizeSemanticLedger, fallbackSemanticLedger } from './core/semantic.js';
import { resolveTurn } from './core/mechanics.js';
import { buildNarratorHandoff, buildPostTurnPrompt, buildStateContext, postTurnTool } from './core/prompts.js';
import { updateRelationships, enforceRelationshipInvariants } from './core/relationships.js';
import { applyHealthEvents, applyNaturalRecovery, increaseMilestoneHealth } from './core/health.js';
import { applyTransaction } from './core/economy.js';
import { applyPowerActorSignals, applyWorldSemantic, addMemoryFact } from './core/world.js';
import { applyContinuitySemantic, archiveDescription, consumeThreadsForActor, resolveBoundary, upsertKnowledge } from './core/continuity.js';
import { collectProseFindings, proseRepairPrompt, stripStructuredArtifacts } from './core/prose.js';
import { applyPlayerToState, buildCharacterPrompt, characterTool, normalizeCharacterSheet, renderPersonaDescription, validateCharacterInput } from './core/character.js';
const pendingGenerationByChat = new Map();
let interceptorRegistered = false;
let generationEventsRegistered = false;
let frontendRegistered = false;
function has(permission) { try {
    return spindle.permissions?.has ? spindle.permissions.has(permission) : true;
}
catch {
    return false;
} }
async function loadSettings() {
    try {
        const raw = await spindle.variables.global.get(SETTINGS_GLOBAL_KEY);
        return raw ? normalizeSettings(JSON.parse(raw)) : normalizeSettings(DEFAULT_SETTINGS);
    }
    catch {
        return normalizeSettings(DEFAULT_SETTINGS);
    }
}
async function saveSettings(settings) { await spindle.variables.global.set(SETTINGS_GLOBAL_KEY, JSON.stringify(normalizeSettings(settings))); }
async function loadState(chatId) {
    try {
        const raw = await spindle.variables.chat.get(chatId, STATE_CHAT_KEY);
        return raw ? normalizeState(JSON.parse(raw)) : createDefaultState();
    }
    catch (err) {
        spindle.log?.warn?.(`Story Engine state read failed for ${chatId}: ${String(err)}`);
        return createDefaultState();
    }
}
async function saveState(chatId, state) { await spindle.variables.chat.set(chatId, STATE_CHAT_KEY, JSON.stringify(pruneState(state))); }
function textContent(content) {
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content))
        return content.filter((p) => p?.type === 'text').map((p) => String(p.text || '')).join('\n');
    return '';
}
function lastUserText(messages) { for (let i = messages.length - 1; i >= 0; i--)
    if (messages[i]?.role === 'user')
        return textContent(messages[i].content); return ''; }
function lastAssistantBeforeUser(messages) { let seenUser = false; for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === 'user') {
        seenUser = true;
        continue;
    }
    if (seenUser && messages[i]?.role === 'assistant')
        return textContent(messages[i].content);
} return ''; }
function compactHistory(messages, count) { return messages.slice(-count).map(m => `${String(m.role || '').toUpperCase()}: ${textContent(m.content).slice(0, 3000)}`).join('\n\n'); }
function turnFingerprint(messages, userText) { const userCount = messages.filter(m => m?.role === 'user').length; return fingerprintText(`${userCount}|${lastAssistantBeforeUser(messages).slice(-800)}|${userText}`); }
async function extractSemantic(messages, context, settings, state, userText) {
    if (!settings.semanticEnabled || !has('generation'))
        return fallbackSemanticLedger(userText);
    const prompts = buildSemanticPrompt({ userMessage: userText, history: compactHistory(messages, settings.recentMessageCount), stateContext: buildStateContext(state) });
    try {
        const result = await spindle.generate.quiet({ messages: prompts, tools: [semanticTool()], parameters: { temperature: settings.semanticTemperature, max_tokens: 2400 }, connection_id: settings.semanticConnectionId || context?.connectionId || undefined, reasoning: { enabled: false } });
        const call = result?.tool_calls?.find((x) => x?.name === 'submit_story_ledger') || result?.tool_calls?.[0];
        const payload = call?.args ?? parseJsonContent(result?.content);
        if (!payload)
            throw new Error('No structured semantic payload returned');
        return normalizeSemanticLedger(payload);
    }
    catch (err) {
        spindle.log?.warn?.(`Semantic preflight failed; using conservative fallback: ${String(err)}`);
        return fallbackSemanticLedger(userText);
    }
}
function projectResolution(baseState, resolution, settings, seed) {
    const projected = normalizeState(JSON.parse(JSON.stringify(baseState)));
    projected.turn = resolution.turn;
    for (const actor of resolution.semantic.actors) {
        const rank = rankFromCapabilityPool(actor.capabilityPool, seed, actor.name, actor.rank);
        const npc = ensureNpc(projected, actor.name, rank, actor.role, seed, actor.mainStat);
        npc.companion = npc.companion || actor.companion;
        npc.powerActor = npc.powerActor || actor.powerActor;
    }
    const beforeDay = projected.world.dayIndex;
    applyWorldSemantic(projected, resolution.semantic, seed);
    if (projected.world.dayIndex > beforeDay)
        applyNaturalRecovery(projected, projected.world.dayIndex - beforeDay);
    updateRelationships(projected, resolution.semantic, resolution.rolls, seed);
    applyContinuitySemantic(projected, resolution.semantic);
    applyHealthEvents(projected, resolution.healthEvents);
    applyTransaction(projected, resolution.semantic.transaction);
    if (settings.powerActors)
        applyPowerActorSignals(projected, resolution.semantic);
    projected.names.used = [...new Set([...projected.names.used, ...resolution.generatedNames])];
    return projected;
}
function registerInterceptor() {
    if (interceptorRegistered || !has('interceptor'))
        return;
    spindle.registerInterceptor(async (messages, context) => {
        const settings = await loadSettings();
        if (!settings.enabled || context?.dryRun === true || context?.generationType === 'quiet' || context?.generationType === 'impersonate')
            return messages;
        const chatId = String(context?.chatId || '');
        if (!chatId)
            return messages;
        const userText = lastUserText(messages);
        if (!userText.trim())
            return messages;
        const fingerprint = turnFingerprint(messages, userText);
        let state = await loadState(chatId);
        const replay = Boolean(['regenerate', 'swipe'].includes(String(context?.generationType)) && state.lastResolution?.fingerprint === fingerprint && state.rollback?.fingerprint === fingerprint);
        let resolution;
        let baseForProjection = state;
        if (replay && state.lastResolution && state.rollback) {
            const restored = restoreCoreSnapshot(normalizeState(JSON.parse(JSON.stringify(state))), state.rollback.base);
            baseForProjection = restored;
            resolution = { ...state.lastResolution, replay: true, createdAt: Date.now() };
        }
        else if (state.pending?.fingerprint === fingerprint) {
            resolution = state.pending;
        }
        else {
            const semantic = await extractSemantic(messages, context, settings, state, userText);
            const seed = `${chatId}|${state.turn + 1}|${fingerprint}`;
            const scratch = normalizeState(JSON.parse(JSON.stringify(state)));
            resolution = resolveTurn(scratch, semantic, fingerprint, seed, { randomEvents: settings.randomEvents, randomEventChance: settings.randomEventChance, proactivity: settings.proactivity, nameStyle: settings.nameStyle });
        }
        const seed = `${chatId}|${resolution.turn}|${fingerprint}`;
        const projected = projectResolution(baseForProjection, resolution, settings, seed);
        resolution.handoff = buildNarratorHandoff(projected, resolution, settings);
        state.pending = resolution;
        await saveState(chatId, state);
        const injected = { role: 'system', content: resolution.handoff };
        const out = [injected, ...messages];
        return { messages: out, breakdown: [{ messageIndex: 0, name: 'Story Engine · Scene Resolution' }] };
    }, 70);
    interceptorRegistered = true;
    spindle.log?.info?.('Story Engine interceptor registered');
}
function registerGenerationEvents() {
    if (generationEventsRegistered || !has('generation'))
        return;
    spindle.on('GENERATION_STARTED', (payload) => { if (payload?.chatId && payload?.generationId)
        pendingGenerationByChat.set(String(payload.chatId), String(payload.generationId)); });
    spindle.on('GENERATION_STOPPED', async (payload) => {
        const chatId = String(payload?.chatId || '');
        if (!chatId)
            return;
        const state = await loadState(chatId);
        if (state.pending) {
            state.pending = null;
            await saveState(chatId, state);
        }
        pendingGenerationByChat.delete(chatId);
    });
    spindle.on('GENERATION_ENDED', async (payload) => {
        const chatId = String(payload?.chatId || '');
        const messageId = String(payload?.messageId || '');
        if (!chatId || !messageId || payload?.error) {
            if (chatId)
                pendingGenerationByChat.delete(chatId);
            return;
        }
        try {
            await finalizeGeneration(chatId, messageId, String(payload?.generationId || ''), String(payload?.content || ''));
        }
        catch (err) {
            spindle.log?.error?.(`Story Engine finalizer failed: ${String(err)}`);
            spindle.toast?.error?.('The reply was generated, but Story Engine could not finalize its tracker state.');
        }
        finally {
            pendingGenerationByChat.delete(chatId);
        }
    });
    generationEventsRegistered = true;
}
async function finalizeGeneration(chatId, messageId, generationId, rawContent) {
    const settings = await loadSettings();
    let state = await loadState(chatId);
    const resolution = state.pending;
    if (!settings.enabled || !resolution)
        return;
    let content = stripStructuredArtifacts(rawContent);
    const findings = collectProseFindings(content, settings.proseGuardExtraPhrases);
    if (content !== rawContent && has('chat_mutation'))
        await spindle.chat.updateMessage(chatId, messageId, { content, metadata: { story_engine_sanitized: true } });
    if (settings.proseGuardMode === 'automatic' && findings.length && has('generation') && has('chat_mutation')) {
        const repaired = await repairProse(content, findings, settings);
        if (repaired && repaired !== content) {
            content = repaired;
            await spindle.chat.updateMessage(chatId, messageId, { content, metadata: { story_engine_prose_guard: 'automatic' } });
        }
        state.proseReview = null;
    }
    else if (settings.proseGuardMode === 'review' && findings.length) {
        state.proseReview = { messageId, content, findings };
    }
    else
        state.proseReview = null;
    // Restore the pre-turn snapshot on swipe/regenerate, then re-commit the identical dice result.
    if (resolution.replay && state.rollback?.fingerprint === resolution.fingerprint) {
        state = restoreCoreSnapshot(state, state.rollback.base);
    }
    else
        state.rollback = { fingerprint: resolution.fingerprint, base: makeCoreSnapshot(state) };
    const notes = commitResolution(state, resolution, settings, chatId);
    if (settings.trackerPostPass && has('generation')) {
        try {
            const delta = await extractPostTurnDelta(state, resolution, content, settings);
            applyPostTurnDelta(state, delta, notes);
        }
        catch (err) {
            notes.push(`Post-turn archivist skipped: ${String(err)}`);
        }
    }
    state.pending = null;
    state.lastResolution = { ...resolution, replay: false };
    const existing = state.audits.filter(a => !(resolution.replay && a.fingerprint === resolution.fingerprint));
    existing.push({ turn: resolution.turn, turnId: resolution.turnId, fingerprint: resolution.fingerprint, createdAt: resolution.createdAt, finalizedAt: Date.now(), generationId, messageId, summary: resolution.semantic.summary, rolls: resolution.rolls, xpAward: resolution.xpAward, proseFindings: findings, notes });
    state.audits = existing;
    await saveState(chatId, state);
    if (has('chat_mutation')) {
        await spindle.chat.updateMessage(chatId, messageId, { metadata: { story_engine: { turn: resolution.turn, turnId: resolution.turnId, fingerprint: resolution.fingerprint, rolls: resolution.rolls.map(r => ({ label: r.label, tier: r.outcomeTier, margin: r.margin })), proseGuard: settings.proseGuardMode, findings: findings.length } } });
    }
}
function commitResolution(state, resolution, settings, chatId) {
    const notes = [];
    const seed = `${chatId}|${resolution.turn}|${resolution.fingerprint}`;
    state.turn = resolution.turn;
    for (const actor of resolution.semantic.actors) {
        const rank = rankFromCapabilityPool(actor.capabilityPool, seed, actor.name, actor.rank);
        const npc = ensureNpc(state, actor.name, rank, actor.role, seed, actor.mainStat);
        npc.companion = npc.companion || actor.companion;
        npc.powerActor = npc.powerActor || actor.powerActor;
    }
    const beforeDay = state.world.dayIndex;
    notes.push(...applyWorldSemantic(state, resolution.semantic, seed));
    if (state.world.dayIndex > beforeDay) {
        applyNaturalRecovery(state, state.world.dayIndex - beforeDay);
        notes.push(`Natural recovery applied for ${state.world.dayIndex - beforeDay} day(s).`);
    }
    notes.push(...updateRelationships(state, resolution.semantic, resolution.rolls, seed));
    notes.push(...applyContinuitySemantic(state, resolution.semantic));
    applyHealthEvents(state, resolution.healthEvents);
    notes.push(...applyTransaction(state, resolution.semantic.transaction));
    if (settings.powerActors)
        notes.push(...applyPowerActorSignals(state, resolution.semantic));
    state.names.used = [...new Set([...state.names.used, ...resolution.generatedNames])];
    if (settings.progression && resolution.xpAward > 0) {
        state.progression.xp += resolution.xpAward;
        state.progression.history.push({ turn: state.turn, amount: resolution.xpAward, reason: resolution.semantic.summary || 'successful challenge' });
        const earned = Math.floor(state.progression.xp / XP_MILESTONE);
        state.progression.pendingMilestones = Math.max(0, earned - state.progression.milestonesClaimed);
        notes.push(`XP +${resolution.xpAward}; ${state.progression.pendingMilestones} milestone(s) pending.`);
    }
    if (resolution.lootResult?.status === 'ok' && resolution.lootResult.target) {
        const npc = state.npcs[resolution.lootResult.target];
        if (npc)
            npc.lootSearchCompleted = true;
        notes.push(`Loot envelope resolved for ${resolution.lootResult.target}; corpse search marked complete and possession is not automatic.`);
    }
    else if (resolution.lootResult && resolution.lootResult.status !== 'ok')
        notes.push(`Loot search status: ${resolution.lootResult.status}.`);
    return notes;
}
async function repairProse(content, findings, settings) {
    try {
        const result = await spindle.generate.quiet({ messages: [{ role: 'user', content: proseRepairPrompt(content, findings) }], parameters: { temperature: 0.1, max_tokens: Math.max(600, Math.ceil(content.length / 2)) }, connection_id: settings.proseGuardConnectionId || settings.semanticConnectionId || undefined, reasoning: { enabled: false } });
        const repaired = stripStructuredArtifacts(String(result?.content || '')).trim();
        if (!repaired)
            return content;
        if (repaired.length < content.length * .55 || repaired.length > content.length * 1.55)
            return content;
        return repaired;
    }
    catch (err) {
        spindle.log?.warn?.(`Prose repair failed: ${String(err)}`);
        return content;
    }
}
async function extractPostTurnDelta(state, resolution, narration, settings) {
    const result = await spindle.generate.quiet({ messages: buildPostTurnPrompt(state, resolution, narration), tools: [postTurnTool()], parameters: { temperature: 0.1, max_tokens: 1800 }, connection_id: settings.semanticConnectionId || undefined, reasoning: { enabled: false } });
    const call = result?.tool_calls?.find((x) => x?.name === 'submit_post_turn_delta') || result?.tool_calls?.[0];
    return call?.args ?? parseJsonContent(result?.content) ?? {};
}
function applyPostTurnDelta(state, delta, notes) {
    const d = object(delta);
    for (const f of Array.isArray(d.facts) ? d.facts : []) {
        const o = object(f);
        if (text(o.fact))
            addMemoryFact(state, text(o.fact), ['scene', 'location', 'world', 'user', 'npc'].includes(String(o.scope)) ? o.scope : 'world', text(o.subject) || undefined, Math.max(1, Math.min(5, Number(o.salience || 2))));
    }
    for (const u of Array.isArray(d.npcUpdates) ? d.npcUpdates : []) {
        const o = object(u);
        const name = text(o.name);
        if (!name)
            continue;
        const renameFrom = text(o.renameFrom);
        if (renameFrom && renameFrom !== name && state.npcs[renameFrom]) {
            const source = state.npcs[renameFrom];
            const target = state.npcs[name];
            state.npcs[name] = target ? { ...source, ...target, name, notes: [...source.notes, ...target.notes].slice(-20) } : { ...source, name };
            delete state.npcs[renameFrom];
            if (state.health.npcs[renameFrom]) {
                state.health.npcs[name] = state.health.npcs[name] ?? state.health.npcs[renameFrom];
                delete state.health.npcs[renameFrom];
            }
            for (const plan of state.world.plans)
                if (plan.actor === renameFrom)
                    plan.actor = name;
            state.names.used = [...new Set([...state.names.used, name])];
            if (state.continuity.boundCompanion.name === renameFrom)
                state.continuity.boundCompanion.name = name;
            if (state.continuity.pendingBoundary.targetNpc === renameFrom)
                state.continuity.pendingBoundary.targetNpc = name;
            for (const t of [...state.continuity.latentFavors, ...state.continuity.latentGrievances])
                if (t.actor === renameFrom)
                    t.actor = name;
            for (const arc of state.continuity.worldArcs)
                if (arc.actor === renameFrom)
                    arc.actor = name;
            if (state.continuity.rapportClocks[renameFrom]) {
                state.continuity.rapportClocks[name] = state.continuity.rapportClocks[name] ?? state.continuity.rapportClocks[renameFrom];
                delete state.continuity.rapportClocks[renameFrom];
            }
            for (const d of state.continuity.descriptiveArchive)
                if (d.label === renameFrom && !d.promotedName)
                    d.promotedName = name;
            notes.push(`Tracker name promoted: ${renameFrom} -> ${name}.`);
        }
        const npc = ensureNpc(state, name, 'Average', text(o.role) || 'NPC', `post|${state.turn}`);
        if (text(o.role))
            npc.role = text(o.role);
        if (['active', 'inactive', 'dead'].includes(String(o.status)))
            npc.status = o.status;
        if (typeof o.companion === 'boolean')
            npc.companion = o.companion;
        if (typeof o.powerActor === 'boolean')
            npc.powerActor = o.powerActor;
        if (text(o.personalityArchetype))
            npc.personalityArchetype = text(o.personalityArchetype).slice(0, 80);
        if (text(o.personalitySummary))
            npc.personalitySummary = text(o.personalitySummary).slice(0, 500);
        if (text(o.note))
            npc.notes = [...npc.notes, text(o.note)].slice(-20);
        enforceRelationshipInvariants(npc);
    }
    for (const r of Array.isArray(d.reputation) ? d.reputation : []) {
        const o = object(r), loc = text(o.location);
        if (!loc)
            continue;
        let entry = state.reputation.find(x => x.location.toLowerCase() === loc.toLowerCase());
        if (!entry) {
            entry = { location: loc, fame: 0, infamy: 0, fear: 0, notes: [] };
            state.reputation.push(entry);
        }
        entry.fame = Math.max(-20, Math.min(20, entry.fame + Number(o.fameDelta || 0)));
        entry.infamy = Math.max(-20, Math.min(20, entry.infamy + Number(o.infamyDelta || 0)));
        entry.fear = Math.max(-20, Math.min(20, entry.fear + Number(o.fearDelta || 0)));
        if (text(o.note))
            entry.notes = [...entry.notes, text(o.note)].slice(-12);
    }
    for (const k of Array.isArray(d.knowledge) ? d.knowledge : [])
        upsertKnowledge(state, k);
    for (const a of Array.isArray(d.descriptions) ? d.descriptions : [])
        archiveDescription(state, a);
    for (const id of Array.isArray(d.resolvedBoundaryIds) ? d.resolvedBoundaryIds : [])
        resolveBoundary(state, String(id));
    if (d.transaction)
        notes.push(...applyTransaction(state, d.transaction));
    const completed = new Set(Array.isArray(d.completedPlanIds) ? d.completedPlanIds.map(String) : []);
    for (const p of state.world.plans)
        if (completed.has(p.id)) {
            p.status = 'completed';
            consumeThreadsForActor(state, p.actor);
            for (const arc of state.continuity.worldArcs)
                if (arc.actor === p.actor && arc.status === 'active')
                    arc.status = 'completed';
        }
}
async function activeChatId() {
    try {
        const chat = await spindle.chats.getActive();
        return String(chat?.id || chat?.chat_id || '');
    }
    catch {
        return '';
    }
}
async function dashboardPayload() {
    const settings = await loadSettings();
    const chatId = await activeChatId();
    const state = chatId ? await loadState(chatId) : createDefaultState();
    let connections = [];
    try {
        const r = await spindle.connections.list();
        connections = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
    }
    catch { }
    let persona = null;
    try {
        persona = await spindle.personas.getActive();
    }
    catch { }
    return { type: 'dashboard', chatId, settings, state, connections: connections.map((c) => ({ id: c.id || c.connection_id, name: c.name || c.label || c.model || c.id })), activePersona: persona ? { id: persona.id, name: persona.name, title: persona.title } : null };
}
async function sendDashboard(userId) { const payload = await dashboardPayload(); if (userId)
    spindle.sendToFrontend(payload, userId);
else
    spindle.sendToFrontend(payload); }
function registerFrontend() {
    if (frontendRegistered)
        return;
    spindle.onFrontendMessage(async (payload, userId) => {
        try {
            const type = String(payload?.type || '');
            if (type === 'get_dashboard') {
                await sendDashboard(userId);
                return;
            }
            if (type === 'save_settings') {
                const current = await loadSettings();
                await saveSettings(normalizeSettings({ ...current, ...object(payload.settings) }));
                spindle.toast?.success?.('Story Engine settings saved.');
                await sendDashboard(userId);
                return;
            }
            const chatId = String(payload?.chatId || await activeChatId());
            if (type === 'reset_chat_state') {
                if (!chatId)
                    throw new Error('Open a chat first.');
                await saveState(chatId, createDefaultState());
                spindle.toast?.success?.('Story Engine state reset for this chat.');
                await sendDashboard(userId);
                return;
            }
            if (type === 'create_player') {
                if (!chatId)
                    throw new Error('Open a chat first.');
                await handleCreatePlayer(chatId, payload, userId);
                return;
            }
            if (type === 'start_adventure') {
                if (!chatId)
                    throw new Error('Open a chat first.');
                if (!has('chat_mutation'))
                    throw new Error('chat_mutation permission is required.');
                await spindle.chat.appendMessage(chatId, { role: 'user', content: 'Begin the adventure at the first concrete moment where I can act.', metadata: { story_engine_start: true } }, true);
                return;
            }
            if (type === 'get_progression_options') {
                if (!chatId)
                    throw new Error('Open a chat first.');
                await handleProgressionOptions(chatId, userId);
                return;
            }
            if (type === 'claim_milestone') {
                if (!chatId)
                    throw new Error('Open a chat first.');
                await handleClaimMilestone(chatId, payload, userId);
                return;
            }
            if (type === 'apply_prose_suggestion') {
                if (!chatId)
                    throw new Error('Open a chat first.');
                await handleApplyProseSuggestion(chatId, payload, userId);
                return;
            }
            if (type === 'dismiss_prose_review') {
                if (!chatId)
                    return;
                const s = await loadState(chatId);
                s.proseReview = null;
                await saveState(chatId, s);
                await sendDashboard(userId);
                return;
            }
        }
        catch (err) {
            spindle.log?.error?.(`Frontend command failed: ${String(err)}`);
            spindle.toast?.error?.(err instanceof Error ? err.message : String(err));
            spindle.sendToFrontend({ type: 'command_error', error: err instanceof Error ? err.message : String(err) }, userId);
        }
    });
    frontendRegistered = true;
}
async function handleCreatePlayer(chatId, payload, userId) {
    if (!has('generation'))
        throw new Error('generation permission is required.');
    const input = payload.input;
    const errors = validateCharacterInput(input);
    if (errors.length)
        throw new Error(errors.join(' '));
    let persona = null;
    try {
        persona = await spindle.personas.getActive();
    }
    catch { }
    const existing = payload.applyMode === 'convert_active' ? String(persona?.description || '') : '';
    const result = await spindle.generate.quiet({ messages: buildCharacterPrompt(input, existing), tools: [characterTool()], parameters: { temperature: .35, max_tokens: 2200 }, connection_id: (await loadSettings()).semanticConnectionId || undefined, reasoning: { enabled: false } });
    const call = result?.tool_calls?.find((x) => x?.name === 'submit_character_sheet') || result?.tool_calls?.[0];
    const sheet = normalizeCharacterSheet(call?.args ?? parseJsonContent(result?.content) ?? {}, input);
    const state = await loadState(chatId);
    applyPlayerToState(state, sheet);
    await saveState(chatId, state);
    const description = renderPersonaDescription(sheet);
    if (payload.applyMode === 'convert_active' && persona && has('personas'))
        await spindle.personas.update(persona.id, { description, metadata: { ...(persona.metadata || {}), story_engine: { sheetVersion: 1, genre: sheet.genre } } });
    else if (payload.applyMode === 'new_persona' && has('personas')) {
        const created = await spindle.personas.create({ name: sheet.name, title: `${sheet.race} · ${sheet.genre}`, description, folder: 'Story Engine', metadata: { story_engine: { sheetVersion: 1, genre: sheet.genre } } });
        await spindle.personas.switchActive(created.id);
    }
    spindle.toast?.success?.('Player sheet created.');
    spindle.sendToFrontend({ type: 'player_created', sheet }, userId);
    await sendDashboard(userId);
}
async function handleProgressionOptions(chatId, userId) {
    const state = await loadState(chatId);
    if (!state.player)
        throw new Error('Create a player sheet first.');
    if (state.progression.pendingMilestones <= 0)
        throw new Error('No progression milestone is pending.');
    const tool = { name: 'submit_progression_options', description: 'Return three distinct ability options and three spell options suitable for the player progression milestone.', parameters: { type: 'object', additionalProperties: false, properties: { abilities: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } }, spells: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } } }, required: ['abilities', 'spells'] } };
    const result = await spindle.generate.quiet({ messages: [{ role: 'system', content: 'Design grounded progression choices for the existing character. Options should extend established themes without sudden unrelated powers. Abilities are useful capabilities, never automatic success. Spells should be bounded and setting-consistent. Call submit_progression_options once.' }, { role: 'user', content: renderPersonaDescription(state.player) }], tools: [tool], parameters: { temperature: .65, max_tokens: 900 }, connection_id: (await loadSettings()).semanticConnectionId || undefined, reasoning: { enabled: false } });
    const call = result?.tool_calls?.find((x) => x?.name === 'submit_progression_options') || result?.tool_calls?.[0];
    const o = object(call?.args ?? parseJsonContent(result?.content));
    spindle.sendToFrontend({ type: 'progression_options', abilities: Array.isArray(o.abilities) ? o.abilities : [], spells: Array.isArray(o.spells) ? o.spells : [] }, userId);
}
async function handleClaimMilestone(chatId, payload, userId) {
    const state = await loadState(chatId);
    if (!state.player)
        throw new Error('Create a player sheet first.');
    if (state.progression.pendingMilestones <= 0)
        throw new Error('No milestone is pending.');
    const stat = String(payload.stat || '');
    if (!['PHY', 'MND', 'CHA'].includes(stat))
        throw new Error('Choose PHY, MND, or CHA.');
    if (state.player.stats[stat] >= PROGRESSION_MAX_STAT)
        throw new Error(`${stat} is already at the progression cap.`);
    const ability = text(payload.ability);
    if (!ability)
        throw new Error('Choose or enter one ability.');
    state.player.stats[stat] += 1;
    if (!state.player.abilities.some(a => a.toLowerCase() === ability.toLowerCase()))
        state.player.abilities.push(ability);
    const spell = text(payload.spell);
    if (spell && state.player.spells.length < 5 && !state.player.spells.some(s => s.toLowerCase() === spell.toLowerCase()))
        state.player.spells.push(spell);
    state.progression.milestonesClaimed += 1;
    state.progression.pendingMilestones = Math.max(0, state.progression.pendingMilestones - 1);
    state.progression.level += 1;
    increaseMilestoneHealth(state, Object.values(state.npcs).filter(n => n.companion).map(n => n.name));
    await saveState(chatId, state);
    try {
        const persona = await spindle.personas.getActive();
        if (persona && has('personas'))
            await spindle.personas.update(persona.id, { description: renderPersonaDescription(state.player), metadata: { ...(persona.metadata || {}), story_engine: { sheetVersion: 1, genre: state.player.genre, level: state.progression.level } } });
    }
    catch { }
    spindle.toast?.success?.(`Level ${state.progression.level} milestone applied.`);
    await sendDashboard(userId);
}
async function handleApplyProseSuggestion(chatId, payload, userId) {
    const state = await loadState(chatId);
    const review = state.proseReview;
    if (!review)
        throw new Error('No prose review is pending.');
    if (!has('chat_mutation'))
        throw new Error('chat_mutation permission is required.');
    const settings = await loadSettings();
    const repaired = review.suggested || await repairProse(review.content, review.findings, settings);
    if (repaired && repaired !== review.content)
        await spindle.chat.updateMessage(chatId, review.messageId, { content: repaired, metadata: { story_engine_prose_guard: 'review-applied' } });
    state.proseReview = null;
    await saveState(chatId, state);
    spindle.toast?.success?.('Prose repair applied.');
    await sendDashboard(userId);
}
function parseJsonContent(content) { const s = String(content || '').trim(); if (!s)
    return null; const candidates = [s, s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')]; for (const c of candidates) {
    try {
        return JSON.parse(c);
    }
    catch { }
} const start = s.indexOf('{'), end = s.lastIndexOf('}'); if (start >= 0 && end > start) {
    try {
        return JSON.parse(s.slice(start, end + 1));
    }
    catch { }
} return null; }
registerFrontend();
registerInterceptor();
registerGenerationEvents();
try {
    spindle.permissions?.onChanged?.(({ permission, granted }) => { if (!granted)
        return; if (permission === 'interceptor')
        registerInterceptor(); if (permission === 'generation')
        registerGenerationEvents(); });
}
catch { }
spindle.log?.info?.('Story Engine for Lumiverse loaded');
