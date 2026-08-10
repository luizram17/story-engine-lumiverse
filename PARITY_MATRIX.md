# Story Engine parity matrix

This file is the implementation checklist used for the clean-room Lumiverse remake. “Native” means the behavior was rewritten around Lumiverse/Spindle instead of emulating SillyTavern globals or DOM.

| Upstream behavior/system | Lumiverse implementation | Notes / improvement |
|---|---|---|
| Player creation + existing-persona conversion | `core/character.ts`, Character UI, Personas API | 15-point PHY/MND/CHA buy, genre/race/details, generated sheet; can update active persona, create a new persona, or remain state-only. |
| OOC commands / retcons | `core/commands.ts` + backend interceptor | Extracts only `((...))` clauses from the current user message, sends them to a dedicated Command Assistant, applies validated structured mutations across all story-data namespaces, and removes the OOC text from IC generation. |
| Existing-chat bootstrap | `core/commands.ts` + `spindle.chat.getMessages()` | Reads canonical saved history and reconstructs player/NPC/world/relationship/continuity state when attached to an ongoing RP. |
| Semantic preflight / roll gate | `core/semantic.ts` + `spindle.generate.quiet()` | Typed tool contract; quiet calls cannot recurse through the prompt interceptor. Conservative fallback keeps main chat usable if sidecar generation fails. |
| Up to three action units | `core/semantic.ts`, `core/mechanics.ts` | Total action-length budget is capped at three. |
| Combat opposed d20 tiers / counters | `core/mechanics.ts` | Preserves margin bands and 1/2/3 landed-action cap; failed attacks can open deterministic counter pressure. |
| Social / environment / stealth / supernatural / restraint routing | `core/semantic.ts`, `core/mechanics.ts` | Explicit claim truth/access is separated from persuasion success. |
| Boundary restraint / warning / break contracts | `core/continuity.ts`, `core/relationships.ts` | Pending boundary has stable ID/target/type; mismatched boundary-break claims are rejected. Trusted actors can receive the configured grace warning before contest. |
| Hidden HP, wounds, impairment, incapacitation, death, healing | `core/health.ts` | Hidden HP remains private to mechanics; narration receives condition/consequence guidance, not HP numbers. |
| NPC generated stats/ranks | `core/state.ts` | New NPC rank is seeded from common/trained/elite/boss capability pools; rank/stats become persistent identity and cannot silently change on a later semantic pass. |
| Relationships / dispositions | `core/relationships.ts` | Bond/Fear/Hostility, arbitrary freeform initial relationship descriptors (positive, negative, mixed, familial, professional, etc.), contextual first impressions, anti-farming, romance/intimacy and explicit boundary state. |
| Rapport timing / bound companion | `core/continuity.ts` | 10-minute active-idle window, 30-minute rapport cooldown, partner meaningful-action clock, plus strongest active bound companion. |
| Fame / infamy / fear reputation | state + post-turn archivist + relationship initialization | Location scoped; affects new local impressions rather than becoming a universal morality score. |
| Proactivity | `resolveProactivity()` | Threats, independent action, gifts/flirting/support, companion assist/protect/abandon and relationship-aware initiative. |
| Counter-attacks / NPC aggression | `resolveNpcAggression()` | Uses hidden impairment and protective equipment defense. |
| Power Actors / delayed consequences | `core/world.ts`, `core/continuity.ts` | Persistent plans/world arcs; grievance/threat paths explicitly allow indirect agents/covert action where fiction permits. |
| Random contextual events | `core/world.ts` | Seeded, scene-anchored and suppressed in crisis to avoid stacking unrelated chaos. |
| World state / world memory / progression plans | `core/world.ts`, `core/continuity.ts` | Location, area, day/time/weather, durable facts, plans, arcs, descriptive archive. |
| User-knowledge ledger | `core/continuity.ts` | private/local/route/faction/regional/legendary scope; true/distorted/false/claimed truth; certain/likely/uncertain confidence. |
| Latent favors / grievances | `core/continuity.ts` | Typed background threads with magnitude, status and consumption. |
| Economy / price memory | `core/economy.ts` | Genre currency + value tiers, explicit/pending payment accounting, no invented balance. |
| Equipment value / defense | `core/economy.ts` | Tier-based protective-equipment bonus, with disabled/broken item exclusion. |
| Deterministic NPC loot | `core/economy.ts`, `core/mechanics.ts` | Only tracked verified-dead bodies receive deterministic corpse envelopes; completed searches cannot reroll/duplicate loot. Possession is still narration/transaction-gated. |
| Name generation / no repeated generic names | `core/names.ts` | Seeded local generator by style and per-chat used-name registry; no extra model call is required. |
| Character progression | `backend.ts`, `core/character.ts`, `core/health.ts` | XP tiers, milestone stat + ability/spell choice, HP milestone growth. |
| Prose rules + repair pass | `core/prose.ts` + post-generation finalizer | Off/Review/Automatic; edits saved Lumiverse message directly instead of streaming hidden artifacts through ST Regex. |
| Tracker delta / durable post-narration state | `buildPostTurnPrompt()` / `postTurnTool()` | Captures facts, knowledge, descriptions, name promotion, stable personality summary, NPC state, reputation and plan/boundary completion. |
| Tracker UI | `frontend.ts` | Native drawer + floating widget; exposes NPCs, relationships, reputation, hidden continuity ledgers, memory, progression and audit. |
| Current-scene NPC presence / floating player HUD | `world.presentNpcs`, semantic + post-turn presence reconciliation, `frontend.ts` | HUD lists only NPCs physically present while retaining the complete historical tracker; also exposes player HP, progression, stats, money, inventory, equipment, abilities, spells and scene. |
| Swipe/regenerate consistency | backend transaction coordinator | Pre-turn snapshot + same `TurnResolution` replay prevents rerolling or duplicating HP, XP, money, relationships, events, names or loot. |
| Streaming structured-artifact hiding | Not needed | Structured sidecar calls never enter the main assistant message. |

## Host-bound behavior intentionally replaced rather than copied

SillyTavern DOM observers, `.mes` selectors, ST connection-profile globals, settings-panel HTML injection and Regex cleanup are not carried over. Their *behavioral purpose* is implemented through native Spindle interceptors, events, chat variables, Personas, `chat_mutation`, drawer UI and float widgets.
