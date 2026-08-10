# Story Engine for Lumiverse

A clean-room, native **Lumiverse / Spindle** reimplementation of the behavior and feature set of ZDOSt's SillyTavern Story Engine.

This is not a compatibility shim and does not load SillyTavern APIs. It is split into a backend simulation pipeline and a frontend Lumiverse UI. Current release: **0.2.6**.

## What is included

- semantic preflight / roll gating;
- OOC Command Assistant for authoritative `((...))` state edits/retcons;
- up to three explicit action units per turn;
- deterministic opposed d20 resolution with the Story Engine combat margin tiers;
- social, mundane combat, supernatural combat, restraint, stealth and environment routing;
- hidden HP, impairment, healing DCs, once-per-damage-state natural treatment and visible persistent wound/condition tracking;
- deterministic capability-pool → persistent NPC rank/stat generation and tracker;
- Bond / Fear / Hostility relationship model, arbitrary freeform starting relationships, rapport/slow-bond progression, recognized standing, boundaries, romance/intimacy styles and NPC dispositions;
- NPC proactivity, counter-pressure and relationship-aware independent initiative;
- random contextual event engine;
- Power Actor signals and delayed off-screen plans, including indirect/covert-agent possibilities;
- world state (location, area, time slot, day, weather), descriptive archive, scheduled/NPC/faction/power-actor plans and route-based discoverable evidence;
- location-scoped reputation / fame / infamy / fear that deterministically biases new local NPC impressions once notable;
- genre-aware tier economy, quoted-price memory, protective-equipment defense tiers and corpse-gated deterministic loot envelopes with one-search persistence;
- player creation with live 15-point budget validation;
- AI conversion of the active Lumiverse persona into a separate new Story Engine persona without overwriting the source;
- automatic attachment to established chats by reading canonical saved history and reconstructing Story Engine state;
- 15-point PHY/MND/CHA stat buy; new characters receive exactly one ability and up to one optional starting spell/power with no stat requirement; persona conversion preserves established abilities/spells;
- XP milestones, stat growth, generated ability/spell options and hidden-health growth;
- unique name generator with multiple style families and a per-chat used-name ledger;
- narrator handoff injected as a native Lumiverse Prompt Breakdown entry;
- post-narration continuity archivist, user-knowledge ledger, descriptive archive, latent favors/grievances, rapport clocks, bound companion, pending boundaries and world arcs;
- Prose Guard in Off / Review / Automatic modes;
- direct message repair through Lumiverse `chat_mutation` (no regex extension dependency);
- floating player HUD (resources, objectives and NPCs present), drawer UI, settings, tracker and turn audit;
- pre-turn rollback snapshots so regenerate/swipe reuses the same mechanics without duplicating XP, damage, money, or relationships.

## Architecture

```text
src/
  backend.ts              Spindle lifecycle + transaction coordinator
  frontend.ts             Native Lumiverse drawer/widget UI
  shared/types.ts         State and contract types
  core/
    character.ts          Player creation + persona rendering
    commands.ts           OOC state mutations + existing-chat history bootstrap
    continuity.ts         Hidden continuity ledgers + boundary gates
    config.ts             Mechanics/config constants
    economy.ts            Currency, value tiers, loot
    health.ts             Hidden HP + conditions
    mechanics.ts          Rolls, outcomes, XP, proactivity
    names.ts              Local unique-name generation
    prompts.ts            Narrator + archivist handoffs
    prose.ts              Prose findings + repair contract
    relationships.ts      Bond/Fear/Hostility + romance/boundaries
    rng.ts                Seeded deterministic RNG
    semantic.ts           Sidecar ledger contract + fallback
    state.ts              Versioned persistence + rollback snapshots
    world.ts              World state, memory, events, plans
```

The core modules do not import Lumiverse APIs. Only `backend.ts` touches `spindle`; only `frontend.ts` touches the browser/frontend context. This makes the mechanics unit-testable and keeps host integration replaceable.

## Build

The ZIP already contains `dist/`, but to rebuild:

```bash
npm run build
npm test
```

No runtime npm dependency is used. The TypeScript source intentionally uses the Spindle runtime surface structurally, so a build does not require downloading type packages. If you want editor IntelliSense, add `lumiverse-spindle-types` as a dev dependency.

## Installation

Lumiverse GitHub installation expects a repository with `spindle.json` at its root. Install this extension from `https://github.com/luizram17/story-engine-lumiverse` through Lumiverse's Spindle extension manager.

The extension requests these permissions:

- `generation` — semantic/prose/continuity sidecar generations and generation lifecycle;
- `interceptor` — authoritative scene-resolution handoff;
- `chats` — active chat resolution;
- `chat_mutation` — saved-message prose repair and metadata;
- `personas` — player persona conversion/creation;
- `ui_panels` — floating tracker widget.

The main drawer tab itself is free and remains the primary UI if `ui_panels` is not granted. Connection discovery is covered by the `generation` permission.

## Chat attachment and detection

Story Engine attaches to the Lumiverse chat that is currently open; there is no Start Adventure step and it never injects a synthetic user message just to initialize itself. For operator-scoped installs, the backend resolves the current chat with the originating `userId`. The frontend also reads Lumiverse's persisted `activeChatId` setting as an independent fallback and forwards chat IDs observed in chat/message lifecycle events. This redundancy is intentional: manual actions such as character creation and history import must work even when the extension worker was started after the original `CHAT_SWITCHED` event.

If the HUD says **No active chat** while a chat is visibly open, refresh the Story Engine panel once. If it still cannot attach, treat that as a host-integration bug and capture the toast/server log rather than resetting Story Engine state.

## First use

1. Open a chat.
2. Open **Story Engine** from the drawer or input-bar Extras menu.
3. In **Character**, create or convert the active persona. PHY + MND + CHA must total 15.
4. In **Settings**, choose any of your Lumiverse Connection profiles independently for Semantic, Persona Conversion, OOC Commands, History Import, and Prose Guard. Leaving a selector empty inherits the semantic selection where applicable, then falls back to the user’s usable default Connection profile (or another usable profile with an API key); it does not depend on an implicit host “current connection”.
5. Keep Prose Guard on **Review** first. Once you like its behavior, switch to Automatic if desired.
6. Roleplay normally. Any `((double-parenthesis))` clauses are treated as OOC administrative commands, applied to Story Engine state, and removed from the IC prompt. Mechanical information is available in Tracker/Audit, but the narrator only receives a prose-safe outcome handoff.
7. If the chat already contained messages before Story Engine was enabled, the extension can import the full saved history automatically or through **Import existing history now** and reconstruct established NPCs, relationships, inventory, world state, and continuity.

For a subsystem-by-subsystem map against the upstream extension, see `PARITY_MATRIX.md`.

## Operator-scoped compatibility

The extension treats operator scope as a first-class runtime mode. Settings, active chat/persona resolution, connection profiles, and every sidecar assistant are scoped to the originating Lumiverse user. Direct generation goes through one compatibility wrapper that carries the user scope in the generation request and callback path, including runtimes that reject unscoped sidecars with `userId is required for operator-scoped extensions`.

## Upstream-parity additions in v0.2.6

The upstream source was re-audited rather than relying only on its README. This release adds several contracts that were still simplified in earlier Lumiverse builds: exactly-one starting ability and the MND 7 spell gate, richer persona preservation, rapport/slow B3→B4 relationship growth, standing influence and romance initiative style, persistent player tasks/commitments/wounds/status, NPC possessions and conditions, healing difficulty/treatment locking, contextual injury ceilings, richer descriptive/world-plan memory with discoverable evidence routes, and established/unknown world-state flags so default clock/weather values are not mistaken for observed facts.

The one intentional balance divergence is the **15-point starting stat budget** requested for this port; upstream currently uses 24. See `PARITY_MATRIX.md` for the subsystem map.

## Compatibility note

The implementation is designed against the Lumiverse Spindle APIs documented in August 2026: native prompt interceptors, direct quiet generation, persisted chat variables, personas, chat mutation, backend events, drawer tabs and float widgets. It deliberately does **not** depend on SillyTavern globals, `.mes` DOM selectors, `generate_interceptor`, connection-profile DOM state, or the SillyTavern Regex extension.

## Credits / provenance

Behavioral reference: `ZDOSt/Story-Engine` (SillyTavern extension). This project is a from-scratch Lumiverse implementation rather than a line-for-line copy. Before redistributing publicly, verify the upstream project's current license/redistribution terms and add the appropriate attribution/license files for your intended distribution.
