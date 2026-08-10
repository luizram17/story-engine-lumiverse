const baseRules = [
    { phrase: /\bbarely above (?:a )?(?:whisper|breath)\b/gi, label: 'stock whisper phrasing' },
    { phrase: /\bthe air (?:seemed to )?(?:thicken|shift|change)\b/gi, label: 'atmosphere shorthand' },
    { phrase: /\bfor a moment[, ]/gi, label: 'generic beat' },
    { phrase: /\ba mix of [^.!?]{1,60} and [^.!?]{1,60}/gi, label: 'abstract emotion bundle' },
    { phrase: /\bsomething (?:in|about) (?:his|her|their|the)\b/gi, label: 'vague attribution' },
    { phrase: /\bnot [^.!?]{1,45}, but [^.!?]{1,45}/gi, label: 'rhetorical negation' },
    { phrase: /\bit wasn't [^.!?]{1,45};? it was\b/gi, label: 'rhetorical contrast' },
    { phrase: /\beyes? (?:darkened|softened|hardened|flashed)\b/gi, label: 'stock eye shorthand' },
    { phrase: /\ba beat (?:passed|of silence)\b/gi, label: 'stock pause' },
    { phrase: /\bthe weight of (?:the|his|her|their)\b/gi, label: 'abstract weight metaphor' },
    { phrase: /\bvoice (?:low|soft|quiet),? but\b/gi, label: 'stock voice contrast' },
];
export function collectProseFindings(text, extraPhrases = []) {
    const rules = [...baseRules, ...extraPhrases.filter(Boolean).map(p => ({ phrase: new RegExp(escapeRegExp(p), 'gi'), label: 'user-banned phrase' }))];
    const findings = [];
    for (const rule of rules) {
        rule.phrase.lastIndex = 0;
        let m;
        while ((m = rule.phrase.exec(text))) {
            findings.push({ phrase: m[0], index: m.index, excerpt: text.slice(Math.max(0, m.index - 55), Math.min(text.length, m.index + m[0].length + 55)), category: rule.label });
            if (m[0].length === 0)
                rule.phrase.lastIndex++;
        }
    }
    return findings.sort((a, b) => a.index - b.index).slice(0, 100);
}
export function proseRepairPrompt(content, findings) {
    return `Edit the narration below minimally. Fix only the listed prose problems and any grammar made necessary by those edits. Preserve all facts, dialogue meaning, chronology, POV, character behavior, paragraph structure when possible, and player agency. Do not add events, thoughts, motives, actions, lore, consequences, or sensory facts. Return only the complete repaired narration, no commentary.\n\nFINDINGS:\n${findings.map((f, i) => `${i + 1}. ${f.category}: ${JSON.stringify(f.phrase)}`).join('\n')}\n\nNARRATION:\n${content}`;
}
export function stripStructuredArtifacts(text) {
    return text
        .replace(/<story-engine(?:\s[^>]*)?>[\s\S]*?<\/story-engine>/gi, '')
        .replace(/```(?:json)?\s*\{[\s\S]*?"(?:semantic|tracker|resolution)"[\s\S]*?\}\s*```/gi, '')
        .replace(/^\s*(?:STORY_ENGINE|SEMANTIC_LEDGER|TRACKER_DELTA)\s*:[\s\S]*$/gim, '')
        .trim();
}
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
