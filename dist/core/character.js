import { GENRES, PLAYER_STAT_MAX, PLAYER_STAT_MIN, PLAYER_STAT_POINTS, RACES } from './config.js';
import { object, text, stringList, clampInt } from './state.js';
export function characterTool() { return { name: 'submit_character_sheet', description: 'Submit a grounded Story Engine player sheet using the requested concept and exact stat allocation.', parameters: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, race: { type: 'string' }, genre: { type: 'string' }, age: { type: 'number' }, appearance: { type: 'string' }, stats: { type: 'object', additionalProperties: false, properties: { PHY: { type: 'integer', minimum: 1, maximum: 9 }, MND: { type: 'integer', minimum: 1, maximum: 9 }, CHA: { type: 'integer', minimum: 1, maximum: 9 } }, required: ['PHY', 'MND', 'CHA'] }, naturalWeapons: { type: 'array', items: { type: 'string' } }, abilities: { type: 'array', items: { type: 'string' } }, spells: { type: 'array', items: { type: 'string' }, maxItems: 1 }, inventory: { type: 'array', items: { type: 'string' } }, currency: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { currency: { type: 'string' }, amount: { type: 'number' } }, required: ['currency', 'amount'] } }, gear: { type: 'array', items: { type: 'string' } }, anchors: { type: 'array', items: { type: 'string' } }, concept: { type: 'string' }, backstory: { type: 'string' } }, required: ['name', 'race', 'genre', 'appearance', 'stats', 'naturalWeapons', 'abilities', 'spells', 'inventory', 'currency', 'gear', 'anchors', 'concept', 'backstory'] } }; }
export function buildCharacterPrompt(input) {
    const stats = input.stats ?? { PHY: 5, MND: 5, CHA: 5 };
    return [
        { role: 'system', content: `Create a concise player character sheet for a roleplay simulation. Respect the user's concept; do not add hidden destinies, secret powers, plot armor, unexplained status, or world-breaking advantages. Stats PHY/MND/CHA must each be ${PLAYER_STAT_MIN}-${PLAYER_STAT_MAX} and total exactly ${PLAYER_STAT_POINTS}. The requested allocation is authoritative and must be returned unchanged. Starting spells: at most one. Abilities are descriptive capabilities, not automatic success. Inventory and gear must be plausible for the concept/genre. Character anchors are 3-8 short behavioral/background truths useful for continuity. Call submit_character_sheet once.` },
        { role: 'user', content: `NAME: ${input.name}\nRACE: ${input.race}\nGENRE: ${input.genre}\nSTAT ALLOCATION: PHY ${stats.PHY}, MND ${stats.MND}, CHA ${stats.CHA}\nCONCEPT: ${input.concept}\nAPPEARANCE: ${input.appearance}\nBACKSTORY: ${input.backstory}\nDESIRED ABILITIES: ${input.desiredAbilities || ''}\nDESIRED SPELLS: ${input.desiredSpells || ''}\nINVENTORY IDEAS: ${input.inventory || ''}\nANCHORS: ${input.anchors || ''}` }
    ];
}
export function buildPersonaConversionPrompt(persona) {
    return [
        { role: 'system', content: `Convert the user's CURRENT LUMIVERSE PERSONA into a Story Engine player sheet without changing the original persona. Preserve established identity, appearance, personality, background, possessions, capabilities and genre cues. Do not invent secret powers, plot armor, destiny, wealth or equipment not supported by the persona. Infer a grounded PHY/MND/CHA allocation from the persona: each ${PLAYER_STAT_MIN}-${PLAYER_STAT_MAX}, total exactly ${PLAYER_STAT_POINTS}. A balanced ordinary person should be around 5/5/5; specialize only when the persona clearly supports it. Starting spells: at most one. Abilities are descriptive capabilities, never automatic success. Call submit_character_sheet once.` },
        { role: 'user', content: `PERSONA NAME: ${persona.name || ''}\nTITLE: ${persona.title || ''}\nFOLDER: ${persona.folder || ''}\nDESCRIPTION:\n${persona.description || ''}` }
    ];
}
export function normalizeCharacterSheet(value, fallback) {
    const o = object(value);
    const st = object(o.stats);
    let PHY = clampInt(st.PHY, 1, 9, fallback.stats?.PHY ?? 5), MND = clampInt(st.MND, 1, 9, fallback.stats?.MND ?? 5), CHA = clampInt(st.CHA, 1, 9, fallback.stats?.CHA ?? 5);
    const sum = PHY + MND + CHA;
    if (sum !== PLAYER_STAT_POINTS) {
        const fixed = normalizeStartingStatBudget({ PHY, MND, CHA });
        PHY = fixed.PHY;
        MND = fixed.MND;
        CHA = fixed.CHA;
    }
    return { name: text(o.name) || fallback.name || 'Player', race: text(o.race) || fallback.race || 'Human', genre: text(o.genre) || fallback.genre || 'Fantasy', age: Number.isFinite(Number(o.age)) ? Number(o.age) : undefined, appearance: text(o.appearance) || fallback.appearance || '', stats: { PHY, MND, CHA }, naturalWeapons: stringList(o.naturalWeapons).slice(0, 8), abilities: stringList(o.abilities).slice(0, 12), spells: stringList(o.spells).slice(0, 1), inventory: stringList(o.inventory).slice(0, 40), currency: Array.isArray(o.currency) ? o.currency.slice(0, 12) : [], gear: stringList(o.gear).slice(0, 20), anchors: stringList(o.anchors).slice(0, 12), concept: text(o.concept) || fallback.concept, backstory: text(o.backstory) || fallback.backstory };
}
export function normalizeConvertedPersonaSheet(value, persona) {
    const fallback = { name: text(persona.name) || 'Player', race: 'Human', genre: 'Fantasy', concept: text(persona.title), appearance: '', backstory: text(persona.description), stats: { PHY: 5, MND: 5, CHA: 5 } };
    return normalizeCharacterSheet(value, fallback);
}
export function validateCharacterInput(input) { const errors = []; if (!input.name.trim())
    errors.push('Name is required.'); if (!RACES.includes(input.race))
    errors.push('Choose a supported race.'); if (!GENRES.includes(input.genre))
    errors.push('Choose a supported genre.'); if (input.stats) {
    const vals = [input.stats.PHY, input.stats.MND, input.stats.CHA];
    if (vals.some(v => v < PLAYER_STAT_MIN || v > PLAYER_STAT_MAX))
        errors.push(`Each stat must be ${PLAYER_STAT_MIN}-${PLAYER_STAT_MAX}.`);
    if (vals.reduce((a, b) => a + b, 0) !== PLAYER_STAT_POINTS)
        errors.push(`PHY + MND + CHA must equal ${PLAYER_STAT_POINTS}.`);
} return errors; }
export function renderPersonaDescription(sheet) { return `BASIC INFO\nName: ${sheet.name}\nRace: ${sheet.race}${sheet.age ? `\nAge: ${sheet.age}` : ''}\nGenre: ${sheet.genre}\n\nAPPEARANCE\n${sheet.appearance}\n\nSTATS\nPHY: ${sheet.stats.PHY}\nMND: ${sheet.stats.MND}\nCHA: ${sheet.stats.CHA}\n\nNATURAL WEAPONS\n${bullets(sheet.naturalWeapons)}\n\nABILITIES\n${bullets(sheet.abilities)}\n\nSPELLS\n${bullets(sheet.spells)}\n\nINVENTORY\n${bullets(sheet.inventory)}\n\nCURRENCY\n${sheet.currency.length ? sheet.currency.map(c => `- ${c.amount} ${c.currency}`).join('\n') : '- None'}\n\nGEAR\n${bullets(sheet.gear)}\n\nCHARACTER ANCHORS\n${bullets(sheet.anchors)}${sheet.backstory ? `\n\nBACKSTORY\n${sheet.backstory}` : ''}`; }
export function applyPlayerToState(state, sheet) { state.player = sheet; state.health.user.maxHp = Math.max(10, state.health.user.maxHp); state.health.user.currentHp = Math.min(state.health.user.maxHp, Math.max(1, state.health.user.currentHp)); state.names.style = state.names.style || 'Balanced Fantasy'; }
function bullets(v) { return v.length ? v.map(x => `- ${x}`).join('\n') : '- None'; }
export function normalizeStartingStatBudget(s) { const out = { ...s }; let total = out.PHY + out.MND + out.CHA; const keys = ['PHY', 'MND', 'CHA']; while (total < PLAYER_STAT_POINTS) {
    const k = [...keys].sort((a, b) => out[a] - out[b])[0];
    if (out[k] >= PLAYER_STAT_MAX)
        break;
    out[k]++;
    total++;
} while (total > PLAYER_STAT_POINTS) {
    const k = [...keys].sort((a, b) => out[b] - out[a])[0];
    if (out[k] <= PLAYER_STAT_MIN)
        break;
    out[k]--;
    total--;
} return out; }
