const iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 19.5V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Z"/><path d="M8 7h6M8 11h7M8 15h5"/></svg>';
const races = ['Aasimar', 'Angelkin', 'Arachne', 'Automaton', 'Bearkin', 'Catfolk', 'Centaur', 'Demon', 'Dhampir', 'Dragonkin', 'Dryad', 'Dwarf', 'Elf', 'Fae', 'Fairy', 'Foxkin', 'Gnome', 'Goblin', 'Half-Demon', 'Half-Elf', 'Half-Orc', 'Halfling', 'Harpy', 'Hobgoblin', 'Homunculus', 'Human', 'Hybrid', 'Kobold', 'Lamian', 'Lizardfolk', 'Merfolk', 'Minotaur', 'Mushroomfolk', 'Naga', 'Oni', 'Orc', 'Rabbitfolk', 'Revenant', 'Satyr', 'Slimekin', 'Spirit-Touched', 'Tiefling', 'Undead', 'Vampire', 'Werewolf', 'Wolfkin'];
const genres = ['Fantasy', 'Sci-fi', 'Modern', 'Slice of Life', 'Isekai', 'Urban Fantasy', 'Cyberpunk', 'Post-Apocalyptic', 'Horror', 'Supernatural', 'Superhero', 'Steampunk', 'Historical', 'Wuxia / Xianxia'];
const nameStyles = ['Balanced Fantasy', 'Modern', 'Tolkienic / Lyrical', 'Celtic', 'Norse / Old Germanic', 'Persian / Byzantine', 'Slavic', 'Classical / Romance', 'Dark Low Fantasy'];
export function setup(ctx) {
    let dashboard = null;
    let progressionOptions = null;
    let busy = '';
    const removeStyle = ctx.dom.addStyle(`
    .se-shell{padding:12px 12px 28px;display:flex;flex-direction:column;gap:12px;color:var(--lumiverse-text);font-size:13px}
    .se-hero{padding:14px;border:1px solid var(--lumiverse-border);background:var(--lumiverse-fill-subtle);border-radius:12px}
    .se-title{font-size:17px;font-weight:700;letter-spacing:.01em}.se-muted{color:var(--lumiverse-text-muted);font-size:11px;line-height:1.45}.se-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.se-between{display:flex;justify-content:space-between;gap:10px;align-items:center}
    .se-tabs{display:flex;gap:4px;overflow:auto;padding-bottom:2px;position:sticky;top:0;z-index:2;background:var(--lumiverse-bg)}.se-tab{border:1px solid var(--lumiverse-border);background:var(--lumiverse-fill);color:var(--lumiverse-text);border-radius:8px;padding:7px 9px;cursor:pointer;white-space:nowrap}.se-tab.is-active{background:var(--lumiverse-primary);color:var(--lumiverse-primary-contrast,#fff);border-color:transparent}
    .se-section{border:1px solid var(--lumiverse-border);border-radius:12px;background:var(--lumiverse-fill);overflow:hidden}.se-section>header{padding:10px 12px;border-bottom:1px solid var(--lumiverse-border);font-weight:650}.se-body{padding:12px;display:flex;flex-direction:column;gap:10px}
    .se-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.se-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.se-field{display:flex;flex-direction:column;gap:4px}.se-field label{font-size:11px;color:var(--lumiverse-text-muted)}
    .se-field input,.se-field select,.se-field textarea{width:100%;box-sizing:border-box;background:var(--lumiverse-fill-subtle);border:1px solid var(--lumiverse-border);border-radius:7px;padding:7px 8px;color:var(--lumiverse-text);font:inherit}.se-field textarea{min-height:70px;resize:vertical}
    .se-btn{border:1px solid var(--lumiverse-border);background:var(--lumiverse-fill-subtle);color:var(--lumiverse-text);border-radius:8px;padding:7px 10px;cursor:pointer;font:inherit}.se-btn:hover{filter:brightness(1.08)}.se-btn.primary{background:var(--lumiverse-primary);color:var(--lumiverse-primary-contrast,#fff);border-color:transparent}.se-btn.danger{color:var(--lumiverse-danger,#e66)}.se-btn:disabled{opacity:.55;cursor:default}
    .se-kpi{padding:9px;border:1px solid var(--lumiverse-border);border-radius:9px;background:var(--lumiverse-fill-subtle)}.se-kpi b{display:block;font-size:15px}.se-list{display:flex;flex-direction:column;gap:6px}.se-card{padding:9px;border:1px solid var(--lumiverse-border);border-radius:9px}.se-chip{display:inline-flex;padding:2px 6px;border-radius:999px;background:var(--lumiverse-fill-subtle);border:1px solid var(--lumiverse-border);font-size:10px;margin:2px}.se-code{font-family:ui-monospace,monospace;font-size:10px;white-space:pre-wrap;max-height:260px;overflow:auto;background:var(--lumiverse-fill-subtle);padding:8px;border-radius:8px}
    .se-toggle{display:flex;gap:8px;align-items:flex-start}.se-toggle input{margin-top:2px}.se-warn{padding:9px;border:1px solid color-mix(in srgb,var(--lumiverse-warning,#d9a441) 45%,transparent);border-radius:8px;background:color-mix(in srgb,var(--lumiverse-warning,#d9a441) 10%,transparent)}
    .se-widget-btn{width:100%;height:100%;border:none;border-radius:11px;background:var(--lumiverse-fill);color:var(--lumiverse-text);box-shadow:0 6px 22px rgba(0,0,0,.22);display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;font-size:10px}.se-widget-btn b{font-size:15px}.se-widget-bad{color:var(--lumiverse-danger,#e66)}
    @media(max-width:540px){.se-grid,.se-grid-3{grid-template-columns:1fr}.se-shell{padding:9px 8px 24px}}
  `);
    const tab = ctx.ui.registerDrawerTab({ id: 'story-engine', title: 'Story Engine', shortName: 'Story', description: 'Simulation, tracker, player sheet and prose guard', keywords: ['roleplay', 'tracker', 'dice', 'world', 'progression'], headerTitle: 'Story Engine', iconSvg });
    let activeView = 'overview';
    let widget = null;
    try {
        widget = ctx.ui.createFloatWidget({ width: 70, height: 64, initialPosition: { x: 18, y: 120 }, snapToEdge: true, tooltip: 'Story Engine tracker', chromeless: true });
        widget.root.innerHTML = '<button class="se-widget-btn" aria-label="Open Story Engine"><span>STORY</span><b>—</b></button>';
        widget.root.querySelector('button')?.addEventListener('click', () => tab.activate());
    }
    catch { }
    const inputAction = ctx.ui.registerInputBarAction({ id: 'open-story-engine', label: 'Open Story Engine', iconSvg, enabled: true });
    const unsubAction = inputAction.onClick(() => tab.activate());
    function request(type, extra = {}) { ctx.sendToBackend({ type, chatId: dashboard?.chatId, ...extra }); }
    function setBusy(value) { busy = value; render(); }
    function render() {
        const root = tab.root;
        root.replaceChildren();
        const shell = document.createElement('div');
        shell.className = 'se-shell';
        root.appendChild(shell);
        if (!dashboard) {
            shell.innerHTML = '<div class="se-hero"><div class="se-title">Story Engine</div><div class="se-muted">Loading native Lumiverse state…</div></div>';
            return;
        }
        const s = dashboard.state || {};
        const p = s.player;
        const settings = dashboard.settings || {};
        shell.innerHTML = `
      <div class="se-hero"><div class="se-between"><div><div class="se-title">Story Engine · Lumiverse</div><div class="se-muted">Native semantic preflight + deterministic simulation. ${dashboard.chatId ? 'Chat state loaded.' : 'Open a chat to use per-story state.'}</div></div><span class="se-chip">turn ${esc(s.turn || 0)}</span></div></div>
      <nav class="se-tabs">${['overview', 'character', 'tracker', 'progression', 'settings', 'audit'].map(v => `<button class="se-tab ${activeView === v ? 'is-active' : ''}" data-view="${v}">${cap(v)}</button>`).join('')}</nav>
      <main data-main></main>`;
        const main = shell.querySelector('[data-main]');
        if (activeView === 'overview')
            main.innerHTML = renderOverview(s, settings, p);
        else if (activeView === 'character')
            main.innerHTML = renderCharacter(s, p, busy);
        else if (activeView === 'tracker')
            main.innerHTML = renderTracker(s, p);
        else if (activeView === 'progression')
            main.innerHTML = renderProgression(s, p, progressionOptions, busy);
        else if (activeView === 'settings')
            main.innerHTML = renderSettings(settings, dashboard.connections || []);
        else
            main.innerHTML = renderAudit(s);
        wire(shell);
        updateWidget();
    }
    function wire(shell) {
        shell.querySelectorAll('[data-view]').forEach(el => el.addEventListener('click', () => { activeView = el.dataset.view || 'overview'; render(); }));
        shell.querySelector('[data-refresh]')?.addEventListener('click', () => request('get_dashboard'));
        shell.querySelector('[data-start]')?.addEventListener('click', () => request('start_adventure'));
        shell.querySelector('[data-reset]')?.addEventListener('click', async () => { const ok = await ctx.ui.showConfirm({ title: 'Reset Story Engine state?', message: 'This clears tracker, world memory, hidden health, progression and Story Engine player data for the current chat.', variant: 'danger', confirmLabel: 'Reset' }); if (ok?.confirmed === true)
            request('reset_chat_state'); });
        shell.querySelector('[data-save-settings]')?.addEventListener('click', () => { const form = shell.querySelector('#se-settings'); const fd = new FormData(form); request('save_settings', { settings: { enabled: fd.get('enabled') === 'on', semanticEnabled: fd.get('semanticEnabled') === 'on', semanticConnectionId: String(fd.get('semanticConnectionId') || ''), semanticTemperature: Number(fd.get('semanticTemperature') || .1), recentMessageCount: Number(fd.get('recentMessageCount') || 18), proseGuardMode: String(fd.get('proseGuardMode') || 'review'), proseGuardConnectionId: String(fd.get('proseGuardConnectionId') || ''), proseGuardExtraPhrases: String(fd.get('proseGuardExtraPhrases') || '').split(/\n|,/).map(x => x.trim()).filter(Boolean), randomEvents: fd.get('randomEvents') === 'on', randomEventChance: Number(fd.get('randomEventChance') || .08), proactivity: fd.get('proactivity') === 'on', powerActors: fd.get('powerActors') === 'on', progression: fd.get('progression') === 'on', trackerPostPass: fd.get('trackerPostPass') === 'on', showTrackerWidget: fd.get('showTrackerWidget') === 'on', nameStyle: String(fd.get('nameStyle') || 'Balanced Fantasy'), debug: fd.get('debug') === 'on' } }); });
        shell.querySelector('[data-create-player]')?.addEventListener('click', () => { const f = shell.querySelector('#se-character'); const fd = new FormData(f); const stats = { PHY: Number(fd.get('PHY')), MND: Number(fd.get('MND')), CHA: Number(fd.get('CHA')) }; const total = stats.PHY + stats.MND + stats.CHA; if (total !== 24) {
            alert(`Stats must total 24. Current total: ${total}.`);
            return;
        } setBusy('player'); request('create_player', { applyMode: String(fd.get('applyMode')), input: { name: String(fd.get('name') || ''), race: String(fd.get('race') || ''), genre: String(fd.get('genre') || ''), concept: String(fd.get('concept') || ''), appearance: String(fd.get('appearance') || ''), backstory: String(fd.get('backstory') || ''), stats, desiredAbilities: String(fd.get('desiredAbilities') || ''), desiredSpells: String(fd.get('desiredSpells') || ''), inventory: String(fd.get('inventory') || ''), anchors: String(fd.get('anchors') || '') } }); });
        shell.querySelector('[data-prog-options]')?.addEventListener('click', () => { setBusy('progression'); request('get_progression_options'); });
        shell.querySelector('[data-claim]')?.addEventListener('click', () => { const f = shell.querySelector('#se-progression'); const fd = new FormData(f); request('claim_milestone', { stat: String(fd.get('stat') || ''), ability: String(fd.get('ability') || ''), spell: String(fd.get('spell') || '') }); });
        shell.querySelector('[data-apply-prose]')?.addEventListener('click', () => request('apply_prose_suggestion'));
        shell.querySelector('[data-dismiss-prose]')?.addEventListener('click', () => request('dismiss_prose_review'));
    }
    function updateWidget() { if (!widget || !dashboard)
        return; const s = dashboard.state || {}, p = s.player, h = s.health?.user; widget.setVisible?.(dashboard.settings?.showTrackerWidget !== false); const b = widget.root.querySelector('button'); if (b)
        b.innerHTML = `<span>${esc(p?.name?.slice(0, 9) || 'STORY')}</span><b class="${h?.currentHp <= Math.ceil((h?.maxHp || 10) * .25) ? 'se-widget-bad' : ''}">${esc(h ? `${h.currentHp}/${h.maxHp}` : `T${s.turn || 0}`)}</b>`; }
    const unsubBackend = ctx.onBackendMessage((payload) => { if (payload?.type === 'dashboard') {
        dashboard = payload;
        busy = '';
        render();
    }
    else if (payload?.type === 'player_created') {
        busy = '';
    }
    else if (payload?.type === 'progression_options') {
        progressionOptions = payload;
        busy = '';
        activeView = 'progression';
        render();
    }
    else if (payload?.type === 'command_error') {
        busy = '';
        render();
    } });
    const unsubGen = ctx.events.on('GENERATION_ENDED', () => setTimeout(() => request('get_dashboard'), 250));
    const unsubChat = ctx.events.on('CHAT_SWITCHED', () => request('get_dashboard'));
    const unsubActivate = tab.onActivate(() => request('get_dashboard'));
    request('get_dashboard');
    return () => { unsubBackend(); unsubGen(); unsubChat(); unsubActivate(); unsubAction(); inputAction.destroy(); widget?.destroy?.(); tab.destroy(); removeStyle(); ctx.dom.cleanup(); };
}
function renderOverview(s, settings, p) {
    const h = s.health?.user;
    const pending = s.proseReview;
    return `
  <section class="se-section"><header>At a glance</header><div class="se-body"><div class="se-grid-3">
    <div class="se-kpi"><span class="se-muted">Player</span><b>${esc(p?.name || 'Not configured')}</b><span class="se-muted">${esc(p ? `${p.race} · ${p.genre}` : 'Use Character tab')}</span></div>
    <div class="se-kpi"><span class="se-muted">Hidden health</span><b>${esc(h ? `${h.currentHp} / ${h.maxHp}` : '—')}</b><span class="se-muted">kept out of narrator output</span></div>
    <div class="se-kpi"><span class="se-muted">Progression</span><b>Lv ${esc(s.progression?.level || 1)}</b><span class="se-muted">${esc(s.progression?.xp || 0)} XP · ${esc(s.progression?.pendingMilestones || 0)} pending</span></div>
  </div><div class="se-row"><button class="se-btn" data-refresh>Refresh</button><button class="se-btn primary" data-start ${!p ? 'disabled' : ''}>Start adventure</button></div></div></section>
  ${pending ? `<section class="se-section"><header>Prose Guard review</header><div class="se-body"><div class="se-warn">${pending.findings.length} finding(s) in the latest reply. Review mode never edits automatically.</div><div class="se-list">${pending.findings.slice(0, 8).map((f) => `<div class="se-card"><b>${esc(f.category)}</b><div class="se-muted">${esc(f.excerpt)}</div></div>`).join('')}</div><div class="se-row"><button class="se-btn primary" data-apply-prose>Apply minimal repair</button><button class="se-btn" data-dismiss-prose>Dismiss</button></div></div></section>` : ''}
  <section class="se-section"><header>Pipeline</header><div class="se-body"><div class="se-list"><div class="se-card"><b>1 · Semantic preflight</b><div class="se-muted">Fresh stakes only; up to three explicit actions.</div></div><div class="se-card"><b>2 · Deterministic simulation</b><div class="se-muted">Opposed rolls, hidden health, relationships, loot envelope, proactivity, random events, names and world state.</div></div><div class="se-card"><b>3 · Native prompt handoff</b><div class="se-muted">Injected as a visible Prompt Breakdown entry, not DOM/regex glue.</div></div><div class="se-card"><b>4 · Finalization</b><div class="se-muted">Prose guard, continuity archive, reputation, XP and snapshot-safe swipe reconciliation.</div></div></div></div></section>`;
}
function renderCharacter(s, p, busy) {
    return `<section class="se-section"><header>Player character</header><div class="se-body"><form id="se-character" class="se-body">
  <div class="se-grid"><div class="se-field"><label>Name</label><input name="name" value="${attr(p?.name || '')}"></div><div class="se-field"><label>Race</label><select name="race">${options(races, p?.race || 'Human')}</select></div><div class="se-field"><label>Genre</label><select name="genre">${options(genres, p?.genre || 'Fantasy')}</select></div><div class="se-field"><label>Apply result</label><select name="applyMode"><option value="convert_active">Convert/update active persona</option><option value="new_persona">Create new persona</option><option value="state_only">Story Engine state only</option></select></div></div>
  <div><div class="se-muted">Stat buy · exactly 24 points, each 1–9</div><div class="se-grid-3">${['PHY', 'MND', 'CHA'].map(k => `<div class="se-field"><label>${k}</label><input type="number" min="1" max="9" name="${k}" value="${attr(p?.stats?.[k] ?? 8)}"></div>`).join('')}</div></div>
  ${fieldArea('concept', 'Concept', p?.concept || '')}${fieldArea('appearance', 'Appearance', p?.appearance || '')}${fieldArea('backstory', 'Backstory', p?.backstory || '')}${fieldArea('desiredAbilities', 'Desired abilities', p?.abilities?.join('\n') || '')}${fieldArea('desiredSpells', 'Desired spell (max one at creation)', p?.spells?.join('\n') || '')}${fieldArea('inventory', 'Inventory / gear ideas', [...(p?.inventory || []), ...(p?.gear || [])].join('\n'))}${fieldArea('anchors', 'Character anchors', p?.anchors?.join('\n') || '')}
  <button type="button" class="se-btn primary" data-create-player ${busy === 'player' ? 'disabled' : ''}>${busy === 'player' ? 'Working…' : 'Generate & apply sheet'}</button>
  <div class="se-muted">Converting the active persona preserves its identity but rewrites its description into the Story Engine sheet format.</div>
  </form></div></section>`;
}
function renderTracker(s, p) {
    const npcs = Object.values(s.npcs || {}).sort((a, b) => b.lastSeenTurn - a.lastSeenTurn);
    const facts = [...(s.world?.facts || [])].sort((a, b) => b.salience - a.salience).slice(0, 20);
    const rep = [...(s.reputation || [])].slice(-12);
    const c = s.continuity || {};
    const favors = (c.latentFavors || []).filter((x) => x.status === 'active').slice(-8);
    const grievances = (c.latentGrievances || []).filter((x) => x.status === 'active').slice(-8);
    const knowledge = (c.userKnowledge || []).slice(-12);
    const arcs = (c.worldArcs || []).filter((x) => x.status === 'active').slice(-8);
    return `
  <section class="se-section"><header>Scene & player</header><div class="se-body"><div class="se-grid"><div class="se-kpi"><span class="se-muted">Scene</span><b>${esc(s.world?.location || 'Unknown')}</b><span class="se-muted">${esc(s.world?.area || '')} · day ${esc(s.world?.dayIndex || 1)} ${esc(s.world?.time || '')} · ${esc(s.world?.weather || '')}</span></div><div class="se-kpi"><span class="se-muted">Player</span><b>${esc(p?.name || '—')}</b><span class="se-muted">PHY ${esc(p?.stats?.PHY || '—')} · MND ${esc(p?.stats?.MND || '—')} · CHA ${esc(p?.stats?.CHA || '—')}</span></div></div></div></section>
  <section class="se-section"><header>NPC tracker · ${npcs.length}</header><div class="se-body"><div class="se-list">${npcs.length ? npcs.map(n => `<div class="se-card"><div class="se-between"><b>${esc(n.name)}</b><span class="se-chip">${esc(n.status)}</span></div><div class="se-muted">${esc(n.role)} · ${esc(n.rank)} · ${esc(n.disposition)} ${n.companion ? '· companion' : ''} ${n.powerActor ? '· power actor' : ''}</div><div><span class="se-chip">B ${esc(n.bond)}</span><span class="se-chip">F ${esc(n.fear)}</span><span class="se-chip">H ${esc(n.hostility)}</span><span class="se-chip">PHY ${esc(n.stats?.PHY)}</span><span class="se-chip">MND ${esc(n.stats?.MND)}</span><span class="se-chip">CHA ${esc(n.stats?.CHA)}</span>${n.romanceStage && n.romanceStage !== 'none' ? `<span class="se-chip">${esc(n.romanceStage)} · I ${esc(n.intimacy || 0)}</span>` : ''}${n.boundary?.active ? `<span class="se-chip">boundary</span>` : ''}${n.lootSearchCompleted ? `<span class="se-chip">searched</span>` : ''}</div>${n.personalityArchetype || n.personalitySummary ? `<div class="se-muted">${n.personalityArchetype ? `<b>${esc(n.personalityArchetype)}</b>${n.personalitySummary ? ' · ' : ''}` : ''}${n.personalitySummary ? esc(n.personalitySummary) : ''}</div>` : ''}${n.notes?.length ? `<div class="se-muted">${esc(n.notes.slice(-3).join(' · '))}</div>` : ''}</div>`).join('') : '<div class="se-muted">NPCs appear here as they become established.</div>'}</div></div></section>
  <section class="se-section"><header>Reputation</header><div class="se-body"><div class="se-list">${rep.length ? rep.map((r) => `<div class="se-card"><b>${esc(r.location)}</b> <span class="se-chip">fame ${esc(r.fame)}</span><span class="se-chip">infamy ${esc(r.infamy)}</span><span class="se-chip">fear ${esc(r.fear || 0)}</span>${r.notes?.length ? `<div class="se-muted">${esc(r.notes.slice(-2).join(' · '))}</div>` : ''}</div>`).join('') : '<div class="se-muted">No location reputation yet.</div>'}</div></div></section>
  <section class="se-section"><header>Continuity ledgers</header><div class="se-body"><div class="se-muted">Bound companion: ${esc(c.boundCompanion?.active ? c.boundCompanion.name : 'none')} · pending boundary: ${esc(c.pendingBoundary?.active ? `${c.pendingBoundary.targetNpc} / ${c.pendingBoundary.type} (${c.pendingBoundary.warnings}/${c.pendingBoundary.threshold})` : 'none')}</div><div class="se-list">${favors.map((x) => `<div class="se-card"><span class="se-chip">favor ${esc(x.magnitude)}</span> <b>${esc(x.actor)}</b> · ${esc(x.reason)}</div>`).join('')}${grievances.map((x) => `<div class="se-card"><span class="se-chip">grievance ${esc(x.magnitude)}</span> <b>${esc(x.actor)}</b> · ${esc(x.reason)}</div>`).join('')}${arcs.map((x) => `<div class="se-card"><span class="se-chip">arc ${esc(x.stage)}</span> <b>${esc(x.actor)}</b> · ${esc(x.goal)}</div>`).join('')}${knowledge.map((x) => `<div class="se-card"><span class="se-chip">${esc(x.scope)}</span><span class="se-chip">${esc(x.truth)}</span><span class="se-chip">${esc(x.confidence)}</span> ${esc(x.subject ? `${x.subject}: ` : '')}${esc(x.fact)}</div>`).join('') || (!favors.length && !grievances.length && !arcs.length ? '<div class="se-muted">No latent continuity entries yet.</div>' : '')}</div></div></section>
  <section class="se-section"><header>World memory</header><div class="se-body"><div class="se-list">${facts.length ? facts.map((f) => `<div class="se-card"><span class="se-chip">${esc(f.scope)}</span> ${esc(f.fact)}</div>`).join('') : '<div class="se-muted">No durable facts archived yet.</div>'}</div></div></section>`;
}
function renderProgression(s, p, opts, busy) {
    const pr = s.progression || {};
    return `<section class="se-section"><header>Progression</header><div class="se-body"><div class="se-grid-3"><div class="se-kpi"><span class="se-muted">Level</span><b>${esc(pr.level || 1)}</b></div><div class="se-kpi"><span class="se-muted">XP</span><b>${esc(pr.xp || 0)}</b></div><div class="se-kpi"><span class="se-muted">Milestones</span><b>${esc(pr.pendingMilestones || 0)}</b></div></div>
  ${pr.pendingMilestones > 0 && p ? `<form id="se-progression" class="se-body"><div class="se-grid"><div class="se-field"><label>+1 stat (cap 10)</label><select name="stat">${['PHY', 'MND', 'CHA'].map(k => `<option value="${k}" ${p.stats?.[k] >= 10 ? 'disabled' : ''}>${k} (${esc(p.stats?.[k])})</option>`).join('')}</select></div><div class="se-field"><label>Ability</label>${opts?.abilities?.length ? `<select name="ability">${opts.abilities.map((x) => `<option>${esc(x)}</option>`).join('')}</select>` : '<input name="ability" placeholder="Generate options or enter one">'}</div><div class="se-field"><label>Spell (optional; max 5)</label>${opts?.spells?.length ? `<select name="spell"><option value="">No spell</option>${opts.spells.map((x) => `<option>${esc(x)}</option>`).join('')}</select>` : '<input name="spell" placeholder="Optional">'}</div></div><div class="se-row"><button type="button" class="se-btn" data-prog-options ${busy === 'progression' ? 'disabled' : ''}>${busy === 'progression' ? 'Working…' : 'Generate 3 + 3 options'}</button><button type="button" class="se-btn primary" data-claim>Claim milestone</button></div></form>` : '<div class="se-muted">Every 100 XP creates a milestone. Successful challenges award 10 / 20 / 30 XP by outcome tier.</div>'}
  </div></section>`;
}
function renderSettings(s, connections) {
    return `<section class="se-section"><header>Engine settings</header><div class="se-body"><form id="se-settings" class="se-body">
  ${toggle('enabled', 'Enable Story Engine', s.enabled, 'Master switch for preflight and finalization.')}${toggle('semanticEnabled', 'Semantic preflight', s.semanticEnabled, 'Uses a quiet sidecar call to decide whether mechanics are needed.')}
  <div class="se-grid"><div class="se-field"><label>Semantic connection</label><select name="semanticConnectionId"><option value="">Current active connection</option>${connections.map(c => `<option value="${attr(c.id)}" ${c.id === s.semanticConnectionId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><div class="se-field"><label>Semantic temperature</label><input type="number" step="0.05" min="0" max="2" name="semanticTemperature" value="${attr(s.semanticTemperature ?? .1)}"></div><div class="se-field"><label>Recent messages for semantic pass</label><input type="number" min="4" max="50" name="recentMessageCount" value="${attr(s.recentMessageCount ?? 18)}"></div><div class="se-field"><label>Name style</label><select name="nameStyle">${options(nameStyles, s.nameStyle || 'Balanced Fantasy')}</select></div></div>
  ${toggle('randomEvents', 'Random event engine', s.randomEvents, 'Contextual interruptions/complications/benefits only when eligible.')}<div class="se-field"><label>Random event chance per eligible turn (0–0.5)</label><input type="number" step="0.01" min="0" max="0.5" name="randomEventChance" value="${attr(s.randomEventChance ?? .08)}"></div>
  ${toggle('proactivity', 'NPC proactivity', s.proactivity, 'Allows NPC initiative from relationship and scene pressure.')}${toggle('powerActors', 'Power actors', s.powerActors, 'Archives strategic favors, grievances, threats and delayed plans.')}${toggle('progression', 'Progression / XP', s.progression, 'Awards deterministic XP and milestones.')}${toggle('trackerPostPass', 'Post-narration continuity archivist', s.trackerPostPass, 'Captures only durable facts actually established in the final narration.')}${toggle('showTrackerWidget', 'Floating tracker widget', s.showTrackerWidget, 'Compact HP/turn shortcut.')}
  <div class="se-grid"><div class="se-field"><label>Prose Guard mode</label><select name="proseGuardMode">${options(['off', 'review', 'automatic'], s.proseGuardMode || 'review')}</select></div><div class="se-field"><label>Prose Guard connection</label><select name="proseGuardConnectionId"><option value="">Use semantic/current connection</option>${connections.map(c => `<option value="${attr(c.id)}" ${c.id === s.proseGuardConnectionId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
  ${fieldArea('proseGuardExtraPhrases', 'Additional banned phrases (one per line)', (s.proseGuardExtraPhrases || []).join('\n'))}${toggle('debug', 'Debug mode', s.debug, 'Keeps extra audit detail; never exposes hidden mechanics to narration.')}
  <div class="se-row"><button type="button" class="se-btn primary" data-save-settings>Save settings</button><button type="button" class="se-btn danger" data-reset>Reset this chat state</button></div>
  </form></div></section>`;
}
function renderAudit(s) { const audits = [...(s.audits || [])].reverse(); return `<section class="se-section"><header>Turn audit</header><div class="se-body"><div class="se-muted">Mechanical results are visible here for debugging, never injected into final prose as numbers.</div><div class="se-list">${audits.length ? audits.map((a) => `<details class="se-card"><summary><b>Turn ${esc(a.turn)}</b> · ${esc(a.summary || '')}</summary><div class="se-code">${esc(JSON.stringify({ rolls: a.rolls, xpAward: a.xpAward, proseFindings: a.proseFindings, notes: a.notes }, null, 2))}</div></details>`).join('') : '<div class="se-muted">No finalized turns yet.</div>'}</div></div></section>`; }
function fieldArea(name, label, value) { return `<div class="se-field"><label>${esc(label)}</label><textarea name="${attr(name)}">${esc(value)}</textarea></div>`; }
function toggle(name, label, checked, help) { return `<label class="se-toggle"><input type="checkbox" name="${attr(name)}" ${checked ? 'checked' : ''}><span><b>${esc(label)}</b><div class="se-muted">${esc(help)}</div></span></label>`; }
function options(values, selected) { return values.map(v => `<option value="${attr(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`).join(''); }
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function attr(v) { return esc(v); }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
