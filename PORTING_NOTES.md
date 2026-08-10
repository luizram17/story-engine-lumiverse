# Porting notes: SillyTavern Story Engine → Lumiverse

## Replaced host dependencies

| Original concern | Native Lumiverse design |
|---|---|
| SillyTavern `generate_interceptor` / global context | `spindle.registerInterceptor()` |
| ST secondary generation helpers | `spindle.generate.quiet()` |
| ST connection profile adapter | Lumiverse connection IDs on generation requests |
| chat metadata + DOM-coupled state | persisted `spindle.variables.chat` JSON state |
| ST persona read/write | `spindle.personas.getActive/update/create/switchActive` |
| DOM observers over `.mes` / `#chat` | generation/message lifecycle events |
| Regex module used to hide streaming artifacts | no artifact emission; direct structured sidecar calls |
| post-generation message edits via ST internals | `spindle.chat.updateMessage()` |
| injected settings HTML in ST panel | native drawer tab + float widget + input-bar action |

## Structural improvements

### 1. Transactional turns
Preflight computes a `TurnResolution` but does not commit HP/XP/relationships immediately. The finalizer commits only after Lumiverse reports a successfully saved generation.

### 2. Swipe/regenerate stability
The state stores a pre-turn core snapshot. A swipe/regeneration restores it, reapplies the already-rolled result, then archives the new final narration. This prevents repeated damage, XP, spending, relationship growth, random-event rerolls, or loot rerolls.

### 3. Deterministic local names
Name generation no longer needs another model call. A seeded style generator reserves unique names per chat. The narrator receives candidates and a reveal gate.

### 4. Host-independent core
All simulation code is in `src/core`. It has no `spindle`, DOM, or UI imports. Host I/O stays in two entrypoints.

### 5. Explicit state version
The JSON root carries a state version and is normalized on every load. Corrupt/missing fields fall back conservatively instead of crashing the generation interceptor.

### 6. Graceful sidecar failure
If semantic generation fails, a conservative local fallback only recognizes obvious attack/social/stealth patterns; it never blocks the user's main generation.

### 7. Native Prompt Breakdown
The scene-resolution handoff is attributed as `Story Engine · Scene Resolution`, so the user can inspect exactly what the extension injected.

### 8. Prose Guard without regex artifacts
The model never emits hidden tracker JSON into the primary reply. Review/repair runs after generation and edits the saved message only when appropriate.


### 9. Relationship anti-farming and explicit boundaries
Repeated use of the same social tactic toward the same goal does not accumulate Bond indefinitely. Personal-boundary pressure is persisted separately, and romance/intimacy progression is a typed state rather than narrator-only implication.

### 10. Reputation has deterministic reach
Fame/infamy/fear stays location-scoped. Once notable, it can bias a newly established local NPC's initial Bond/Fear/Hostility while still allowing scene-specific context to dominate.

### 11. Configurable mechanics, not controller constants
HP bands, damage/healing steps, rank ranges, economy tiers, equipment defense bonuses, event chance and progression limits live in small core modules and are covered by tests rather than being embedded across host/UI code.

### 12. Deterministic NPC identity and corpse-search idempotency
New NPCs resolve a stable rank from the upstream-style capability pool distribution and keep it thereafter. Deterministic corpse loot requires a tracked verified-dead target and is permanently marked searched after commit.

### 13. Hidden continuity ledgers are first-class state
User knowledge, latent favors/grievances, descriptive archive, rapport clocks, bound companion, pending boundaries and world arcs are typed/versioned instead of being folded into freeform NPC notes.

## Deliberate implementation differences

- The original project has a very large, organically-grown semantic prompt surface with numerous micro-rules. This port preserves the systems and key mechanical contracts but rewrites the semantic contract into a typed compact ledger rather than copying the upstream prompt text.
- The port uses seeded RNG keyed to chat/turn/fingerprint for stable replay. This is intentionally more reproducible than unseeded `Math.random()` on regeneration.
- UI is redesigned around Lumiverse's drawer and widget system rather than reproducing SillyTavern markup.
