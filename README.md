# Story Engine for Lumiverse

A clean-room, native **Lumiverse / Spindle** reimplementation of the behavior and feature set of ZDOSt's SillyTavern Story Engine.

This is not a compatibility shim and does not load SillyTavern APIs. It is split into a backend simulation pipeline and a frontend Lumiverse UI.

## What is included

- semantic preflight / roll gating;
- OOC Command Assistant for authoritative `((...))` state edits/retcons;
- up to three explicit action units per turn;
- deterministic opposed d20 resolution with the Story Engine combat margin tiers;
- social, mundane combat, supernatural combat, restraint, stealth and environment routing;
- hidden HP and visible injury-condition derivation;
- deterministic capability-pool → persistent NPC rank/stat generation and tracker;
- Bond / Fear / Hostility relationship model, arbitrary freeform starting relationship descriptors (positive, negative or mixed), contextual first impressions, boundaries, romance/intimacy state and NPC dispositions;
- NPC proactivity, counter-pressure and relationship-aware independent initiative;
- random contextual event engine;
- Power Actor signals and delayed off-screen plans, including indirect/covert-agent possibilities;
- world state (location, area, time slot, day, weather) and durable world memory;
- location-scoped reputation / fame / infamy / fear that deterministically biases new local NPC impressions once notable;
- genre-aware tier economy, quoted-price memory, protective-equipment defense tiers and corpse-gated deterministic loot envelopes with one-search persistence;
- player creation with live 15-point budget validation;
- AI conversion of the active Lumiverse persona into a separate new Story Engine persona without overwriting the source;
- automatic attachment to established chats by reading canonical saved history and reconstructing Story Engine state;
- 15-point PHY/MND/CHA stat buy, starting abilities/spells/inventory;
- XP milestones, stat growth, generated ability/spell options and hidden-health growth;
- unique name generator with multiple style families and a per-chat used-name ledger;
- narrator handoff injected as a native Lumiverse Prompt Breakdown entry;
- post-narration continuity archivist, user-knowledge ledger, descriptive archive, latent favors/grievances, rapport clocks, bound companion, pending boundaries and world arcs;
- Prose Guard in Off / Review / Automatic modes;
- direct message repair through Lumiverse `chat_mutation` (no regex extension dependency);
- floating tracker widget, drawer UI, settings, tracker and turn audit;
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

## First use

1. Open a chat.
2. Open **Story Engine** from the drawer or input-bar Extras menu.
3. In **Character**, create or convert the active persona. PHY + MND + CHA must total 15.
4. In **Settings**, choose any of your Lumiverse Connection profiles independently for Semantic, Persona Conversion, OOC Commands, History Import, and Prose Guard. Leaving a selector empty inherits the semantic/current connection; missing or unusable saved profiles fall back safely.
5. Keep Prose Guard on **Review** first. Once you like its behavior, switch to Automatic if desired.
6. Roleplay normally. Any `((double-parenthesis))` clauses are treated as OOC administrative commands, applied to Story Engine state, and removed from the IC prompt. Mechanical information is available in Tracker/Audit, but the narrator only receives a prose-safe outcome handoff.
7. If the chat already contained messages before Story Engine was enabled, the extension can import the full saved history automatically or through **Import existing history now** and reconstruct established NPCs, relationships, inventory, world state, and continuity.

For a subsystem-by-subsystem map against the upstream extension, see `PARITY_MATRIX.md`.

## Operator-scoped compatibility

Version 0.2.2 hardens user scoping for Lumiverse operator installations: active chat/persona discovery is resolved against the frontend user, direct assistant generations carry that same user scope, and `PERSONA_CHANGED` refreshes the conversion panel immediately. This prevents one user's active persona, connection, or assistant call from being resolved as an unscoped operator request.

## Compatibility note

The implementation is designed against the Lumiverse Spindle APIs documented in August 2026: native prompt interceptors, direct quiet generation, persisted chat variables, personas, chat mutation, backend events, drawer tabs and float widgets. It deliberately does **not** depend on SillyTavern globals, `.mes` DOM selectors, `generate_interceptor`, connection-profile DOM state, or the SillyTavern Regex extension.

## Credits / provenance

Behavioral reference: `ZDOSt/Story-Engine` (SillyTavern extension). This project is a from-scratch Lumiverse implementation rather than a line-for-line copy. Before redistributing publicly, verify the upstream project's current license/redistribution terms and add the appropriate attribution/license files for your intended distribution.
