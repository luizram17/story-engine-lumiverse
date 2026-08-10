# Porting notes: SillyTavern Story Engine → Lumiverse

## Host integration replacements

| Original concern | Native Lumiverse design |
|---|---|
| SillyTavern `generate_interceptor` / global context | `spindle.registerInterceptor()` |
| ST secondary generation helpers | centralized Spindle direct sidecar generation |
| ST connection profile adapter | Lumiverse Connection profile IDs, resolved per user |
| chat metadata + DOM-coupled state | versioned `spindle.variables.chat` state |
| ST persona read/write | Lumiverse Personas API |
| DOM observers over `.mes` / `#chat` | backend/frontend lifecycle events plus explicit active-chat hints |
| Regex used to hide streaming tracker artifacts | sidecar structured output never enters narration |
| post-generation message edits via ST internals | Lumiverse chat mutation |
| injected settings HTML | native drawer, input-bar action and floating widget |

## Structural improvements

### Transactional turns and swipe stability
Preflight computes a `TurnResolution` without committing HP/XP/relationships. Final state commits only after a saved generation. Swipe/regenerate restores the pre-turn core snapshot and reapplies the same resolution, preventing duplicate damage, XP, spending, relationship growth, random events, names and loot.

### Operator-scoped user isolation
Settings live in user-scoped storage. Chat/persona/connection resolution is tied to the frontend/event user. Direct sidecar generation is centralized through one compatibility wrapper that carries the operator user scope in the request and callback path; this specifically addresses real Lumiverse runtimes that reject unscoped `generate.quiet()` with `userId is required for operator-scoped extensions`.

### Silent attachment
There is no synthetic “Start Adventure” message. The extension attaches to the active chat, imports existing history when requested/allowed, and starts mechanics on the next real user turn. Active-chat resolution combines operator-scoped backend lookup, frontend `activeChatId` hints and lifecycle event caches.

### Existing-chat bootstrap
Canonical saved history is chunked through a History Import Assistant and reconstructed into the same validated mutation layer used by OOC commands. It can recover established player/NPC resources, arbitrary positive/negative/mixed relationships, scene presence, world facts and continuity without replaying past mechanics as new turns.

### OOC administrative commands
Double-parenthesis clauses are isolated from IC text. A dedicated Command Assistant may retcon story/mechanical namespaces through structured operations while internal pending/rollback/audit transaction machinery remains protected.

### Host-independent core
Simulation code lives under `src/core` and does not depend on Lumiverse globals/DOM. Backend and frontend entrypoints own host I/O.

### Explicit state migration
The current root schema is **v10**. Older v9/v8/v7/v6 states are normalized/migrated conservatively rather than discarded.

### Deterministic local names
Name generation is seeded locally and reserves names per chat. No separate naming model call is needed.

### Native Prompt Breakdown
The narrator handoff is attributed as `Story Engine · Scene Resolution` rather than hidden in a host-specific prompt injection layer.

### Prose Guard without hidden artifacts
Repair is sentence-local and validated. Only offending sentences may change; unaffected narration remains untouched. Structured repair output never streams into the primary reply.

### Relationship depth ported from upstream
The port now includes rapport 0–5, cooldowns, slow B3→B4 evidence categories/blockers, standing influence (`none/aware/constrained`), romance initiative style (`auto/nervous/flirt`), arbitrary starting relationship semantics and explicit boundary state.

### Tracker depth ported from upstream
Player wounds/conditions/tasks/commitments and NPC aliases/inventory/currency/gear/wounds/conditions are first-class state. Durable personality is separate from temporary mood. Name promotions propagate through linked systems.

### Hidden health details ported from upstream
Condition-based healing DCs, once-per-damage-state natural treatment, companion HP floor, hidden impairment, safe-scene recovery and contextual injury severity ceilings are deterministic rather than narrator-owned.

### World memory depth ported from upstream
The descriptive archive stores identity/affiliation/history/connections/status/location. World plans distinguish scheduled/NPC/faction/power-actor actors and can expose evidence through location/actor/news/investigation routes. Grounding checks prevent post-turn assistants from fabricating unsupported archive/plan changes.

### Connection fallback is profile-based
A saved role-specific profile is preferred, then semantic inheritance/runtime profile, then the user’s usable default, then another usable profile with an API key. Features that genuinely require a sidecar fail with a Story Engine-specific error rather than launching an undefined host generation.

## Deliberate differences from upstream

- Starting stat budget is **15**, not 24, by project decision.
- The port uses seeded RNG keyed to chat/turn/fingerprint for stable replay.
- B/F/H remains 0–4 in this save schema while upstream relationship threshold behavior is mapped into it.
- UI is redesigned around Lumiverse rather than reproducing SillyTavern markup.
- The original synthetic adventure-opening message flow is replaced by silent chat attachment. This avoids injecting text the user did not write and avoids depending on the host’s current narrator connection just to initialize Story Engine.
- The original project has a very large organically-grown semantic prompt surface. This port reproduces its mechanical/continuity contracts as typed compact ledgers rather than copying the prompt text line-for-line.
