# Story Engine parity matrix

This is the implementation checklist for the clean-room Lumiverse remake. “Native” means the behavior is implemented around Lumiverse/Spindle rather than emulating SillyTavern globals or DOM.

| Upstream behavior/system | Lumiverse implementation | Notes / improvement |
|---|---|---|
| Player creation | `core/character.ts`, Character UI | **15-point** PHY/MND/CHA buy by project choice (the upstream currently uses 24); live remaining-points validation and blocked submit until the budget is exact. New characters receive exactly one activated ability; they may receive one optional starting spell/power with no MND requirement when their concept/request supports it (a deliberate Lumiverse-port balance change). |
| Existing-persona conversion | `core/character.ts`, Personas API | Reads the selected Lumiverse persona, preserves explicit identity/powers/resources, supports up to 24 abilities and 5 spells, creates a separate Story Engine persona and switches to it without overwriting the source. |
| Character identity/detail contract | `core/character.ts`, `shared/types.ts` | Race, nonhuman flag, gender, age, bloodline, origin, prior role/training, appearance, natural weapons, abilities, spells, inventory, currency, gear and anchors are first-class fields. |
| Existing-chat bootstrap | `core/commands.ts`, backend history importer | Reads canonical saved history and reconstructs player/NPC/world/relationship/continuity state when attached to an ongoing RP. Import is chunk-progress tracked, abortable/cancelable, timeout-bounded, stale/orphan recoverable, and supports tool-call → strict-JSON fallback for provider compatibility. |
| OOC commands / retcons | `core/commands.ts` + backend interceptor | Extracts only `((...))` clauses, sends them to a dedicated Command Assistant, applies validated structured mutations across story-data namespaces, and removes OOC text from IC generation. Internal transaction/rollback bookkeeping stays protected. |
| Semantic preflight / roll gate | `core/semantic.ts` + direct sidecar generation | Typed contract; mundane/no-stakes actions do not roll; fallback remains conservative if the sidecar fails. |
| Player introspection is not an action | `core/semantic.ts` | Internal thoughts/feelings alone do not create targets, inventory changes, wounds, movement or rolls. |
| Up to three action units | `core/semantic.ts`, `core/mechanics.ts` | Total action-length budget is capped at three. |
| Combat opposed d20 tiers / counters | `core/mechanics.ts` | Preserves margin bands and 1/2/3 landed-action cap; failed attacks can create deterministic counter pressure. |
| Social / environment / stealth / supernatural / restraint routing | `core/semantic.ts`, `core/mechanics.ts` | Explicit challenge routing; claim truth/access remains separate from persuasion success. |
| Claim truth / NPC access | semantic + narrator handoff | A successful social roll cannot make a false claim objectively true or give an NPC knowledge they do not have. |
| Boundary restraint / pressure / break | `core/continuity.ts`, `core/relationships.ts` | Stable boundary IDs/target/type, trusted grace warnings, immediate contests for hostile/crisis contexts and mismatch rejection. |
| Hidden HP / impairment / death | `core/health.ts` | Hidden user/NPC HP, condition bands, impairment, lethal/nonlethal defeat, milestone HP growth and deterministic damage/heal tiers. |
| Healing difficulty / treatment lock | `core/health.ts`, `core/mechanics.ts` | Condition-based healing DCs 13/16/19; natural treatment cannot be farmed repeatedly on the same damage state; safe-scene and daily recovery remain deterministic. |
| Contextual injury ceilings | backend post-turn reconciliation | Narration-derived lasting wounds/status are clamped to the severity allowed by deterministic damage, preventing a light mechanical hit from becoming an unsupported catastrophic injury. |
| NPC generated stats/ranks | `core/state.ts` | Seeded common/trained/elite/boss capability pools; stable persistent rank/stat identity. |
| Companion health scale | `core/state.ts`, `core/health.ts` | Adventuring companions have at least the upstream-style 10 HP floor and receive milestone health growth. |
| Relationships / dispositions | `core/relationships.ts` | Bond/Fear/Hostility, contextual first impressions, arbitrary initial relationship descriptors, locks and explicit relationship state. |
| Arbitrary starting relationships | semantic/importer/Command Assistant | Positive, negative or mixed relationships can be established immediately: family, best friend, rival, sworn enemy, ex-partner, mentor, subordinate, captor, debtor, etc. Freeform descriptors preserve meaning beyond B/F/H. |
| Rapport + slow B3→B4 growth | `core/relationships.ts`, `core/continuity.ts` | Per-NPC rapport 0–5 with cooldown; B3→B4 requires rapport 5, no closeness blockers, and at least two distinct positive evidence categories such as boundary respect/teamwork/personal attention. |
| Recognized standing / authority | semantic + relationships + proactivity | `none/aware/constrained` standing changes outward caution/protocol without directly rewriting B/F/H; constrained standing suppresses only unsolicited violence, not valid self-defense/counters/combat. |
| Romance / intimacy / initiative style | relationships + proactivity | Romance stage/intimacy plus stable `auto/nervous/flirt` initiative style; high fear/hostility constrains closeness. |
| Bound companion / rapport timing | `core/continuity.ts` | Active-idle/cooldown clocks and strongest bound companion state. |
| Fame / infamy / fear reputation | state + post-turn + initial impression | Location scoped; can bias new local impressions without becoming universal morality. |
| Proactivity | `resolveProactivity()` | Threats, independent action, support, gifts/flirting, companion assist/protect/abandon and relationship-aware initiative. |
| Counter-attacks / NPC aggression | `resolveNpcAggression()` | Uses hidden impairment, protective-equipment defense and existing hostility/combat context. |
| Power Actors / delayed consequences | `core/world.ts`, `core/continuity.ts` | Persistent off-screen plans/world arcs; indirect agents/covert action supported when fiction permits. |
| Random contextual events | `core/world.ts` | Seeded, scene-anchored and suppressed during crisis to avoid stacking unrelated chaos. |
| World state | `core/world.ts` | Reputation location, immediate place/area, indoors, day/time slot and weather, with explicit established/unknown flags so internal defaults are never presented as known facts; weather duration advances deterministically. |
| Descriptive archive | `core/continuity.ts`, post-turn | Durable NPC/location/faction/event identity, affiliation, history, connections, status, last-known location and grounded evidence. |
| World progression plans | `core/world.ts`, post-turn | Scheduled/NPC/faction/power-actor plans, causes, delayed consequences, cancellation/completion and private off-screen progression. |
| Discoverable world evidence | `core/world.ts`, post-turn | Location/actor/news/investigation routes; evidence is only marked discovered when narration actually presents grounded evidence. |
| User-knowledge ledger | `core/continuity.ts` | private/local/route/faction/regional/legendary scope; true/distorted/false/claimed truth; certain/likely/uncertain confidence. |
| Latent favors / grievances | `core/continuity.ts` | Typed background threads with magnitude/status/consumption. |
| Economy / price memory | `core/economy.ts` | Genre currency, value tiers, explicit transaction accounting and pending-price memory. |
| Equipment value / defense | `core/economy.ts` | Tier-based protective equipment bonus; broken/destroyed/unusable gear is excluded. |
| User inventory / gear / currency deltas | post-turn + OOC | Possession changes are grounded in final narration; quotes/offers alone do not grant items or spend money. |
| NPC inventory / gear / currency | tracker + post-turn + bootstrap | NPC resources are persistent and can be revealed/transferred/removed without incorrectly granting them to the player. |
| Player wounds/status/tasks/commitments | tracker + post-turn + HUD | Persistent injuries/conditions plus open objectives, debts, promises, vows and obligations. |
| Deterministic NPC loot | `core/economy.ts`, `core/mechanics.ts` | Verified-dead tracked targets only; one-search persistence; possession transfer still requires narration/transaction confirmation. |
| Name generation / no repeated generic names | `core/names.ts` | Seeded local generator by style and per-chat used-name registry; no extra model call is required. |
| Name promotion | post-turn reconciliation | Generic tracked identities can be promoted to revealed names and propagate through health, plans, presence and continuity state. |
| Stable personality memory | tracker + archivist | Durable personality summary/archetype is preserved separately from temporary mood/relationship state. |
| Character progression | backend + character + health | XP tiers, milestones, stat growth, ability/spell choices and health growth. |
| Prose rules + repair | `core/prose.ts` + finalizer | Off/Review/Automatic; sentence-local targeted edits with validation instead of hidden Regex artifacts. |
| Tracker delta / durable post-narration state | `buildPostTurnPrompt()` / `postTurnTool()` | Captures resources, wounds/status, tasks/commitments, facts, descriptions, relationships, reputation, plans, evidence and boundaries. |
| Scene NPC presence | semantic + archivist + state | Explicit present-NPC list is separate from historical tracker; unknown presence never clears previously known presence. |
| Player HUD / tracker widget | `frontend.ts` | Health, condition, level/XP, stats, money, inventory, gear, abilities, spells, wounds/status, tasks/commitments, world position and NPCs physically present. Background opacity is user-adjustable and persisted per user. |
| Swipe/regenerate consistency | backend transaction coordinator | Pre-turn snapshot + identical `TurnResolution` replay prevents rerolling or duplicating HP, XP, money, relationships, events, names or loot. |
| Structured-artifact hiding | Native architecture | Sidecar structured output never enters the main assistant message, so the original ST streaming-regex workaround is unnecessary. |

## Deliberate differences

- **15 starting stat points** instead of the upstream 24. This is an explicit project balance choice requested for the Lumiverse port.
- The Lumiverse port retains a **0–4 B/F/H representation** while porting the upstream relationship threshold/lock shape. This avoids a disruptive save-format rewrite.
- The original’s special synthetic adventure-opening flow is not reproduced as a chat-writing initialization step. Story Engine attaches silently to the active Lumiverse chat and begins on the user’s next real turn; existing chats can be imported.
- SillyTavern DOM observers, `.mes` selectors, ST connection-profile globals, settings-panel injection and Regex cleanup are replaced by Spindle interceptors/events/variables/personas/chat mutation/native UI.
