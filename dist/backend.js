import { DEFAULT_SETTINGS, SETTINGS_GLOBAL_KEY, STATE_CHAT_KEY, LEGACY_STATE_CHAT_KEYS, XP_MILESTONE, PROGRESSION_MAX_STAT } from './core/config.js';
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
import { applyProseRepairPayload, buildProseRepairCases, collectProseFindings, proseRepairPrompt, proseRepairTool, stripStructuredArtifacts } from './core/prose.js';
import { applyPlayerToState, buildCharacterPrompt, buildPersonaConversionPrompt, characterTool, normalizeCharacterSheet, normalizeConvertedPersonaSheet, renderPersonaDescription, validateCharacterInput, normalizeStartingStatBudget } from './core/character.js';
import { applyMutationBatch, bootstrapAssistantPrompt, commandAssistantPrompt, extractOocCommands, mutationTool, normalizeMutationBatch, stripOocCommands } from './core/commands.js';
const pendingGenerationByChat = new Map();
const activeChatByUser = new Map();
const activePersonaByUser = new Map();
const userByChat = new Map();
const bootstrapInFlight = new Set();
let interceptorRegistered = false;
let generationEventsRegistered = false;
let frontendRegistered = false;
let chatEventsRegistered = false;
function has(permission) { try {
    return spindle.permissions?.has ? spindle.permissions.has(permission) : true;
}
catch {
    return false;
} }
function errorMessage(err) { return err instanceof Error ? err.message : String(err || ''); }
async function quietForUser(input, userId) {
    if (!userId)
        return spindle.generate.quiet(input);
    // Lumiverse's published GenerationRequestDTO currently omits userId, while real
    // operator-scoped runtimes can require it. Carry it both in the request and as the
    // legacy/scoped second argument so either runtime shape has the originating user.
    const scoped = { ...input, userId };
    try {
        return await spindle.generate.quiet(scoped, userId);
    }
    catch (err) {
        const message = errorMessage(err);
        // A scope failure happens before provider dispatch, so a single raw-provider
        // retry is safe and covers runtimes whose quiet wrapper does not forward userId.
        if (/userId is required for operator-scoped extensions/i.test(message) && typeof spindle.generate?.raw === 'function') {
            return spindle.generate.raw(scoped, userId);
        }
        // Older strict DTO validators may reject the extra field while accepting the
        // second scoped argument.
        if (/(?:unknown|unexpected|unrecognized|additional).*userId/i.test(message)) {
            return spindle.generate.quiet(input, userId);
        }
        throw err;
    }
}
function extraArgRejected(err) {
    return /(?:too many|unexpected|unknown|unrecognized|additional|invalid|expected).*argument|argument.*(?:unexpected|unknown|invalid|expected)|takes?\s+\d+.*argument/i.test(errorMessage(err));
}
async function getPersonaForUser(personaId, userId) {
    if (!personaId)
        return null;
    if (userId) {
        try {
            return await spindle.personas.get(personaId, userId);
        }
        catch (err) {
            if (!extraArgRejected(err) && !/userId/i.test(errorMessage(err)))
                return null;
        }
    }
    try {
        return await spindle.personas.get(personaId);
    }
    catch {
        return null;
    }
}
async function getActivePersonaForUser(userId, hintPersonaId = '') {
    const hinted = String(hintPersonaId || '').trim();
    if (hinted) {
        const byId = await getPersonaForUser(hinted, userId);
        if (byId) {
            if (userId)
                activePersonaByUser.set(userId, byId);
            return byId;
        }
    }
    try {
        // Real operator-scoped Lumiverse runtimes can require the originating user
        // even though the generic Persona docs show getActive() without parameters.
        const persona = userId ? await spindle.personas.getActive(userId) : await spindle.personas.getActive();
        if (persona) {
            if (userId)
                activePersonaByUser.set(userId, persona);
            return persona;
        }
    }
    catch (err) {
        if (userId && extraArgRejected(err)) {
            try {
                const persona = await spindle.personas.getActive();
                if (persona) {
                    activePersonaByUser.set(userId, persona);
                    return persona;
                }
            }
            catch { }
        }
    }
    // A transient null must not erase a persona learned from the frontend's
    // activePersonaId setting or PERSONA_CHANGED event.
    return userId && activePersonaByUser.has(userId) ? activePersonaByUser.get(userId) ?? null : null;
}
async function createPersonaForUser(input, userId) {
    if (userId) {
        try {
            return await spindle.personas.create(input, userId);
        }
        catch (err) {
            if (!extraArgRejected(err))
                throw err;
        }
    }
    return spindle.personas.create(input);
}
async function switchActivePersonaForUser(personaId, userId) {
    if (userId) {
        try {
            await spindle.personas.switchActive(personaId, userId);
        }
        catch (err) {
            if (extraArgRejected(err))
                await spindle.personas.switchActive(personaId);
            else
                throw err;
        }
    }
    else
        await spindle.personas.switchActive(personaId);
    if (userId) {
        if (personaId) {
            const p = await getPersonaForUser(personaId, userId);
            if (p)
                activePersonaByUser.set(userId, p);
        }
        else
            activePersonaByUser.set(userId, null);
    }
}
async function updatePersonaForUser(personaId, input, userId) {
    if (userId) {
        try {
            return await spindle.personas.update(personaId, input, userId);
        }
        catch (err) {
            if (!extraArgRejected(err))
                throw err;
        }
    }
    return spindle.personas.update(personaId, input);
}
async function loadSettings(userId) {
    if (userId) {
        try {
            const stored = await spindle.userStorage.getJson('settings.json', { fallback: null, userId });
            if (stored)
                return normalizeSettings(stored);
        }
        catch (err) {
            spindle.log?.warn?.(`Story Engine user settings read failed: ${String(err)}`);
        }
    }
    // Backward-compatible fallback for user-scoped installs / legacy settings.
    try {
        const raw = await spindle.variables.global.get(SETTINGS_GLOBAL_KEY);
        return raw ? normalizeSettings(JSON.parse(raw)) : normalizeSettings(DEFAULT_SETTINGS);
    }
    catch {
        return normalizeSettings(DEFAULT_SETTINGS);
    }
}
async function saveSettings(settings, userId) {
    const normalized = normalizeSettings(settings);
    if (userId) {
        await spindle.userStorage.setJson('settings.json', normalized, { indent: 2, userId });
        return;
    }
    await spindle.variables.global.set(SETTINGS_GLOBAL_KEY, JSON.stringify(normalized));
}
function userForChat(chatId, explicit) { const id = String(explicit || '').trim(); if (id) {
    userByChat.set(chatId, id);
    activeChatByUser.set(id, chatId);
    return id;
} return userByChat.get(chatId); }
async function resolveConnectionId(primary, secondary = '', runtime = '', userId) {
    const seen = new Set();
    for (const id of [primary, secondary, runtime].map(x => String(x || '').trim()).filter(Boolean)) {
        if (seen.has(id))
            continue;
        seen.add(id);
        try {
            const conn = await spindle.connections.get(id, userId || undefined);
            if (conn && conn.has_api_key !== false)
                return id;
        }
        catch { }
    }
    // Do not rely on an implicit host "current connection". An extension can inspect
    // the user's profiles, so prefer the configured default and then any usable profile.
    try {
        const raw = await spindle.connections.list(userId || undefined);
        const profiles = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
        const usable = profiles.filter((c) => String(c?.id || c?.connection_id || '').trim() && c?.has_api_key !== false);
        const fallback = usable.find((c) => c?.is_default) || usable[0];
        return fallback ? String(fallback.id || fallback.connection_id) : undefined;
    }
    catch {
        return undefined;
    }
}
function requireConnection(id, purpose) {
    if (id)
        return id;
    throw new Error(`No usable Lumiverse connection profile is available for ${purpose}. Configure a profile with an API key in Connections, or select one in Story Engine Settings.`);
}
async function loadState(chatId) {
    try {
        const raw = await spindle.variables.chat.get(chatId, STATE_CHAT_KEY);
        if (raw)
            return normalizeState(JSON.parse(raw));
        for (const legacyKey of LEGACY_STATE_CHAT_KEYS) {
            const legacy = await spindle.variables.chat.get(chatId, legacyKey);
            if (legacy) {
                const migrated = normalizeState(JSON.parse(legacy));
                await spindle.variables.chat.set(chatId, STATE_CHAT_KEY, JSON.stringify(pruneState(migrated)));
                return migrated;
            }
        }
        return createDefaultState();
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
function historyBeforeLatestUser(messages, count) {
    let idx = messages.length;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.role === 'user') {
            idx = i;
            break;
        }
    }
    return compactHistory(messages.slice(0, idx), count);
}
function replaceLatestUserText(messages, replacement) {
    const out = messages.map(m => ({ ...m }));
    for (let i = out.length - 1; i >= 0; i--) {
        if (out[i]?.role === 'user') {
            out[i] = { ...out[i], content: replacement };
            break;
        }
    }
    return out;
}
function storyDataContext(state) {
    const data = { turn: state.turn, player: state.player, npcs: state.npcs, health: state.health, world: state.world, reputation: state.reputation, progression: state.progression, economy: state.economy, names: state.names, continuity: state.continuity };
    const json = JSON.stringify(data, null, 2);
    return json.length <= 36000 ? json : `${buildStateContext(state)}\n\n[Full state omitted from prompt because it is very large; use the tracker summary above.]`;
}
async function runMutationAssistant(messages, toolName, connectionId, userId) {
    const result = await quietForUser({ messages, tools: [mutationTool(toolName)], parameters: { temperature: 0.05, max_tokens: 3200 }, connection_id: connectionId || undefined, reasoning: { source: 'off' } }, userId);
    const call = result?.tool_calls?.find((x) => x?.name === toolName) || result?.tool_calls?.[0];
    const payload = call?.args ?? parseJsonContent(result?.content);
    if (!payload)
        throw new Error(`No structured payload returned by ${toolName}.`);
    return normalizeMutationBatch(payload);
}
async function applyOocCommands(chatId, commands, messages, settings, state, context, fingerprint) {
    const existing = state.commandHistory.find(x => x.fingerprint === fingerprint);
    if (existing)
        return { state, summary: existing.summary, replayed: true };
    if (!has('generation'))
        throw new Error('generation permission is required for OOC commands.');
    const commandConnection = requireConnection(await resolveConnectionId(settings.commandConnectionId, settings.semanticConnectionId, context?.connectionId || '', context?.userId), 'OOC Command Assistant');
    const batch = await runMutationAssistant(commandAssistantPrompt(commands, storyDataContext(state), historyBeforeLatestUser(messages, Math.max(8, settings.recentMessageCount))), 'apply_story_state_changes', commandConnection, context?.userId || userByChat.get(chatId));
    const applied = applyMutationBatch(state, batch);
    applied.state.commandHistory.push({ fingerprint, createdAt: Date.now(), commands: [...commands], summary: batch.summary || 'OOC command applied.', operations: batch.operations });
    await saveState(chatId, applied.state);
    return { state: applied.state, summary: batch.summary || 'OOC command applied.', replayed: false };
}
function splitTranscript(messages, maxChars = 26000) {
    const chunks = [];
    let current = '';
    const push = (piece) => { if (current && current.length + piece.length > maxChars) {
        chunks.push(current);
        current = '';
    } if (piece.length <= maxChars) {
        current += piece;
        return;
    } for (let i = 0; i < piece.length; i += maxChars) {
        if (current) {
            chunks.push(current);
            current = '';
        }
        chunks.push(piece.slice(i, i + maxChars));
    } };
    for (let i = 0; i < messages.length; i++) {
        const role = String(messages[i]?.role || 'unknown').toUpperCase();
        const content = textContent(messages[i]?.content);
        push(`\n\n[${i + 1} ${role}]\n${content}`);
    }
    if (current)
        chunks.push(current);
    return chunks.filter(Boolean);
}
function bootstrapEligible(state) { return state.bootstrap.status !== 'ready' && state.turn === 0 && state.audits.length === 0; }
async function bootstrapExistingChat(chatId, userId, force = false) {
    if (bootstrapInFlight.has(chatId))
        return;
    const settings = await loadSettings(userId);
    if (!has('generation') || !has('chat_mutation'))
        return;
    let state = await loadState(chatId);
    if (!force && !bootstrapEligible(state))
        return;
    let messages = [];
    try {
        messages = await spindle.chat.getMessages(chatId);
    }
    catch (err) {
        const msg = `History read failed: ${errorMessage(err)}`;
        state.bootstrap = { status: 'failed', sourceMessageCount: 0, error: msg };
        await saveState(chatId, state);
        spindle.log?.warn?.(`History import could not read chat ${chatId}: ${String(err)}`);
        if (force)
            spindle.toast?.error?.('Story Engine could not read the existing chat history.');
        if (userId)
            await sendDashboard(userId, chatId, false);
        return;
    }
    if (!force && messages.length < 3) {
        // A new/short chat is already attached: there simply is not enough prior RP to reconstruct.
        state.bootstrap = { status: 'ready', sourceMessageCount: messages.length, importedAt: Date.now(), lastMessageId: String(messages.at(-1)?.id || '') || undefined };
        await saveState(chatId, state);
        if (userId)
            await sendDashboard(userId, chatId, false);
        return;
    }
    bootstrapInFlight.add(chatId);
    state.bootstrap = { status: 'importing', sourceMessageCount: messages.length, lastMessageId: String(messages.at(-1)?.id || '') || undefined };
    await saveState(chatId, state);
    if (userId)
        await sendDashboard(userId, chatId, false);
    let importStage = 'persona context';
    try {
        let persona = null;
        try {
            persona = await getActivePersonaForUser(userId);
        }
        catch { }
        const personaContext = persona ? `Name: ${persona.name || ''}\nTitle: ${persona.title || ''}\nDescription:\n${persona.description || ''}` : '';
        const chunks = splitTranscript(messages);
        importStage = 'connection resolution';
        const bootstrapConnection = requireConnection(await resolveConnectionId(settings.bootstrapConnectionId, settings.semanticConnectionId, '', userId), 'History Import Assistant');
        for (let i = 0; i < chunks.length; i++) {
            importStage = `assistant generation ${i + 1}/${chunks.length}`;
            const batch = await runMutationAssistant(bootstrapAssistantPrompt(chunks[i], storyDataContext(state), personaContext, i + 1, chunks.length), 'apply_story_history_import', bootstrapConnection, userId);
            const hadPlayer = Boolean(state.player);
            state = applyMutationBatch(state, batch).state;
            if (!hadPlayer && state.player)
                state.player.stats = normalizeStartingStatBudget(state.player.stats);
            state.bootstrap = { status: 'importing', sourceMessageCount: messages.length, lastMessageId: String(messages.at(-1)?.id || '') || undefined };
            await saveState(chatId, state);
        }
        state.bootstrap = { status: 'ready', sourceMessageCount: messages.length, importedAt: Date.now(), lastMessageId: String(messages.at(-1)?.id || '') || undefined };
        await saveState(chatId, state);
        if (force)
            spindle.toast?.success?.(`Story Engine imported ${messages.length} existing message(s).`);
    }
    catch (err) {
        state = await loadState(chatId);
        const detail = errorMessage(err);
        state.bootstrap = { status: 'failed', sourceMessageCount: messages.length, lastMessageId: String(messages.at(-1)?.id || '') || undefined, error: `${importStage}: ${detail}` };
        await saveState(chatId, state);
        spindle.log?.error?.(`History import failed for ${chatId} during ${importStage}: ${String(err)}`);
        if (force)
            spindle.toast?.error?.('Story Engine could not import the existing chat history. Open Story Engine for details.');
    }
    finally {
        bootstrapInFlight.delete(chatId);
        if (userId)
            await sendDashboard(userId, chatId, false);
    }
}
async function extractSemantic(messages, context, settings, state, userText) {
    if (!settings.semanticEnabled || !has('generation'))
        return fallbackSemanticLedger(userText);
    const prompts = buildSemanticPrompt({ userMessage: userText, history: compactHistory(messages, settings.recentMessageCount), stateContext: buildStateContext(state) });
    try {
        const semanticConnection = await resolveConnectionId(settings.semanticConnectionId, '', context?.connectionId || '', context?.userId);
        if (!semanticConnection) {
            spindle.log?.warn?.('Semantic preflight has no usable connection profile; using conservative local fallback.');
            return fallbackSemanticLedger(userText);
        }
        const result = await quietForUser({ messages: prompts, tools: [semanticTool()], parameters: { temperature: settings.semanticTemperature, max_tokens: 2400 }, connection_id: semanticConnection, reasoning: { source: 'off' } }, context?.userId || userByChat.get(String(context?.chatId || '')));
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
        const chatId = String(context?.chatId || '');
        const scopedUserId = userForChat(chatId, context?.userId);
        const settings = await loadSettings(scopedUserId);
        if (!settings.enabled || context?.dryRun === true || context?.generationType === 'quiet' || context?.generationType === 'impersonate')
            return messages;
        if (!chatId)
            return messages;
        const rawUserText = lastUserText(messages);
        if (!rawUserText.trim())
            return messages;
        const fingerprint = turnFingerprint(messages, rawUserText);
        let state = await loadState(chatId);
        let workingMessages = messages;
        let userText = rawUserText;
        let commandSummary = '';
        const oocCommands = settings.oocCommandsEnabled ? extractOocCommands(rawUserText) : [];
        if (oocCommands.length) {
            try {
                const applied = await applyOocCommands(chatId, oocCommands, messages, settings, state, context, fingerprint);
                state = applied.state;
                commandSummary = applied.summary;
            }
            catch (err) {
                commandSummary = `Command Assistant error: ${err instanceof Error ? err.message : String(err)}`;
                spindle.log?.error?.(commandSummary);
                spindle.toast?.error?.(commandSummary);
            }
            userText = stripOocCommands(rawUserText);
            if (userText) {
                workingMessages = replaceLatestUserText(messages, userText);
            }
            else {
                const instruction = commandSummary.startsWith('Command Assistant error:')
                    ? 'The user sent only an OOC Story Engine command, but it could not be applied. Do not advance the roleplay. Briefly report that the OOC change failed.'
                    : 'The user sent only an OOC Story Engine command. The extension already applied it. Do not advance time, add new events, or treat the command as dialogue. Briefly acknowledge the OOC state change.';
                workingMessages = replaceLatestUserText(messages, instruction);
                return { messages: [{ role: 'system', content: `STORY ENGINE — OOC COMMAND RESULT\n${commandSummary || 'OOC command processed.'}\nThis is administrative state, not spoken dialogue.` }, ...workingMessages], breakdown: [{ messageIndex: 0, name: 'Story Engine · OOC Command' }] };
            }
        }
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
            const semantic = await extractSemantic(workingMessages, context, settings, state, userText);
            const seed = `${chatId}|${state.turn + 1}|${fingerprint}`;
            const scratch = normalizeState(JSON.parse(JSON.stringify(state)));
            resolution = resolveTurn(scratch, semantic, fingerprint, seed, { randomEvents: settings.randomEvents, randomEventChance: settings.randomEventChance, proactivity: settings.proactivity, nameStyle: settings.nameStyle });
        }
        const seed = `${chatId}|${resolution.turn}|${fingerprint}`;
        const projected = projectResolution(baseForProjection, resolution, settings, seed);
        resolution.handoff = buildNarratorHandoff(projected, resolution, settings) + (commandSummary ? `\n\nOOC ADMINISTRATIVE UPDATE\n${commandSummary}\nThe OOC text itself is not dialogue. The resulting state is already authoritative.` : '');
        state.pending = resolution;
        await saveState(chatId, state);
        const injected = { role: 'system', content: resolution.handoff };
        const out = [injected, ...workingMessages];
        return { messages: out, breakdown: [{ messageIndex: 0, name: 'Story Engine · Scene Resolution' }] };
    }, 70);
    interceptorRegistered = true;
    spindle.log?.info?.('Story Engine interceptor registered');
}
function registerGenerationEvents() {
    if (generationEventsRegistered || !has('generation'))
        return;
    spindle.on('GENERATION_STARTED', (payload, userId) => { const chatId = String(payload?.chatId || ''); if (chatId && userId)
        userForChat(chatId, userId); if (chatId && payload?.generationId)
        pendingGenerationByChat.set(chatId, String(payload.generationId)); });
    spindle.on('GENERATION_STOPPED', async (payload, userId) => {
        const chatId = String(payload?.chatId || '');
        if (!chatId)
            return;
        if (userId)
            userForChat(chatId, userId);
        const state = await loadState(chatId);
        if (state.pending) {
            state.pending = null;
            await saveState(chatId, state);
        }
        pendingGenerationByChat.delete(chatId);
    });
    spindle.on('GENERATION_ENDED', async (payload, userId) => {
        const chatId = String(payload?.chatId || '');
        const messageId = String(payload?.messageId || '');
        if (chatId && userId)
            userForChat(chatId, userId);
        if (!chatId || !messageId || payload?.error) {
            if (chatId)
                pendingGenerationByChat.delete(chatId);
            return;
        }
        try {
            await finalizeGeneration(chatId, messageId, String(payload?.generationId || ''), String(payload?.content || ''), userId);
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
async function finalizeGeneration(chatId, messageId, generationId, rawContent, eventUserId) {
    const userId = userForChat(chatId, eventUserId) || userByChat.get(chatId);
    const settings = await loadSettings(userId);
    let state = await loadState(chatId);
    const resolution = state.pending;
    if (!settings.enabled || !resolution)
        return;
    let content = stripStructuredArtifacts(rawContent);
    const findings = collectProseFindings(content, settings.proseGuardExtraPhrases);
    if (content !== rawContent && has('chat_mutation'))
        await spindle.chat.updateMessage(chatId, messageId, { content, metadata: { story_engine_sanitized: true } });
    if (settings.proseGuardMode === 'automatic' && findings.length && has('generation') && has('chat_mutation')) {
        const repaired = await repairProse(content, findings, settings, userId);
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
            const delta = await extractPostTurnDelta(state, resolution, content, settings, userId);
            applyPostTurnDelta(state, delta, notes, content, resolution);
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
async function repairProse(content, findings, settings, userId) {
    try {
        const connection = await resolveConnectionId(settings.proseGuardConnectionId, settings.semanticConnectionId, '', userId);
        if (!connection)
            return content;
        const cases = buildProseRepairCases(content, findings);
        if (!cases.length)
            return content;
        const result = await quietForUser({ messages: [{ role: 'user', content: proseRepairPrompt(content, findings) }], tools: [proseRepairTool(cases)], parameters: { temperature: 0.05, max_tokens: Math.max(500, cases.length * 120) }, connection_id: connection, reasoning: { source: 'off' } }, userId);
        const call = result?.tool_calls?.find((x) => x?.name === 'submit_prose_repairs') || result?.tool_calls?.[0];
        const payload = call?.args ?? parseJsonContent(result?.content);
        if (!payload)
            return content;
        return applyProseRepairPayload(content, cases, payload, settings.proseGuardExtraPhrases).text;
    }
    catch (err) {
        spindle.log?.warn?.(`Prose repair failed: ${String(err)}`);
        return content;
    }
}
async function extractPostTurnDelta(state, resolution, narration, settings, userId) {
    const connection = await resolveConnectionId(settings.semanticConnectionId, '', '', userId);
    if (!connection)
        return {};
    const result = await quietForUser({ messages: buildPostTurnPrompt(state, resolution, narration), tools: [postTurnTool()], parameters: { temperature: 0.1, max_tokens: 1800 }, connection_id: connection, reasoning: { source: 'off' } }, userId);
    const call = result?.tool_calls?.find((x) => x?.name === 'submit_post_turn_delta') || result?.tool_calls?.[0];
    return call?.args ?? parseJsonContent(result?.content) ?? {};
}
function applyPostTurnDelta(state, delta, notes, narration = '', resolution) {
    const d = object(delta);
    if (Array.isArray(d.presentNpcs)) {
        state.world.presentNpcs = [...new Set(d.presentNpcs.map((x) => text(x).slice(0, 120)).filter(Boolean))].slice(0, 40);
        for (const name of state.world.presentNpcs) {
            const npc = state.npcs[name];
            if (npc) {
                npc.lastSeenTurn = state.turn;
                if (npc.status === 'inactive')
                    npc.status = 'active';
            }
        }
    }
    const playerDelta = object(d.playerUpdate);
    if (state.player && Object.keys(playerDelta).length) {
        state.player.inventory = applyStringDelta(state.player.inventory, playerDelta.inventoryAdd, playerDelta.inventoryRemove, 60);
        state.player.gear = applyStringDelta(state.player.gear, playerDelta.gearAdd, playerDelta.gearRemove, 40);
        const userCap = injurySeverityCap(resolution, 'user', '');
        state.player.wounds = applyStringDelta(state.player.wounds, capPersistentEffects(playerDelta.woundsAdd, userCap), playerDelta.woundsRemove, 30);
        state.player.conditions = applyStringDelta(state.player.conditions, capPersistentEffects(playerDelta.conditionsAdd, userCap), playerDelta.conditionsRemove, 30);
        state.player.tasks = applyStringDelta(state.player.tasks, playerDelta.tasksAdd, playerDelta.tasksRemove, 40);
        state.player.commitments = applyStringDelta(state.player.commitments, playerDelta.commitmentsAdd, playerDelta.commitmentsRemove, 40);
    }
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
            state.npcs[name] = target ? { ...source, ...target, name, aliases: [...new Set([...(source.aliases || []), ...(target.aliases || []), renameFrom])].slice(-20), notes: [...source.notes, ...target.notes].slice(-20), relationshipDescriptors: [...new Set([...(source.relationshipDescriptors || []), ...(target.relationshipDescriptors || [])])].slice(-16) } : { ...source, name, aliases: [...new Set([...(source.aliases || []), renameFrom])].slice(-20) };
            delete state.npcs[renameFrom];
            if (state.health.npcs[renameFrom]) {
                state.health.npcs[name] = state.health.npcs[name] ?? state.health.npcs[renameFrom];
                delete state.health.npcs[renameFrom];
            }
            for (const plan of state.world.plans)
                if (plan.actor === renameFrom)
                    plan.actor = name;
            state.world.presentNpcs = state.world.presentNpcs.map(x => x === renameFrom ? name : x);
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
            for (const desc of state.continuity.descriptiveArchive)
                if (desc.label === renameFrom && !desc.promotedName)
                    desc.promotedName = name;
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
        if (['auto', 'nervous', 'flirt'].includes(String(o.romanceStyle)))
            npc.romanceStyle = o.romanceStyle;
        if (['none', 'aware', 'constrained'].includes(String(o.standingInfluence))) {
            npc.standingInfluence = o.standingInfluence;
            npc.standingBasis = o.standingInfluence === 'none' ? undefined : (text(o.standingBasis).slice(0, 240) || npc.standingBasis);
        }
        if (Array.isArray(o.relationshipDescriptors))
            npc.relationshipDescriptors = mergeUniqueStrings(npc.relationshipDescriptors, o.relationshipDescriptors, 16);
        if (Array.isArray(o.aliasesAdd))
            npc.aliases = mergeUniqueStrings(npc.aliases, o.aliasesAdd, 20);
        npc.inventory = applyStringDelta(npc.inventory, o.inventoryAdd, o.inventoryRemove, 60);
        npc.gear = applyStringDelta(npc.gear, o.gearAdd, o.gearRemove, 40);
        const npcCap = injurySeverityCap(resolution, 'npc', name);
        npc.wounds = applyStringDelta(npc.wounds, capPersistentEffects(o.woundsAdd, npcCap), o.woundsRemove, 30);
        npc.conditions = applyStringDelta(npc.conditions, capPersistentEffects(o.conditionsAdd, npcCap), o.conditionsRemove, 30);
        npc.currency = applyCurrencyDeltaList(npc.currency, o.currencyAdd, o.currencyRemove);
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
    for (const a of Array.isArray(d.descriptions) ? d.descriptions : []) {
        const o = object(a), evidence = Array.isArray(o.evidence) ? o.evidence.map((x) => text(x)).filter(Boolean) : [];
        if (!evidence.some((q) => groundedQuote(narration, q))) {
            notes.push(`Archive update rejected as ungrounded: ${text(o.label) || '(unknown)'}.`);
            continue;
        }
        archiveDescription(state, o);
    }
    for (const raw of Array.isArray(d.plansCreate) ? d.plansCreate : []) {
        const o = object(raw), actor = text(o.actor), objective = text(o.objective), cause = text(o.cause);
        if (!actor || !objective || !cause || !groundedQuote(narration, cause))
            continue;
        if (actor === '{{user}}' || (state.player && sameNameText(actor, state.player.name))) {
            notes.push(`World plan rejected for player actor: ${actor}.`);
            continue;
        }
        if (state.world.plans.filter(p => p.status === 'pending' || p.status === 'due').length >= 18)
            continue;
        const id = `plan_${fingerprintText(`${actor}|${objective}|${state.turn}`)}`;
        if (state.world.plans.some(p => p.id === id))
            continue;
        const kind = ['scheduled', 'npc', 'faction', 'power_actor'].includes(String(o.kind)) ? o.kind : 'npc';
        const evidence = (Array.isArray(o.evidence) ? o.evidence : []).slice(0, 8).map((rawEvidence, index) => { const e = object(rawEvidence); const route = ['location', 'actor', 'news', 'investigation'].includes(String(e.route)) ? e.route : 'news'; const evidenceText = text(e.text).slice(0, 500); return { id: `we_${fingerprintText(`${id}|${index}|${evidenceText}`)}`, topic: text(e.topic).slice(0, 160), text: evidenceText, route, location: text(e.location) || undefined, actor: text(e.actor) || undefined, discovered: false }; }).filter((e) => e.text);
        state.world.plans.push({ id, actor, intent: objective, kind, cause, consequences: (Array.isArray(o.consequences) ? o.consequences : []).map((x) => text(x).slice(0, 300)).filter(Boolean).slice(0, 8), evidence, createdTurn: state.turn, updatedTurn: state.turn, dueTurn: state.turn + Math.max(1, Math.min(120, Math.floor(Number(o.delayTurns || 1)))), status: 'pending' });
    }
    for (const raw of Array.isArray(d.plansCancel) ? d.plansCancel : []) {
        const o = object(raw), id = text(o.planId), reason = text(o.reason);
        const plan = state.world.plans.find(p => p.id === id && (p.status === 'pending' || p.status === 'due'));
        if (plan && groundedQuote(narration, reason)) {
            plan.status = 'cancelled';
            plan.cancellationReason = reason;
            plan.updatedTurn = state.turn;
        }
    }
    for (const raw of Array.isArray(d.discoveries) ? d.discoveries : []) {
        const o = object(raw), plan = state.world.plans.find(p => p.id === text(o.planId));
        const evidence = plan?.evidence?.find(e => e.id === text(o.evidenceId));
        const quote = text(o.quote);
        if (evidence && !evidence.discovered && groundedQuote(narration, quote)) {
            evidence.discovered = true;
            evidence.discoveredTurn = state.turn;
        }
    }
    for (const id of Array.isArray(d.resolvedBoundaryIds) ? d.resolvedBoundaryIds : [])
        resolveBoundary(state, String(id));
    if (d.transaction)
        notes.push(...applyTransaction(state, d.transaction));
    const completed = new Set(Array.isArray(d.completedPlanIds) ? d.completedPlanIds.map(String) : []);
    for (const plan of state.world.plans)
        if (completed.has(plan.id)) {
            plan.status = 'completed';
            plan.updatedTurn = state.turn;
            consumeThreadsForActor(state, plan.actor);
            for (const arc of state.continuity.worldArcs)
                if (arc.actor === plan.actor && arc.status === 'active')
                    arc.status = 'completed';
        }
}
function groundedQuote(narration, quote) { const norm = (v) => v.replace(/\s+/g, ' ').trim().toLowerCase(); const q = norm(quote); return Boolean(q && norm(narration).includes(q)); }
function sameNameText(a, b) { return a.trim().toLowerCase() === b.trim().toLowerCase(); }
function injurySeverityCap(resolution, targetType, target) {
    if (!resolution)
        return null;
    let max = 0;
    for (const e of resolution.healthEvents) {
        if (e.kind !== 'damage' || e.targetType !== targetType)
            continue;
        if (targetType === 'npc' && !sameNameText(e.target, target))
            continue;
        max = Math.max(max, Number(e.amount || 0));
        if (e.fatal)
            return 'critical';
    }
    return max >= 9 ? 'critical' : max >= 6 ? 'moderate' : max > 0 ? 'minor' : null;
}
function capPersistentEffects(items, cap) {
    if (!cap || !Array.isArray(items))
        return items;
    const rank = { minor: 1, moderate: 2, severe: 3, critical: 4 }[cap];
    return items.filter(raw => { const v = text(raw).toLowerCase(); if (!v)
        return false; if (rank < 4 && /\b(dead|dying|fatal|severed|amputated|missing|shattered|crushed|paraly[sz]ed|paralysis|unconscious|ruptured|broken spine|broken neck)\b/.test(v))
        return false; if (rank < 3 && /\b(broken|fractured|dislocated|crippled|deep wound|heavy bleeding|bleeding heavily|gouged|impaled|stabbed|pierced|mangled|blinded)\b/.test(v))
        return false; if (rank < 2 && !/\b(minor|small|shallow|superficial|light|surface|scratch|scratched|nick|bruise|bruised)\b/.test(v) && /\b(sprained|strained|poisoned|sickened|stunned|concussed|concussion|exhausted|numb|wounded|breathing trouble)\b/.test(v))
        return false; return true; });
}
function mergeUniqueStrings(existing, incoming, limit) {
    const out = [...(existing || [])], seen = new Set(out.map(x => x.toLowerCase()));
    for (const raw of Array.isArray(incoming) ? incoming : []) {
        const value = text(raw).slice(0, 180);
        if (value && !seen.has(value.toLowerCase())) {
            out.push(value);
            seen.add(value.toLowerCase());
        }
    }
    return out.slice(-limit);
}
function applyStringDelta(existing, adds, removes, limit) {
    let out = [...(existing || [])];
    const removal = new Set((Array.isArray(removes) ? removes : []).map((x) => text(x).toLowerCase()).filter(Boolean));
    if (removal.size)
        out = out.filter(x => !removal.has(x.toLowerCase()));
    return mergeUniqueStrings(out, adds, limit);
}
function applyCurrencyDeltaList(existing, adds, removes) {
    const map = new Map();
    for (const raw of existing || []) {
        const o = object(raw), currency = text(o.currency), amount = Number(o.amount || 0);
        if (currency && Number.isFinite(amount))
            map.set(currency.toLowerCase(), { currency, amount });
    }
    const apply = (items, sign) => { for (const raw of Array.isArray(items) ? items : []) {
        const o = object(raw), currency = text(o.currency), amount = Number(o.amount || 0);
        if (!currency || !Number.isFinite(amount))
            continue;
        const key = currency.toLowerCase(), prev = map.get(key) || { currency, amount: 0 };
        prev.amount += sign * Math.abs(amount);
        map.set(key, prev);
    } };
    apply(adds, 1);
    apply(removes, -1);
    return [...map.values()].filter(x => Math.abs(x.amount) > 1e-9).slice(-30);
}
async function activeChatId(userId, hint = '') {
    const explicit = String(hint || '').trim();
    if (explicit) {
        if (userId) {
            activeChatByUser.set(userId, explicit);
            userByChat.set(explicit, userId);
        }
        return explicit;
    }
    try {
        // The official operator-scoped Lumiverse examples pass userId explicitly to
        // chats.getActive(). This reads the same activeChatId setting maintained by
        // the frontend and is the authoritative lookup for manual UI actions.
        const chat = await spindle.chats.getActive(userId || undefined);
        const id = String(chat?.id || chat?.chat_id || '');
        if (userId && id) {
            activeChatByUser.set(userId, id);
            userByChat.set(id, userId);
        }
        if (id)
            return id;
    }
    catch (err) {
        spindle.log?.warn?.(`Active chat lookup failed: ${String(err)}`);
    }
    // Never erase a valid event/frontend hint merely because getActive() returned
    // null during a transient host/runtime transition.
    return userId ? activeChatByUser.get(userId) || '' : '';
}
function mapConnections(raw) { return raw.map((c) => ({ id: String(c.id || c.connection_id || ''), name: String(c.name || c.label || c.model || c.id || 'Connection'), provider: String(c.provider || ''), model: String(c.model || ''), isDefault: Boolean(c.is_default), hasApiKey: c.has_api_key !== false })).filter(c => c.id); }
async function dashboardPayload(userId, hint = '', personaHint = '') {
    const settings = await loadSettings(userId);
    const chatId = await activeChatId(userId, hint);
    const state = chatId ? await loadState(chatId) : createDefaultState();
    let liveMessageCount;
    let liveLastMessageId = '';
    // Recover from an early attach that saw only the greeting/first message before
    // the full chat was available. Once a real import (3+ messages) or Story Engine
    // turns exist, we do not automatically invalidate completed state.
    if (chatId && has('chat_mutation') && (state.bootstrap.status !== 'ready' || state.bootstrap.sourceMessageCount < 3)) {
        try {
            const live = await spindle.chat.getMessages(chatId);
            liveMessageCount = Array.isArray(live) ? live.length : 0;
            liveLastMessageId = String(Array.isArray(live) && live.length ? live[live.length - 1]?.id || '' : '');
            if (state.bootstrap.status === 'ready' && state.bootstrap.sourceMessageCount < 3 && liveMessageCount >= 3 && state.turn === 0 && state.audits.length === 0) {
                state.bootstrap = { status: 'none', sourceMessageCount: liveMessageCount, lastMessageId: liveLastMessageId || undefined };
                await saveState(chatId, state);
            }
        }
        catch (err) {
            spindle.log?.warn?.(`Story Engine live history check failed for ${chatId}: ${String(err)}`);
        }
    }
    let connections = [];
    try {
        const r = await spindle.connections.list(userId || undefined);
        connections = Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [];
    }
    catch { }
    let persona = null;
    try {
        persona = await getActivePersonaForUser(userId, personaHint);
    }
    catch { }
    let chatInfo = null;
    try {
        if (chatId)
            chatInfo = await spindle.chats.get(chatId, userId || undefined);
    }
    catch {
        try {
            if (chatId)
                chatInfo = await spindle.chats.get(chatId);
        }
        catch { }
    }
    return { type: 'dashboard', chatId, chatInfo: chatInfo ? { id: chatInfo.id, name: chatInfo.name, characterId: chatInfo.character_id } : null, liveMessageCount, liveLastMessageId, personaHintId: String(personaHint || ''), settings, state, connections: mapConnections(connections), capabilities: { chats: has('chats'), chatMutation: has('chat_mutation'), generation: has('generation'), personas: has('personas') }, activePersona: persona ? { id: persona.id, name: persona.name, title: persona.title, description: persona.description } : null };
}
async function sendDashboard(userId, hint = '', _scheduleBootstrap = true, personaHint = '') {
    const payload = await dashboardPayload(userId, hint, personaHint);
    if (userId)
        spindle.sendToFrontend(payload, userId);
    else
        spindle.sendToFrontend(payload);
    // Do not start history import as a detached backend task. Operator-scoped RPC
    // user context is guaranteed while handling the originating frontend command,
    // but can be lost after a fire-and-forget task outlives that callback.
}
function registerChatEvents() {
    if (chatEventsRegistered)
        return;
    spindle.on('CHAT_SWITCHED', async (payload, userId) => { const id = String(payload?.chatId || ''); if (userId) {
        if (id) {
            activeChatByUser.set(userId, id);
            userByChat.set(id, userId);
        }
        else
            activeChatByUser.delete(userId);
    } await sendDashboard(userId, id, false); });
    // CHAT_CHANGED means a chat entity changed; it is not an active-chat switch.
    // Refresh only when the changed chat is actually the active one.
    spindle.on('CHAT_CHANGED', async (payload, userId) => { const changed = String(payload?.chatId || ''); const active = await activeChatId(userId, ''); if (active && (!changed || changed === active))
        await sendDashboard(userId, active, false); });
    // activeChatId is a persisted host setting. Tracking SETTINGS_UPDATED gives us
    // another authoritative source even when an extension worker starts after the
    // original CHAT_SWITCHED event has already fired.
    spindle.on('SETTINGS_UPDATED', async (payload, userId) => {
        if (String(payload?.key || '') !== 'activeChatId')
            return;
        const id = String(payload?.value || '').trim();
        if (userId) {
            if (id) {
                activeChatByUser.set(userId, id);
                userByChat.set(id, userId);
            }
            else
                activeChatByUser.delete(userId);
        }
        await sendDashboard(userId, id, false);
    });
    spindle.on('PERSONA_CHANGED', async (payload, userId) => {
        if (userId) {
            const eventPersona = payload?.persona ?? payload?.activePersona ?? (payload?.id ? payload : null);
            if (eventPersona)
                activePersonaByUser.set(userId, eventPersona);
            else {
                activePersonaByUser.delete(userId);
                await getActivePersonaForUser(userId);
            }
        }
        await sendDashboard(userId, userId ? activeChatByUser.get(userId) || '' : '', false);
    });
    chatEventsRegistered = true;
}
function registerFrontend() {
    if (frontendRegistered)
        return;
    spindle.onFrontendMessage(async (payload, userId) => {
        try {
            const type = String(payload?.type || '');
            const hint = String(payload?.chatId || '');
            const personaHint = String(payload?.personaId || '').trim();
            if (userId && personaHint) {
                const hinted = await getPersonaForUser(personaHint, userId);
                if (hinted)
                    activePersonaByUser.set(userId, hinted);
            }
            if (type === 'get_dashboard') {
                await sendDashboard(userId, hint, true, personaHint);
                return;
            }
            if (type === 'save_settings') {
                const current = await loadSettings(userId);
                await saveSettings(normalizeSettings({ ...current, ...object(payload.settings) }), userId);
                spindle.toast?.success?.('Story Engine settings saved.');
                await sendDashboard(userId, hint, true, personaHint);
                return;
            }
            const chatId = await activeChatId(userId, hint);
            if (type === 'reset_chat_state') {
                if (!chatId)
                    throw new Error('No active chat could be detected.');
                await saveState(chatId, createDefaultState());
                spindle.toast?.success?.('Story Engine state reset for this chat.');
                await sendDashboard(userId, chatId);
                return;
            }
            if (type === 'create_player') {
                if (!chatId)
                    throw new Error('No active chat could be detected.');
                await handleCreatePlayer(chatId, payload, userId);
                return;
            }
            if (type === 'convert_active_persona') {
                if (!chatId)
                    throw new Error('No active chat could be detected.');
                await handleConvertActivePersona(chatId, userId);
                return;
            }
            if (type === 'import_existing_history') {
                if (!chatId)
                    throw new Error('No active chat could be detected.');
                await bootstrapExistingChat(chatId, userId, payload?.auto !== true);
                return;
            }
            if (type === 'get_progression_options') {
                if (!chatId)
                    throw new Error('No active chat could be detected.');
                await handleProgressionOptions(chatId, userId);
                return;
            }
            if (type === 'claim_milestone') {
                if (!chatId)
                    throw new Error('No active chat could be detected.');
                await handleClaimMilestone(chatId, payload, userId);
                return;
            }
            if (type === 'apply_prose_suggestion') {
                if (!chatId)
                    throw new Error('No active chat could be detected.');
                await handleApplyProseSuggestion(chatId, payload, userId);
                return;
            }
            if (type === 'dismiss_prose_review') {
                if (!chatId)
                    return;
                const st = await loadState(chatId);
                st.proseReview = null;
                await saveState(chatId, st);
                await sendDashboard(userId, chatId);
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
async function createAndSwitchStoryPersona(sheet, sourcePersona, userId) {
    if (!has('personas'))
        throw new Error('personas permission is required to create and select the converted persona.');
    const created = await createPersonaForUser({ name: sheet.name, title: `${sheet.race} · ${sheet.genre} · Story Engine`, description: renderPersonaDescription(sheet), folder: 'Story Engine', is_narrator: false, attached_world_book_id: sourcePersona?.attached_world_book_id || undefined, metadata: { story_engine: { sheetVersion: 2, statBuy: 15, genre: sheet.genre, sourcePersonaId: sourcePersona?.id || null } } }, userId);
    await switchActivePersonaForUser(created.id, userId);
    return created;
}
async function handleCreatePlayer(chatId, payload, userId) {
    if (!has('generation'))
        throw new Error('generation permission is required.');
    const input = payload.input;
    const errors = validateCharacterInput(input);
    if (errors.length)
        throw new Error(errors.join(' '));
    const settings = await loadSettings(userId);
    const personaConnection = requireConnection(await resolveConnectionId(settings.personaConnectionId, settings.semanticConnectionId, '', userId), 'character creation');
    const result = await quietForUser({ messages: buildCharacterPrompt(input), tools: [characterTool('new', input.stats)], parameters: { temperature: .35, max_tokens: 2200 }, connection_id: personaConnection, reasoning: { source: 'off' } }, userId);
    const call = result?.tool_calls?.find((x) => x?.name === 'submit_character_sheet') || result?.tool_calls?.[0];
    const sheet = normalizeCharacterSheet(call?.args ?? parseJsonContent(result?.content) ?? {}, input);
    if (sheet.abilities.length !== 1)
        throw new Error('Character assistant must return exactly one starting ability. Try again or choose a different assistant connection.');
    if (sheet.spells.length > 1)
        throw new Error('Character assistant returned more than one starting spell/power.');
    const state = await loadState(chatId);
    applyPlayerToState(state, sheet);
    await saveState(chatId, state);
    if (payload.applyMode === 'new_persona')
        await createAndSwitchStoryPersona(sheet, undefined, userId);
    spindle.toast?.success?.('Player sheet created.');
    spindle.sendToFrontend({ type: 'player_created', sheet }, userId);
    await sendDashboard(userId, chatId);
}
async function handleConvertActivePersona(chatId, userId) {
    if (!has('generation'))
        throw new Error('generation permission is required.');
    if (!has('personas'))
        throw new Error('personas permission is required.');
    const source = await getActivePersonaForUser(userId);
    if (!source)
        throw new Error('No active persona is selected.');
    const settings = await loadSettings(userId);
    const personaConnection = requireConnection(await resolveConnectionId(settings.personaConnectionId, settings.semanticConnectionId, '', userId), 'persona conversion');
    const result = await quietForUser({ messages: buildPersonaConversionPrompt(source), tools: [characterTool('convert')], parameters: { temperature: .25, max_tokens: 2200 }, connection_id: personaConnection, reasoning: { source: 'off' } }, userId);
    const call = result?.tool_calls?.find((x) => x?.name === 'submit_character_sheet') || result?.tool_calls?.[0];
    const sheet = normalizeConvertedPersonaSheet(call?.args ?? parseJsonContent(result?.content) ?? {}, source);
    const state = await loadState(chatId);
    applyPlayerToState(state, sheet);
    await saveState(chatId, state);
    const created = await createAndSwitchStoryPersona(sheet, source, userId);
    spindle.toast?.success?.(`Converted ${source.name} into a new Story Engine persona and selected it.`);
    spindle.sendToFrontend({ type: 'player_created', sheet, personaId: created.id }, userId);
    await sendDashboard(userId, chatId);
}
async function handleProgressionOptions(chatId, userId) {
    const state = await loadState(chatId);
    if (!state.player)
        throw new Error('Create a player sheet first.');
    if (state.progression.pendingMilestones <= 0)
        throw new Error('No progression milestone is pending.');
    const tool = { name: 'submit_progression_options', description: 'Return three distinct ability options and three spell options suitable for the player progression milestone.', parameters: { type: 'object', additionalProperties: false, properties: { abilities: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } }, spells: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } } }, required: ['abilities', 'spells'] } };
    const progressionSettings = await loadSettings(userId);
    const progressionConnection = requireConnection(await resolveConnectionId(progressionSettings.semanticConnectionId, '', '', userId), 'progression options');
    const result = await quietForUser({ messages: [{ role: 'system', content: 'Design grounded progression choices for the existing character. Options should extend established themes without sudden unrelated powers. Abilities are useful capabilities, never automatic success. Spells should be bounded and setting-consistent. Call submit_progression_options once.' }, { role: 'user', content: renderPersonaDescription(state.player) }], tools: [tool], parameters: { temperature: .65, max_tokens: 900 }, connection_id: progressionConnection, reasoning: { source: 'off' } }, userId);
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
        const persona = await getActivePersonaForUser(userId);
        if (persona && has('personas'))
            await updatePersonaForUser(persona.id, { description: renderPersonaDescription(state.player), metadata: { ...(persona.metadata || {}), story_engine: { sheetVersion: 1, genre: state.player.genre, level: state.progression.level } } }, userId);
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
    const settings = await loadSettings(userId);
    const repaired = review.suggested || await repairProse(review.content, review.findings, settings, userId);
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
registerChatEvents();
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
