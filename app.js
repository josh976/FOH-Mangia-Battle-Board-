// ============================================================
// MANGIA BATTLE BOARD — App logic
// ============================================================

const STATE = {
  meta: { eventTitle:'', invoiceNumber:'', eventDate:'', guestCount:'', guestCountNum:null,
          serviceStyle:'', venue:'', contact:'', occasion:'', salesRep:'',
          staffRestrooms:'', staffParking:'' },
  staff: [],
  timeline: [],
  menuItems: [], // [{name, notes, qty, category}] — parsed food items for display
  dietFlags: [],
  refSections: [], // [{name, text}]
  eventOverview: '',
  layoutLocations: [], // [{source, text}] — surfaced separately from refSections
  responsibilityMatrix: [], // [{group,key,label,options,value,auto,matchedText,matchedSource}]
  buffetLayout: {
    coldItems: [ // editable per-event, defaults to standard cold line
      { id:'cold_cutlery', label:'Cutlery', shape:'rect' },
      { id:'cold_butter',  label:'Butter',  shape:'circle' },
      { id:'cold_bread',   label:'Bread',   shape:'rect-rotated' },
      { id:'cold_salad',   label:'Salad',   shape:'circle' },
    ],
    hotItems: [], // [{name, category, notes}] — user-editable order
  },
  dishLookup: {},
  attachments: [], // [{id, name, dataUrl}] — reference images, excluded from print
  alwaysOnApplied: false, // track whether always-on tasks have been inserted this session
  customTemplates: null, // null = use hardcoded defaults; object = user-edited overrides
};

let dragSrcId = null;

// ============================================================
// TRIGGER TEMPLATES
// Each template fires off a recognized timeline row-name pattern
// (matched during parsing — see parser.js TRIGGER_PATTERNS).
// Steps are offset-minutes relative to the trigger row's time.
// Generated rows are normal, fully editable timeline rows —
// the template only runs once, at insert time.
// ============================================================
const TRIGGER_TEMPLATES = {
  buffet_open: {
    label: 'Buffet open sequence',
    anchorLabel: 'Buffet Open',
    steps: [
      { offset:-60, name:'Erect buffet table, set linen', team:'FOH' },
      { offset:-50, name:'Set decor on buffet line', team:'FOH' },
      { offset:-40, name:'Fill chafers with water', team:'BOH' },
      { offset:-15, name:'Light chafers', team:'BOH' },
      { offset:-10, name:'Team tasting — lead preps tasting plate, reviews menu + diet call-outs + serving sizes for FOH', team:'BOH+FOH' },
      { offset:-5,  name:'Land food in chafers', team:'BOH' },
      { offset:0,   name:'Start serving', team:'FOH' },
    ],
  },
  buffet_close: {
    label: 'Buffet close sequence',
    anchorLabel: 'Buffet Close',
    steps: [
      { offset:0,  name:'Final bussing call — ensure all guests served', team:'FOH' },
      { offset:5,  name:'Pull chafers, extinguish fuel', team:'BOH' },
      { offset:10, name:'Box leftovers per client instructions', team:'BOH' },
      { offset:15, name:'Break down buffet line, strike linens', team:'FOH' },
    ],
  },
  bar_start: {
    label: 'Bar open sequence',
    anchorLabel: 'Bar Start',
    steps: [
      { offset:-30, name:'Set up bar station, ice + working well', team:'Bar' },
      { offset:-15, name:'Stock back bar, organize bottles/mixers', team:'Bar' },
      { offset:-5,  name:'Final bar check — glassware, garnish, signage', team:'Bar' },
      { offset:0,   name:'Open bar service', team:'Bar' },
    ],
  },
  bar_end: {
    label: 'Bar close sequence',
    anchorLabel: 'Bar End',
    steps: [
      { offset:0,  name:'Last call announced', team:'Bar' },
      { offset:10, name:'Close bar service', team:'Bar' },
      { offset:15, name:'Pack remaining product, clean + wrap barware', team:'Bar' },
    ],
  },
  stations_start: {
    label: 'Cocktail hour open',
    anchorLabel: 'Cocktail Hour Start',
    steps: [
      { offset:-20, name:'Set stationary app table / passed app trays', team:'FOH' },
      { offset:-10, name:'Diet-flagged apps set aside + labeled', team:'BOH' },
      { offset:0,   name:'Begin passing apps', team:'FOH' },
    ],
  },
  stations_end: {
    label: 'Cocktail hour close',
    anchorLabel: 'Cocktail Hour End',
    steps: [
      { offset:0,  name:'Clear app trays, wipe down station', team:'FOH' },
      { offset:5,  name:'Guide guests toward next phase (per planner/DJ cue)', team:'FOH' },
    ],
  },
  final_strike: {
    label: 'Final strike sequence',
    anchorLabel: 'Strike',
    steps: [
      { offset:0,  name:'Full buss of all Mangia disposables', team:'FOH' },
      { offset:10, name:'Break down service stations', team:'FOH' },
      { offset:20, name:'Load BOH equipment to truck', team:'BOH' },
      { offset:30, name:'Final site walk — leave area clean', team:'FOH+BOH' },
      { offset:40, name:'Check out with Captain / BOH Lead before departing', team:'All' },
    ],
  },
  flip_buffet: {
    label: 'Flip buffet sequence',
    anchorLabel: 'Flip Buffet',
    steps: [
      { offset:-15, name:'Clear cocktail hour setup — apps trays, napkins, décor', team:'FOH' },
      { offset:-10, name:'Wipe down and reset buffet table surface', team:'FOH' },
      { offset:-5,  name:'Set dinner buffet layout — linens, serving vessels, labels', team:'FOH' },
      { offset:0,   name:'Buffet ready for dinner service', team:'FOH' },
    ],
  },
};

// ============================================================
// ALWAYS-ON TASKS
// Inserted automatically on import for events meeting the condition.
// Generates normal, fully-editable timeline rows same as trigger
// templates — the "auto" only runs once, at import time.
// ============================================================
const ALWAYS_ON_TASKS = [
  {
    key: 'serve_bride_groom',
    name: 'Serve Bride & Groom',
    note: 'BOH Lead: plate dual proteins, one of each side. Deliver to B&G table before buffet opens to guests.',
    team: 'BOH',
    // Condition: wedding occasion AND cook onsite service style
    condition: (meta) => /wedding/i.test(meta.occasion) && /cook\s*onsite/i.test(meta.serviceStyle),
    // Timing: T-5 before the first food service row (Buffet Open, Plated, etc.)
    anchorStyle: ['Buffet', 'Plated', 'Family Style'],
    offsetMinutes: -5,
    highlight: true, // auto-highlighted yellow — it's critical
  },
];

// Insert always-on tasks into STATE.timeline. Called after worksheet import
// and after trigger templates have been applied. Safe to call multiple times —
// checks STATE.alwaysOnApplied to prevent duplicates.
function applyAlwaysOnTasks() {
  if (STATE.alwaysOnApplied) return;
  ALWAYS_ON_TASKS.forEach(task => {
    if (!task.condition(STATE.meta)) return;
    // Find the anchor: first timeline row matching anchorStyle
    const anchor = STATE.timeline.find(t => task.anchorStyle.includes(t.style) && t.timeMinutes != null);
    if (!anchor) return;
    const newTime = anchor.timeMinutes + task.offsetMinutes;
    STATE.timeline.push({
      id: 'tl_' + Math.random().toString(36).slice(2, 9),
      name: task.name,
      time: minutesToTime(newTime),
      timeMinutes: newTime,
      note: task.note,
      style: anchor.style,
      trigger: null,
      team: task.team,
      source: 'always-on',
      generated: true,
      highlight: task.highlight || false,
      assignedStaff: [],
    });
  });
  // Always-on: BOH Lead checkout — every staffed event, always last
  // Uses the last timeline row's time + 30min as its time
  if (STATE.timeline.length) {
    const lastTimed = [...STATE.timeline].filter(t => t.timeMinutes != null)
      .sort((a, b) => b.timeMinutes - a.timeMinutes)[0];
    const checkoutTime = lastTimed ? lastTimed.timeMinutes + 30 : null;
    STATE.timeline.push({
      id: 'tl_' + Math.random().toString(36).slice(2, 9),
      name: 'Check out with Captain / BOH Lead',
      time: checkoutTime ? minutesToTime(checkoutTime) : '',
      timeMinutes: checkoutTime,
      note: 'Return name tags, aprons, towels. Sign out of book and Nowsta. Confirm with lead before leaving.',
      style: 'General',
      trigger: null,
      team: 'All',
      source: 'always-on',
      generated: true,
      highlight: false,
      assignedStaff: [],
    });
  }
  STATE.alwaysOnApplied = true;
  sortTimelineByTime();
}

// ---- rate-based duration helper (guest_count x rate ÷ staff_assigned) ----
// Exposed for the place-settings task and similar scale-dependent items.
// Returns whole minutes.
function rateBasedMinutes(guestCount, minutesPerGuest, staffAssigned) {
  if (!guestCount || !minutesPerGuest || !staffAssigned) return null;
  return Math.round((guestCount * minutesPerGuest) / staffAssigned);
}

// ============================================================
// TOAST
// ============================================================
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ============================================================
// META RENDER
// ============================================================
const META_FIELDS = [
  ['eventTitle','Event title',false],
  ['invoiceNumber','Invoice #',false],
  ['eventDate','Event date',false],
  ['guestCount','Guest count',false],
  ['serviceStyle','Service style',false],
  ['occasion','Occasion',false],
  ['venue','Venue', true],
  ['contact','Contact', true],
  ['staffParking','Staff parking location', false],
  ['staffRestrooms','Staff restrooms location', false],
];

function renderMeta() {
  const grid = document.getElementById('meta-grid');
  grid.innerHTML = '';
  META_FIELDS.forEach(([key, label, isLong]) => {
    const wrap = document.createElement('div');
    wrap.className = 'meta-field' + (isLong ? ' span-2' : '');
    const lab = document.createElement('label');
    lab.className = 'field-label';
    lab.textContent = label;
    wrap.appendChild(lab);
    let input;
    if (isLong) {
      input = document.createElement('textarea');
      input.value = STATE.meta[key] || '';
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = STATE.meta[key] || '';
    }
    input.addEventListener('input', (e) => {
      STATE.meta[key] = e.target.value;
      if (key === 'guestCount') {
        const m = (e.target.value || '').match(/\d+/);
        STATE.meta.guestCountNum = m ? parseInt(m[0], 10) : null;
      }
    });
    wrap.appendChild(input);
    grid.appendChild(wrap);
  });
}

// ============================================================
// DIET PANEL RENDER
// ============================================================
function renderDiet() {
  const section = document.getElementById('section-diet');
  const panel = document.getElementById('diet-panel');
  if (!STATE.dietFlags.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  panel.innerHTML = '<div class="diet-panel-title">Flagged diet / allergy items — confirm before service</div>';
  STATE.dietFlags.forEach(f => {
    const row = document.createElement('div');
    row.className = 'diet-flag';
    row.innerHTML = `<span class="diet-source">${escapeHtml(f.source)}:</span> ${escapeHtml(f.text)}`;
    panel.appendChild(row);
  });
}

// ============================================================
// EVENT OVERVIEW RENDER
// ============================================================
function renderOverview() {
  const section = document.getElementById('section-overview');
  const body = document.getElementById('overview-body');
  if (!STATE.eventOverview && !section.dataset.userTouched) {
    section.style.display = 'none';
  } else {
    section.style.display = '';
  }
  body.value = STATE.eventOverview || '';
}

// ============================================================
// LAYOUT & LOCATIONS RENDER
// "Where does stuff go" surfaced prominently and early — staff orient
// around this before anything else. Editable like everything else;
// each source block is a plain textarea so it can be corrected/added to
// without fighting a rigid structure (location notes are prose, not data).
// ============================================================
function renderLayoutLocations() {
  const section = document.getElementById('section-layout');
  const body = document.getElementById('layout-body');
  const hasContent = STATE.layoutLocations && STATE.layoutLocations.length;
  if (!hasContent) { section.style.display = 'none'; return; }
  section.style.display = '';
  body.innerHTML = '';

  STATE.layoutLocations.forEach((block, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'layout-block';

    const label = document.createElement('div');
    label.className = 'layout-block-label';
    label.textContent = block.source;
    wrap.appendChild(label);

    const textarea = document.createElement('textarea');
    textarea.className = 'layout-block-text';
    textarea.value = block.text;
    textarea.addEventListener('input', e => { STATE.layoutLocations[idx].text = e.target.value; });
    wrap.appendChild(textarea);

    body.appendChild(wrap);
  });
}

// ============================================================
// RESPONSIBILITY MATRIX RENDER
// ============================================================
function groupBy(arr, keyFn) {
  const out = {};
  arr.forEach(item => {
    const k = keyFn(item);
    (out[k] = out[k] || []).push(item);
  });
  return out;
}

function renderResponsibility() {
  const section = document.getElementById('section-responsibility');
  const body = document.getElementById('responsibility-body');
  if (!STATE.responsibilityMatrix.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  body.innerHTML = '';

  const groups = groupBy(STATE.responsibilityMatrix, t => t.group);
  Object.entries(groups).forEach(([groupName, items]) => {
    const groupWrap = document.createElement('div');
    groupWrap.className = 'resp-group';
    const groupTitle = document.createElement('div');
    groupTitle.className = 'resp-group-title';
    groupTitle.textContent = groupName;
    groupWrap.appendChild(groupTitle);

    items.forEach(item => {
      const row = document.createElement('div');
      // Beverage reminder gets a special flag treatment rather than a toggle
      if (item.isReminder && item.value === 'Y') {
        row.className = 'resp-row resp-reminder';
        row.innerHTML = `<span class="resp-reminder-flag">⚑</span><span class="resp-label">${escapeHtml(item.label)}</span><span class="resp-reminder-note">Confirm FOH sets before service</span>`;
        groupWrap.appendChild(row);
        return;
      }
      if (item.isReminder) {
        row.className = 'resp-row resp-reminder-inactive';
        row.innerHTML = `<span class="resp-label resp-label-dim">${escapeHtml(item.label)}</span><span class="resp-reminder-note resp-note-dim">Not on menu</span>`;
        groupWrap.appendChild(row);
        return;
      }

      row.className = 'resp-row';
      const label = document.createElement('div');
      label.className = 'resp-label';
      label.textContent = item.label;
      if (item.auto) {
        const tag = document.createElement('span');
        tag.className = 'resp-auto-tag';
        tag.textContent = 'auto';
        tag.title = `Detected from: "${item.matchedText}" (${item.matchedSource})`;
        label.appendChild(tag);
      }
      row.appendChild(label);

      // Build toggle options from item.options array (supports Y/N and multi-option)
      const toggle = document.createElement('div');
      toggle.className = 'resp-toggle';
      const opts = item.options || ['Y','N'];
      // Add "—" (unset) option
      const allOpts = [...opts, '—'];
      allOpts.forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const isActive = opt === '—' ? item.value === null : item.value === opt;
        let activeClass = '';
        if (isActive) {
          if (opt === '—') activeClass = ' active-unset';
          // Mangia-affirmative = green
          else if (['Y','Mangia','Full clear','Mangia sets','Full service','Prefill only','Assist','Mangia handles','Mangia sets up'].includes(opt)) activeClass = ' active-y';
          // Client / third party = amber (happening but not ours)
          else if (['Client provided','Third party','Client','Client handles','Venue sets'].includes(opt)) activeClass = ' active-client';
          // Not happening = red/muted
          else if (['N','None'].includes(opt)) activeClass = ' active-n';
          else activeClass = ' active-y'; // fallback
        }
        btn.className = 'resp-btn' + activeClass;
        btn.textContent = opt;
        btn.title = opt;
        btn.addEventListener('click', () => {
          item.value = opt === '—' ? null : opt;
          item.auto = false;
          renderResponsibility();
        });
        toggle.appendChild(btn);
      });
      row.appendChild(toggle);

      // Per-row notes field for qualifiers (e.g. "within labor block only")
      if (!item.isReminder) {
        const noteInput = document.createElement('input');
        noteInput.type = 'text';
        noteInput.className = 'resp-row-note no-print';
        noteInput.placeholder = 'Note…';
        noteInput.value = item.note || '';
        noteInput.addEventListener('blur', e => { item.note = e.target.value.trim() || null; });
        noteInput.addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
        row.appendChild(noteInput);
      }

      groupWrap.appendChild(row);
    });
    body.appendChild(groupWrap);
  });
}

// ============================================================
// BUFFET LAYOUT RENDER
// Real spatial table diagram. Cold line is now per-event editable
// (same edit-list pattern as hot items). Plates always on the left
// as guest entry point — guests pick up a plate then move right
// through cold line, then hot line (veggie → starch → protein).
// ============================================================
function renderBuffetLayout() {
  const section = document.getElementById('section-buffet');
  const body = document.getElementById('buffet-body');
  const hasHots = STATE.buffetLayout.hotItems && STATE.buffetLayout.hotItems.length;
  const hasColds = STATE.buffetLayout.coldItems && STATE.buffetLayout.coldItems.length;
  const isBuffetEvent = /buffet/i.test(STATE.meta.serviceStyle || '') || STATE.timeline.some(t => t.style === 'Buffet');
  if (!hasHots && !hasColds && !isBuffetEvent) { section.style.display = 'none'; return; }
  section.style.display = '';
  body.innerHTML = '';

  body.appendChild(buildBuffetDiagramSVG(STATE.buffetLayout.hotItems));

  // ---- Edit lists: cold first, then hot, side by side on screen ----
  const editRow = document.createElement('div');
  editRow.className = 'buffet-edit-row-wrap no-print';
  editRow.style.cssText = 'display:flex;gap:24px;margin-top:12px;border-top:1px solid var(--line);padding-top:12px;';

  // Cold line edit column
  const coldCol = document.createElement('div');
  coldCol.style.cssText = 'flex:1;min-width:0;';
  const coldHead = document.createElement('div');
  coldHead.className = 'buffet-col-head';
  coldHead.textContent = 'Cold line items';
  coldCol.appendChild(coldHead);
  (STATE.buffetLayout.coldItems || []).forEach((item, idx) => {
    coldCol.appendChild(renderColdEditRow(item, idx));
  });
  const addColdBtn = document.createElement('button');
  addColdBtn.className = 'btn-sm btn-ghost';
  addColdBtn.style.marginTop = '6px';
  addColdBtn.textContent = '+ Add cold item';
  addColdBtn.addEventListener('click', () => {
    if (!STATE.buffetLayout.coldItems) STATE.buffetLayout.coldItems = [];
    STATE.buffetLayout.coldItems.push({ id:'cold_'+Math.random().toString(36).slice(2,7), label:'New item', shape:'rect' });
    renderBuffetLayout();
  });
  coldCol.appendChild(addColdBtn);
  editRow.appendChild(coldCol);

  // Hot line edit column
  const hotCol = document.createElement('div');
  hotCol.style.cssText = 'flex:2;min-width:0;';
  const hotHead = document.createElement('div');
  hotHead.className = 'buffet-col-head';
  hotHead.textContent = 'Hot line items (veggie → starch → protein)';
  hotCol.appendChild(hotHead);
  if (!hasHots) {
    const empty = document.createElement('div');
    empty.className = 'buffet-hot-empty';
    empty.textContent = 'No hot items detected — add manually below';
    hotCol.appendChild(empty);
  } else {
    STATE.buffetLayout.hotItems.forEach((item, idx) => {
      hotCol.appendChild(renderBuffetEditRow(item, idx));
    });
  }
  const addHotBtn = document.createElement('button');
  addHotBtn.className = 'btn-sm btn-ghost';
  addHotBtn.style.marginTop = '6px';
  addHotBtn.textContent = '+ Add hot item';
  addHotBtn.addEventListener('click', () => {
    STATE.buffetLayout.hotItems.push({ name: 'New item', category: null, notes: '' });
    renderBuffetLayout();
  });
  hotCol.appendChild(addHotBtn);
  editRow.appendChild(hotCol);
  body.appendChild(editRow);

  const note = document.createElement('div');
  note.className = 'buffet-note';
  note.textContent = BUFFET_LAYOUT_DEFAULTS.hotLineNote;
  body.appendChild(note);
}

// Cold line item edit row — simpler than hot (just label + shape + delete)
function renderColdEditRow(item, idx) {
  const row = document.createElement('div');
  row.className = 'buffet-edit-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = item.label;
  nameInput.className = 'buffet-hot-name';
  nameInput.addEventListener('input', e => { item.label = e.target.value; refreshBuffetDiagramOnly(); });
  row.appendChild(nameInput);
  const shapeSel = document.createElement('select');
  shapeSel.className = 'buffet-hot-cat';
  [['rect','Rect'],['circle','Round'],['rect-rotated','Basket']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    if (item.shape === v) o.selected = true;
    shapeSel.appendChild(o);
  });
  shapeSel.addEventListener('change', e => { item.shape = e.target.value; renderBuffetLayout(); });
  row.appendChild(shapeSel);
  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn no-print';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => {
    STATE.buffetLayout.coldItems.splice(idx, 1);
    renderBuffetLayout();
  });
  row.appendChild(delBtn);
  return row;
}

const CATEGORY_COLOR_CLASS = { veggie:'cat-veggie', starch:'cat-starch', protein:'cat-protein' };
const CATEGORY_SVG_FILL = { veggie:'var(--leafy-soft)', starch:'#FBF3DC', protein:'#FBF0E6', null:'var(--paper)' };
const CATEGORY_SVG_STROKE = { veggie:'var(--leafy)', starch:'var(--gold)', protein:'var(--orange)', null:'var(--line-strong)' };

// ---- builds the visual diagram as a real <svg> ----
// Layout direction: guest enters at plates (left), picks up a plate, moves RIGHT
// through cold line (bread, salad, etc.) then hot line (veggie → starch → protein).
// Cold items are per-event editable via STATE.buffetLayout.coldItems.
function buildBuffetDiagramSVG(hotItems) {
  const wrap = document.createElement('div');
  wrap.className = 'buffet-svg-wrap';

  const coldItems = (STATE.buffetLayout.coldItems || []);
  const tableY = 10, tableH = 100;
  const plateW = 50, gap = 35;

  // Plates section (guest entry point, far left)
  const plateX = 0;
  const plateSectionW = plateW + 20;

  // Arrow + cold table
  const coldTableX = plateSectionW + gap;
  const coldTableW = Math.max(200, coldItems.length * 68);

  // Arrow + hot table
  const hotTableX = coldTableX + coldTableW + gap;
  const hotCount = Math.max(hotItems.length, 1);
  const hotTableW = Math.max(200, hotCount * 115);

  const totalW = hotTableX + hotTableW + 20;

  let svg = `<svg class="buffet-diagram" viewBox="0 0 ${totalW} 215" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs><marker id="bf-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L6,3 L0,6 Z" fill="var(--line-strong)"/></marker></defs>`;

  // Plates — guest START point on the far left
  svg += `<text x="${plateSectionW/2}" y="130" text-anchor="middle" class="buf-start-tag" style="font-style:normal;font-weight:700;fill:var(--charcoal);">start</text>`;
  svg += `<circle cx="${plateSectionW/2}" cy="32" r="14" class="buf-plate"/>
    <circle cx="${plateSectionW/2}" cy="57" r="14" class="buf-plate"/>
    <circle cx="${plateSectionW/2}" cy="82" r="14" class="buf-plate"/>
    <text x="${plateSectionW/2}" y="115" text-anchor="middle" class="buf-sublabel">Plates</text>`;

  // Arrow plates → cold
  svg += `<path d="M${plateSectionW},55 L${coldTableX-7},55" class="buf-flow-arrow" marker-end="url(#bf-arrow)"/>`;

  // Cold line table — from editable STATE.buffetLayout.coldItems
  svg += `<rect x="${coldTableX}" y="${tableY}" width="${coldTableW}" height="${tableH}" rx="4" class="buf-table"/>`;
  if (!coldItems.length) {
    svg += `<text x="${coldTableX+coldTableW/2}" y="${tableY+55}" text-anchor="middle" class="buf-sublabel" style="font-style:italic;">no cold items</text>`;
  } else {
    const cpad = 10, cgap = 6;
    const cslotW = (coldTableW - cpad*2 - cgap*(coldItems.length-1)) / coldItems.length;
    coldItems.forEach((ci, i) => {
      const x = coldTableX + cpad + i * (cslotW + cgap);
      const cx = x + cslotW/2;
      const cy = tableY + 30;
      if (ci.shape === 'circle') {
        const r = Math.min(22, cslotW/2 - 4);
        svg += `<circle cx="${cx}" cy="${cy}" r="${r}" class="buf-cold-item"/>`;
      } else if (ci.shape === 'rect-rotated') {
        const rw = Math.min(50, cslotW-8), rh = 38;
        svg += `<rect x="${cx-rw/2}" y="${cy-rh/2}" width="${rw}" height="${rh}" rx="2" class="buf-cold-item" transform="rotate(15 ${cx} ${cy})"/>`;
      } else {
        const rw = Math.min(50, cslotW-8);
        svg += `<rect x="${cx-rw/2}" y="${tableY+10}" width="${rw}" height="38" rx="2" class="buf-cold-item"/>`;
      }
      // label below shape
      const shortLabel = escapeHtml(ci.label).slice(0, 12);
      svg += `<text x="${cx}" y="${tableY+72}" text-anchor="middle" class="buf-sublabel">${shortLabel}</text>`;
    });
  }
  svg += `<text x="${coldTableX+coldTableW/2}" y="${tableY+87}" text-anchor="middle" class="buf-section-label">cold line</text>`;

  // Arrow cold → hot
  svg += `<path d="M${coldTableX+coldTableW},55 L${hotTableX-7},55" class="buf-flow-arrow" marker-end="url(#bf-arrow)"/>`;

  // Hot line table
  svg += `<rect x="${hotTableX}" y="${tableY}" width="${hotTableW}" height="${tableH}" rx="4" class="buf-table"/>`;
  if (!hotItems.length) {
    svg += `<text x="${hotTableX+hotTableW/2}" y="${tableY+55}" text-anchor="middle" class="buf-sublabel" style="font-style:italic;">no hot items yet</text>`;
  } else {
    const hpad = 10, hgap = 5;
    const slotW = (hotTableW - hpad*2 - hgap*(hotCount-1)) / hotCount;
    hotItems.forEach((item, i) => {
      const x = hotTableX + hpad + i * (slotW + hgap);
      const fill = CATEGORY_SVG_FILL[item.category] || CATEGORY_SVG_FILL[null];
      const stroke = CATEGORY_SVG_STROKE[item.category] || CATEGORY_SVG_STROKE[null];
      const dash = item.category ? '' : 'stroke-dasharray="4,3"';
      svg += `<rect x="${x}" y="${tableY+10}" width="${slotW}" height="80" rx="2"
        fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${dash}/>`;
      const words = escapeHtml(item.name).split(' ');
      let lines = [], cur = '';
      const maxChars = Math.max(8, Math.floor(slotW / 7));
      words.forEach(w => {
        if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; }
        else cur = (cur ? cur + ' ' : '') + w;
      });
      if (cur) lines.push(cur);
      lines = lines.slice(0, 2);
      const labelY = tableY + 50 - (lines.length - 1) * 6;
      lines.forEach((line, li) => {
        svg += `<text x="${x+slotW/2}" y="${labelY + li*12}" text-anchor="middle" class="buf-sublabel" style="font-weight:600;">${line}</text>`;
      });
      svg += `<text x="${x+slotW/2}" y="${tableY+82}" text-anchor="middle" class="buf-sublabel" style="font-size:8px;opacity:.75;">${item.category || '?'}</text>`;
    });
  }
  svg += `<text x="${hotTableX+hotTableW/2}" y="${tableY+87}" text-anchor="middle" class="buf-section-label">hot line</text>
    <text x="${hotTableX+hotTableW/2}" y="${tableY+98}" text-anchor="middle" class="buf-sublabel" style="font-size:8.5px;font-style:italic;">veggie &#8594; starch &#8594; protein (least to most expensive)</text>`;

  // Guest flow arc beneath the whole diagram
  svg += `<path d="M${plateSectionW/2},145 C ${totalW*0.3},175 ${totalW*0.65},175 ${totalW-10},145" class="buf-flow-arrow" stroke-dasharray="2,3" marker-end="url(#bf-arrow)"/>
    <text x="${totalW/2}" y="193" text-anchor="middle" class="buf-sublabel" style="font-style:italic;">guest flow &#8594;</text>`;

  svg += `</svg>`;
  wrap.innerHTML = svg;
  return wrap;
}

// ---- compact editable row, synced to the same hotItems array the diagram reads ----
function renderBuffetEditRow(item, idx) {
  const row = document.createElement('div');
  row.className = 'buffet-edit-row';
  row.draggable = true;
  row.dataset.idx = idx;

  row.addEventListener('dragstart', () => { dragSrcId = 'buffet_' + idx; row.style.opacity = '.4'; });
  row.addEventListener('dragend', () => row.style.opacity = '1');
  row.addEventListener('dragover', e => e.preventDefault());
  row.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragSrcId || !String(dragSrcId).startsWith('buffet_')) return;
    const fromIdx = parseInt(String(dragSrcId).replace('buffet_',''), 10);
    if (fromIdx === idx) return;
    const arr = STATE.buffetLayout.hotItems;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(idx, 0, moved);
    renderBuffetLayout();
  });

  const handle = document.createElement('span');
  handle.className = 'tl-drag';
  handle.textContent = '⠿';
  row.appendChild(handle);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = item.name;
  nameInput.className = 'buffet-hot-name';
  nameInput.addEventListener('input', e => { item.name = e.target.value; refreshBuffetDiagramOnly(); });
  row.appendChild(nameInput);

  const catSel = document.createElement('select');
  catSel.className = 'buffet-hot-cat';
  [['','—'],['veggie','Veggie'],['starch','Starch'],['protein','Protein']].forEach(([v,l]) => {
    const o = document.createElement('option'); o.value = v; o.textContent = l;
    if ((item.category||'') === v) o.selected = true;
    catSel.appendChild(o);
  });
  catSel.addEventListener('change', e => {
    item.category = e.target.value || null;
    renderBuffetLayout();
  });
  row.appendChild(catSel);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn no-print';
  delBtn.textContent = '✕';
  delBtn.title = 'Remove';
  delBtn.addEventListener('click', () => {
    STATE.buffetLayout.hotItems.splice(idx, 1);
    renderBuffetLayout();
  });
  row.appendChild(delBtn);

  return row;
}

// cheap re-render of just the diagram (used on every keystroke in the name field,
// so we don't tear down/rebuild the edit list — and lose input focus — on each keypress)
function refreshBuffetDiagramOnly() {
  const body = document.getElementById('buffet-body');
  const oldSvgWrap = body.querySelector('.buffet-svg-wrap');
  if (!oldSvgWrap) return;
  const newSvgWrap = buildBuffetDiagramSVG(STATE.buffetLayout.hotItems);
  body.replaceChild(newSvgWrap, oldSvgWrap);
}

// ============================================================
// STAFF ROSTER RENDER
// ============================================================
function renderRoster() {
  const body = document.getElementById('roster-body');
  const empty = document.getElementById('roster-empty');
  body.innerHTML = '';
  if (!STATE.staff.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  STATE.staff.forEach(s => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.appendChild(editableText(s.name, v => s.name = v));
    tr.appendChild(tdName);

    const tdRole = document.createElement('td');
    tdRole.appendChild(editableText(s.position, v => s.position = v));
    tr.appendChild(tdRole);

    const tdTeam = document.createElement('td');
    const teamSel = document.createElement('select');
    ['FOH','BOH','Bar'].forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t;
      if (s.team === t) o.selected = true;
      teamSel.appendChild(o);
    });
    teamSel.addEventListener('change', e => s.team = e.target.value);
    tdTeam.appendChild(teamSel);
    if (s.isLead) {
      const badge = document.createElement('span');
      badge.className = 'team-badge lead';
      badge.style.marginLeft = '6px';
      badge.textContent = 'LEAD';
      tdTeam.appendChild(badge);
    }
    tr.appendChild(tdTeam);

    const tdShift = document.createElement('td');
    const shiftWrap = document.createElement('div');
    shiftWrap.style.display = 'flex'; shiftWrap.style.gap = '4px'; shiftWrap.style.alignItems='center';
    const inField = editableText(s.scheduledIn, v => s.scheduledIn = v);
    inField.style.width = '64px';
    const outField = editableText(s.scheduledOut, v => s.scheduledOut = v);
    outField.style.width = '64px';
    const dash = document.createElement('span'); dash.textContent = '–'; dash.style.color='var(--charcoal-soft)';
    shiftWrap.append(inField, dash, outField);
    tdShift.appendChild(shiftWrap);
    tr.appendChild(tdShift);

    const tdStation = document.createElement('td');
    tdStation.appendChild(editableText(s.station || '', v => s.station = v, 'Station/task'));
    tr.appendChild(tdStation);

    const tdActions = document.createElement('td');
    tdActions.className = 'no-print';
    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn'; delBtn.title = 'Remove';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      STATE.staff = STATE.staff.filter(x => x.id !== s.id);
      renderRoster();
    });
    tdActions.appendChild(delBtn);
    tr.appendChild(tdActions);

    body.appendChild(tr);
  });
}

function editableText(value, onChange, placeholder) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value || '';
  if (placeholder) input.placeholder = placeholder;
  input.style.border = 'none';
  input.style.background = 'transparent';
  input.style.padding = '2px 2px';
  input.style.width = '100%';
  input.addEventListener('focus', () => { input.style.background = 'var(--paper)'; input.style.border='1px solid var(--line-strong)'; });
  input.addEventListener('blur', () => { input.style.background = 'transparent'; input.style.border='none'; });
  input.addEventListener('input', e => onChange(e.target.value));
  return input;
}

// ============================================================
// TIMELINE RENDER
// ============================================================
function renderTimeline() {
  const body = document.getElementById('timeline-body');
  const empty = document.getElementById('timeline-empty');
  body.innerHTML = '';
  if (!STATE.timeline.length) { empty.style.display=''; return; }
  empty.style.display = 'none';

  // Renders in current array order, not re-sorted by time. Sorting only
  // happens at the moment rows are inserted (import, trigger template) —
  // see insertTriggerTemplate() and sortTimelineByTime(). Re-sorting on
  // every render would fight manual drag-reorder, snapping dragged rows
  // back to chronological position even when the person deliberately
  // wants two same-time tasks shown in a specific order.
  STATE.timeline.forEach(item => {
    body.appendChild(renderTimelineRow(item));
  });
}

// Stable sort by parsed time-of-day; rows with no parseable time keep
// their relative position at the end. Used right after bulk inserts
// (import, trigger template) so the board opens in correct chronological
// order — NOT called on every render, so manual drag order persists.
function sortTimelineByTime() {
  STATE.timeline = STATE.timeline
    .map((item, idx) => ({ item, idx })) // stable-sort shim
    .sort((a, b) => {
      const am = a.item.timeMinutes, bm = b.item.timeMinutes;
      if (am == null && bm == null) return a.idx - b.idx;
      if (am == null) return 1;
      if (bm == null) return -1;
      if (am !== bm) return am - bm;
      return a.idx - b.idx; // stable: preserve original order for same-time rows
    })
    .map(x => x.item);
}

// Team → CSS class for left-border color coding
const TEAM_COLOR_CLASS = {
  'FOH': 'team-foh',
  'BOH': 'team-boh',
  'Bar': 'team-bar',
  'FOH+BOH': 'team-mixed',
  'BOH+FOH': 'team-mixed',
  'All': 'team-all',
};

function renderTimelineRow(item) {
  const isInfo = item.style === 'Info';
  const teamClass = TEAM_COLOR_CLASS[item.team] || '';
  const row = document.createElement('div');
  row.className = [
    'timeline-row',
    item.highlight ? 'is-highlighted' : '',
    item.generated ? 'is-generated' : '',
    isInfo ? 'is-info' : '',
    teamClass,
  ].filter(Boolean).join(' ');
  row.draggable = true;
  row.dataset.id = item.id;

  row.addEventListener('dragstart', e => {
    dragSrcId = item.id;
    row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
  row.addEventListener('dragover', e => {
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    row.classList.toggle('drag-over-top', before);
    row.classList.toggle('drag-over-bottom', !before);
  });
  row.addEventListener('dragleave', () => { row.classList.remove('drag-over-top','drag-over-bottom'); });
  row.addEventListener('drop', e => {
    e.preventDefault();
    row.classList.remove('drag-over-top','drag-over-bottom');
    if (!dragSrcId || dragSrcId === item.id) return;
    const fromIdx = STATE.timeline.findIndex(x => x.id === dragSrcId);
    const toIdx = STATE.timeline.findIndex(x => x.id === item.id);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = STATE.timeline.splice(fromIdx, 1);
    const rect = row.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    let insertAt = STATE.timeline.findIndex(x => x.id === item.id);
    if (!before) insertAt += 1;
    STATE.timeline.splice(insertAt, 0, moved);
    renderTimeline();
  });

  // time — dynamic width, sort-on-blur
  const tdTime = document.createElement('div');
  tdTime.className = 'tl-time';
  tdTime.dataset.printTime = item.time || '';
  const timeInput = document.createElement('input');
  timeInput.type = 'text';
  timeInput.value = item.time || '';
  timeInput.placeholder = '—';
  timeInput.addEventListener('input', e => {
    item.time = e.target.value;
    item.timeMinutes = timeToMinutes(e.target.value);
    // auto-grow the input to content width
    timeInput.style.width = Math.max(72, timeInput.value.length * 8 + 16) + 'px';
  });
  timeInput.addEventListener('blur', () => {
    tdTime.dataset.printTime = timeInput.value;
    sortTimelineByTime();
    renderTimeline();
  });
  // set initial width to content
  timeInput.style.width = Math.max(72, (item.time || '').length * 8 + 16) + 'px';
  tdTime.appendChild(timeInput);
  row.appendChild(tdTime);

  // drag handle — hidden for INFO rows (less visual noise)
  const tdDrag = document.createElement('div');
  tdDrag.className = 'tl-drag' + (isInfo ? ' no-print' : '');
  tdDrag.textContent = '⠿';
  tdDrag.title = 'Drag to reorder';
  row.appendChild(tdDrag);

  // main: name + badge + note
  const tdMain = document.createElement('div');
  tdMain.className = 'tl-main';
  tdMain.dataset.printName = item.name || '';
  tdMain.dataset.printNote = item.note || '';

  const nameRow = document.createElement('div');
  nameRow.className = 'tl-name-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'tl-name' + (isInfo ? ' tl-name-info' : '');
  nameInput.value = item.name || '';
  nameInput.addEventListener('input', e => { item.name = e.target.value; tdMain.dataset.printName = e.target.value; });
  nameRow.appendChild(nameInput);

  // Style badge + editable dropdown — don't show for Info rows
  if (!isInfo) {
    const styleSel = document.createElement('select');
    styleSel.className = 'tl-style-sel no-print';
    const styleOptions = ['','Buffet','Cocktail Hour','Bar','Passed Apps','Action Stations','Family Style','Plated','Ceremony','Strike','General'];
    styleOptions.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s || '—';
      if ((item.style || 'General') === s) o.selected = true;
      styleSel.appendChild(o);
    });
    styleSel.addEventListener('change', e => {
      item.style = e.target.value || 'General';
      renderTimeline();
    });
    nameRow.appendChild(styleSel);

    const badge = document.createElement('span');
    badge.className = 'tl-badge tl-badge-' + (item.style || 'General').toLowerCase().replace(/[^a-z]/g,'-');
    badge.textContent = item.style || 'General';
    nameRow.appendChild(badge);
  }

  // Trigger chip
  if (item.trigger && TRIGGER_TEMPLATES[item.trigger] && !item.triggerApplied) {
    const chip = document.createElement('span');
    chip.className = 'trigger-chip no-print';
    chip.textContent = '+ Insert ' + TRIGGER_TEMPLATES[item.trigger].label;
    chip.addEventListener('click', () => {
      insertTriggerTemplate(item);
      renderTimeline();
    });
    nameRow.appendChild(chip);
  }
  tdMain.appendChild(nameRow);

  // Note field
  const noteWrap = document.createElement('div');
  noteWrap.className = 'tl-note';
  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.value = item.note || '';
  noteInput.placeholder = isInfo ? '' : 'Notes / instructions';
  noteInput.addEventListener('input', e => { item.note = e.target.value; tdMain.dataset.printNote = e.target.value; });
  noteWrap.appendChild(noteInput);
  tdMain.appendChild(noteWrap);

  row.appendChild(tdMain);

  // team + staff assignment (combined column)
  const tdTeam = document.createElement('div');
  tdTeam.className = 'tl-team';
  tdTeam.dataset.printTeam = (item.team || '') + (item.assignedStaff && item.assignedStaff.length ? '\n' + item.assignedStaff.join(', ') : '');

  if (!isInfo) {
    // Team dropdown
    const teamSel = document.createElement('select');
    ['','FOH','BOH','Bar','FOH+BOH','BOH+FOH','All'].forEach(t => {
      const o = document.createElement('option'); o.value = t; o.textContent = t || '—';
      if ((item.team || '') === t) o.selected = true;
      teamSel.appendChild(o);
    });
    teamSel.addEventListener('change', e => {
      item.team = e.target.value;
      tdTeam.dataset.printTeam = (item.team || '') + (item.assignedStaff && item.assignedStaff.length ? '\n' + item.assignedStaff.join(', ') : '');
      Object.values(TEAM_COLOR_CLASS).forEach(c => row.classList.remove(c));
      if (TEAM_COLOR_CLASS[item.team]) row.classList.add(TEAM_COLOR_CLASS[item.team]);
    });
    tdTeam.appendChild(teamSel);

    // Staff name assignment — optional text field, comma-separated names
    // Pulled from loaded roster as a datalist for autocomplete
    const staffInput = document.createElement('input');
    staffInput.type = 'text';
    staffInput.className = 'tl-staff-assign';
    staffInput.placeholder = 'Assign staff...';
    staffInput.value = (item.assignedStaff || []).join(', ');
    staffInput.list = 'staff-names-list';
    staffInput.addEventListener('blur', e => {
      item.assignedStaff = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
      tdTeam.dataset.printTeam = (item.team || '') + (item.assignedStaff && item.assignedStaff.length ? '\n' + item.assignedStaff.join(', ') : '');
    });
    tdTeam.appendChild(staffInput);
  }

  row.appendChild(tdTeam);

  // actions
  const tdActions = document.createElement('div');
  tdActions.className = 'tl-actions no-print';

  const hlBtn = document.createElement('button');
  hlBtn.className = 'icon-btn' + (item.highlight ? ' active' : '');
  hlBtn.title = 'Highlight as critical';
  hlBtn.textContent = '★';
  hlBtn.addEventListener('click', () => {
    item.highlight = !item.highlight;
    renderTimeline();
  });
  tdActions.appendChild(hlBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn';
  delBtn.title = 'Delete row';
  delBtn.textContent = '✕';
  delBtn.addEventListener('click', () => {
    STATE.timeline = STATE.timeline.filter(x => x.id !== item.id);
    renderTimeline();
  });
  tdActions.appendChild(delBtn);

  row.appendChild(tdActions);

  return row;
}

// ---- insert a trigger template's steps as real, editable timeline rows ----
function insertTriggerTemplate(anchorItem) {
  const _mergedTpl = { ...TRIGGER_TEMPLATES, ...(STATE.customTemplates || {}) }; const tpl = _mergedTpl[anchorItem.trigger];
  if (!tpl) return;
  const anchorMinutes = anchorItem.timeMinutes;
  const anchorIdx = STATE.timeline.findIndex(x => x.id === anchorItem.id);

  const newRows = tpl.steps.map(step => {
    const mins = (anchorMinutes != null) ? anchorMinutes + step.offset : null;
    return {
      id: 'tl_' + Math.random().toString(36).slice(2, 9),
      name: step.name,
      time: mins != null ? minutesToTime(mins) : '',
      timeMinutes: mins,
      note: '',
      style: anchorItem.style,
      trigger: null,
      team: step.team,
      source: 'template',
      generated: true,
      highlight: false,
    };
  });

  // insert right after the anchor row, then re-sort by time — a sequence's
  // steps usually start BEFORE the anchor (e.g. buffet setup runs from
  // anchor-60min to anchor+0), so a naive splice-after leaves earlier-timed
  // generated rows displayed below their later-timed anchor. Sorting here
  // (not on every render) fixes display order without fighting manual drag.
  STATE.timeline.splice(anchorIdx + 1, 0, ...newRows);
  anchorItem.triggerApplied = true;
  sortTimelineByTime();
  toast(tpl.label + ' added — edit any row as needed');
}

// ============================================================
// ATTACHMENTS
// Reference images (layout photos, venue diagrams) — thumbnail strip,
// click to expand in a lightbox modal. Stored as data URLs in STATE so
// they travel with JSON export/load (no backend, consistent with the
// rest of the app). Explicitly excluded from print via CSS — these are
// for BUILDING the board, not part of the staff-facing printed page;
// the old v1 tool's mistake was letting full-size images bloat printouts.
// ============================================================
function renderAttachments() {
  const section = document.getElementById('section-attachments');
  const strip = document.getElementById('attachment-strip');
  const emptyHint = document.getElementById('attachment-empty');
  const hasAttachments = STATE.attachments && STATE.attachments.length;

  // Section stays visible even when empty (unlike data-driven sections)
  // because it has its own persistent "+ Add image" action — hiding it
  // would remove the only way to add the first attachment.
  section.style.display = '';
  strip.innerHTML = '';
  emptyHint.style.display = hasAttachments ? 'none' : '';

  STATE.attachments.forEach(att => {
    const thumb = document.createElement('div');
    thumb.className = 'attachment-thumb';
    thumb.title = att.name;

    const img = document.createElement('img');
    img.src = att.dataUrl;
    img.alt = att.name;
    thumb.appendChild(img);

    thumb.addEventListener('click', () => openAttachmentModal(att));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'attachment-thumb-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      STATE.attachments = STATE.attachments.filter(a => a.id !== att.id);
      renderAttachments();
    });
    thumb.appendChild(removeBtn);

    strip.appendChild(thumb);
  });
}

function openAttachmentModal(att) {
  const modal = document.getElementById('attachment-modal');
  document.getElementById('attachment-modal-img').src = att.dataUrl;
  document.getElementById('attachment-modal-caption').textContent = att.name;
  modal.style.display = 'flex';
}
function closeAttachmentModal() {
  document.getElementById('attachment-modal').style.display = 'none';
}

// Reads one or more File objects, converts each to a data URL, appends
// to STATE.attachments. No size/type validation beyond the file input's
// accept="image/*" — acceptable for an internal tool with a small team,
// not worth building upload validation UI for.
function handleAttachmentFiles(fileList) {
  Array.from(fileList).forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      STATE.attachments.push({
        id: 'att_' + Math.random().toString(36).slice(2, 9),
        name: file.name,
        dataUrl: e.target.result,
      });
      renderAttachments();
    };
    reader.readAsDataURL(file);
  });
}

// ============================================================
// REFERENCE SECTIONS (free text from worksheet, FOH-relevant ones expanded)
// ============================================================
const REF_SECTION_DEFAULT_OPEN = new Set([
  'Operations Notes', 'Service Setup / Layout', 'Additional Tasks / Responsibilities of Mangia',
]);

function renderRef() {
  const section = document.getElementById('section-ref');
  const list = document.getElementById('ref-list');
  list.innerHTML = '';
  if (!STATE.refSections.length) { section.style.display = 'none'; return; }
  section.style.display = '';

  STATE.refSections.forEach((ref, idx) => {
    if (!ref.text || !ref.text.trim()) return;
    const wrap = document.createElement('div');
    wrap.className = 'ref-section' + (REF_SECTION_DEFAULT_OPEN.has(ref.name) ? ' open' : '');
    const head = document.createElement('div');
    head.className = 'ref-head';
    head.innerHTML = `<span>${escapeHtml(ref.name)}</span><span class="ref-chevron">▸</span>`;
    head.addEventListener('click', () => wrap.classList.toggle('open'));
    const bodyEl = document.createElement('div');
    bodyEl.className = 'ref-body';
    bodyEl.textContent = ref.text;
    wrap.appendChild(head);
    wrap.appendChild(bodyEl);
    list.appendChild(wrap);
  });
}

// ============================================================
// IMPORT — Worksheet CSV
// ============================================================
function handleWorksheetFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const result = parseEventWorksheet(e.target.result);

      // Safety check: if the parse produced almost nothing, the user may have
      // uploaded a Proposal CSV instead of a Worksheet CSV. Warn loudly rather
      // than silently show an empty board — an empty board on event day is dangerous.
      if (result.timeline.length === 0 && result.food.items.length === 0) {
        toast('⚠ This file looks like a Proposal export, not an Event Worksheet. Upload the Worksheet CSV instead.');
        return;
      }

      STATE.meta = { ...STATE.meta, ...result.meta };
      STATE.timeline = result.timeline.map(t => ({
        ...t, team:'', generated:false, triggerApplied:false, assignedStaff:[],
      }));
      sortTimelineByTime();
      STATE.dietFlags = result.dietFlags;
      STATE.menuItems = result.food.items.map(i => ({
        name: i.name, notes: i.notes || '', qty: i.qty || '',
        description: i.description || '',
      }));
      STATE.refSections = Object.entries(result.freeText)
        .filter(([name]) =>
          name !== 'Event Overview' &&
          name !== 'Service Setup / Layout' &&
          name !== 'Setup' &&              // promoted to Layout & Locations
          name !== 'Catering Kitchen / Staging' // promoted to Layout & Locations
        )
        .map(([name, text]) => ({ name, text }));
      STATE.eventOverview = result.eventOverview || '';
      STATE.layoutLocations = result.layoutLocations || [];
      STATE.responsibilityMatrix = result.responsibilityMatrix || [];
      STATE.buffetLayout.hotItems = result.buffetHotItems || [];
      // Reset cold items to defaults on new import (user can edit after)
      STATE.buffetLayout.coldItems = [
        { id:'cold_cutlery', label:'Cutlery',   shape:'rect' },
        { id:'cold_butter',  label:'Butter',    shape:'circle' },
        { id:'cold_bread',   label:'Bread',     shape:'rect-rotated' },
        { id:'cold_salad',   label:'Salad',     shape:'circle' },
      ];
      STATE.alwaysOnApplied = false;
      applyAlwaysOnTasks();

      renderAll();
      document.getElementById('zone-worksheet').classList.add('loaded');
      document.getElementById('zone-worksheet').querySelector('.upload-zone-sub').textContent = file.name;
      const rowCount = STATE.timeline.length;
      toast('Worksheet imported — ' + rowCount + ' timeline rows loaded');
    } catch (err) {
      console.error(err);
      toast('Could not parse that file — check it is a Worksheet CSV export');
    }
  };
  reader.readAsText(file);
}

function handleRosterFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const staff = parseNowstaRoster(e.target.result);
      STATE.staff = staff;
      renderRoster();
      document.getElementById('zone-roster').classList.add('loaded');
      document.getElementById('zone-roster').querySelector('.upload-zone-sub').textContent = file.name;
      toast(staff.length + ' staff loaded from Nowsta');
    } catch (err) {
      console.error(err);
      toast('Could not parse that file — check it is a Nowsta export');
    }
  };
  reader.readAsText(file);
}

// ============================================================
// SAVE / LOAD JSON
// ============================================================
function exportJSON() {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = (STATE.meta.eventTitle || 'battle-board').replace(/[^a-z0-9]+/gi, '_');
  a.href = url;
  a.download = safeName + '.json';
  a.click();
  URL.revokeObjectURL(url);
  toast('Saved ' + a.download);
}

function loadJSONFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      Object.assign(STATE, data);
      renderAll();
      toast('Loaded ' + file.name);
    } catch (err) {
      toast('That file is not a valid Battle Board JSON export');
    }
  };
  reader.readAsText(file);
}

// ============================================================
// UTIL
// ============================================================
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// MENU SECTION RENDER
// Shows parsed food items in a clean two-column list, grouped
// by course header (Cocktail Hour, Dinner Buffet, etc.) where
// detectable. Staff need to know what they're serving.
// ============================================================
function renderMenu() {
  const section = document.getElementById('section-menu');
  const body = document.getElementById('menu-body');
  if (!section || !body) return;
  if (!STATE.menuItems || !STATE.menuItems.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  body.innerHTML = '';

  const COURSE_HEADER_PATTERNS = /^(cocktail\s*hour|dinner\s*buffet|buffet|plated|salad\s*course|dessert|appetizers?|entrée|entree|beverages?)/i;
  let currentGroup = null;

  STATE.menuItems.forEach(item => {
    if (COURSE_HEADER_PATTERNS.test(item.name.trim()) && !item.qty) {
      // This is a section header row, not an actual food item
      currentGroup = document.createElement('div');
      currentGroup.className = 'menu-group';
      const heading = document.createElement('div');
      heading.className = 'menu-group-title';
      heading.textContent = item.name;
      currentGroup.appendChild(heading);
      body.appendChild(currentGroup);
      return;
    }
    if (!currentGroup) {
      currentGroup = document.createElement('div');
      currentGroup.className = 'menu-group';
      body.appendChild(currentGroup);
    }
    const row = document.createElement('div');
    row.className = 'menu-item';
    const name = document.createElement('span');
    name.className = 'menu-item-name';
    name.textContent = item.name;
    row.appendChild(name);
    if (item.notes && item.notes.trim()) {
      const note = document.createElement('span');
      note.className = 'menu-item-note';
      note.textContent = item.notes;
      row.appendChild(note);
    }
    currentGroup.appendChild(row);
  });
}

// ============================================================
// TEMPLATE LIBRARY UI
// Collapsible panel showing all trigger templates and always-on
// tasks. Read-only list with inline step editing. STATE-backed —
// customTemplates overrides defaults when set, travels with JSON.
// ============================================================
function renderTemplateLibrary() {
  const section = document.getElementById('section-templates');
  const body = document.getElementById('templates-body');
  if (!section || !body) return;
  // Template library is always visible (it's a utility panel, not data-driven)
  section.style.display = '';
  body.innerHTML = '';

  const templates = { ...TRIGGER_TEMPLATES, ...(STATE.customTemplates || {}) };
  Object.entries(templates).forEach(([key, tpl]) => {
    const card = document.createElement('div');
    card.className = 'tpl-card';

    const head = document.createElement('div');
    head.className = 'tpl-head';
    head.innerHTML = `<span class="tpl-name">${escapeHtml(tpl.label)}</span>
      <span class="tpl-trigger-key">fires on: ${escapeHtml(tpl.anchorLabel || key)}</span>`;
    card.appendChild(head);

    const steps = document.createElement('div');
    steps.className = 'tpl-steps';
    (tpl.steps || []).forEach((step, si) => {
      const stepRow = document.createElement('div');
      stepRow.className = 'tpl-step-row';
      // Offset input
      const offsetInput = document.createElement('input');
      offsetInput.type = 'number';
      offsetInput.className = 'tpl-offset';
      offsetInput.value = step.offset;
      offsetInput.title = 'Offset in minutes from trigger time';
      offsetInput.addEventListener('change', e => {
        ensureCustomTemplates();
        STATE.customTemplates[key].steps[si].offset = parseInt(e.target.value, 10) || 0;
      });
      stepRow.appendChild(offsetInput);

      const stepName = document.createElement('input');
      stepName.type = 'text';
      stepName.className = 'tpl-step-name';
      stepName.value = step.name;
      stepName.addEventListener('input', e => {
        ensureCustomTemplates();
        STATE.customTemplates[key].steps[si].name = e.target.value;
      });
      stepRow.appendChild(stepName);

      const teamSel = document.createElement('select');
      teamSel.className = 'tpl-step-team';
      ['FOH','BOH','Bar','FOH+BOH','BOH+FOH','All'].forEach(t => {
        const o = document.createElement('option'); o.value = t; o.textContent = t;
        if (step.team === t) o.selected = true;
        teamSel.appendChild(o);
      });
      teamSel.addEventListener('change', e => {
        ensureCustomTemplates();
        STATE.customTemplates[key].steps[si].team = e.target.value;
      });
      stepRow.appendChild(teamSel);

      steps.appendChild(stepRow);
    });
    card.appendChild(steps);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn-sm btn-ghost no-print';
    resetBtn.style.marginTop = '6px';
    resetBtn.textContent = 'Reset to default';
    resetBtn.addEventListener('click', () => {
      if (STATE.customTemplates) delete STATE.customTemplates[key];
      if (STATE.customTemplates && !Object.keys(STATE.customTemplates).length) STATE.customTemplates = null;
      renderTemplateLibrary();
    });
    card.appendChild(resetBtn);

    body.appendChild(card);
  });
}

// Deep-clone TRIGGER_TEMPLATES into STATE.customTemplates if not already set,
// so edits don't mutate the hardcoded defaults.
function ensureCustomTemplates() {
  if (!STATE.customTemplates) {
    STATE.customTemplates = JSON.parse(JSON.stringify(TRIGGER_TEMPLATES));
  }
}

// Update the staff name datalist used for assignment autocomplete
function updateStaffDatalist() {
  let list = document.getElementById('staff-names-list');
  if (!list) {
    list = document.createElement('datalist');
    list.id = 'staff-names-list';
    document.body.appendChild(list);
  }
  list.innerHTML = '';
  (STATE.staff || []).forEach(s => {
    if (s.name && s.name.trim()) {
      const opt = document.createElement('option');
      opt.value = s.name.trim();
      list.appendChild(opt);
    }
  });
}

function renderAll() {
  renderMeta();
  renderOverview();
  renderLayoutLocations();
  renderMenu();
  renderResponsibility();
  renderDiet();
  updateStaffDatalist();
  renderRoster();
  renderTimeline();
  renderBuffetLayout();
  renderTemplateLibrary();
  renderAttachments();
  renderRef();
}

// ============================================================
// PRINT DOC GENERATOR
// Builds clean HTML (zero form elements) from STATE for printing.
// Wired to window.onbeforeprint / onafterprint.
// ============================================================
function buildPrintDoc() {
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const m = STATE.meta || {};
  let h = '';

  // Header
  h += `<div class="pd-header">Mangia Catering Co. — FOH Battle Board`;
  if (m.eventTitle) h += `<span class="pd-header-sub"> · ${esc(m.eventTitle)}</span>`;
  h += `</div>`;

  // Meta grid
  const metaPairs = [
    ['Event', m.eventTitle], ['Date', m.eventDate],
    ['Guests', m.guestCount], ['Style', m.serviceStyle],
  ].filter(([,v]) => v);
  if (metaPairs.length) {
    h += '<div class="pd-meta">';
    metaPairs.forEach(([l,v]) => {
      h += `<div><div class="pd-meta-label">${esc(l)}</div><div class="pd-meta-val">${esc(v)}</div></div>`;
    });
    h += '</div>';
  }

  // Overview
  if (STATE.eventOverview) {
    h += `<div class="pd-overview">${esc(STATE.eventOverview)}</div>`;
  }

  // Layout & locations
  if (STATE.layoutLocations && STATE.layoutLocations.length) {
    h += '<div class="pd-section">Layout &amp; Locations</div>';
    STATE.layoutLocations.forEach(loc => {
      if (loc.text) h += `<div class="pd-layout"><strong>${esc(loc.label || loc.source)}:</strong> ${esc(loc.text)}</div>`;
    });
  }

  // Responsibility matrix
  if (STATE.responsibilityMatrix && STATE.responsibilityMatrix.length) {
    h += '<div class="pd-section">Mangia\'s Responsibilities</div>';
    h += '<div class="pd-resp-grid">';
    const groups = {};
    STATE.responsibilityMatrix.forEach(item => {
      if (!groups[item.group]) groups[item.group] = [];
      groups[item.group].push(item);
    });
    const POSITIVE = ['Y','Mangia','Full clear','Mangia sets','Full service','Prefill only','Assist','Mangia handles','Mangia sets up'];
    const CLIENT = ['Client provided','Third party','Client','Client handles','Venue sets'];
    Object.entries(groups).forEach(([gname, items]) => {
      h += `<div><div class="pd-resp-group-title">${esc(gname)}</div>`;
      items.forEach(item => {
        if (item.isReminder) {
          if (item.value === 'Y') h += `<div class="pd-resp-row"><span class="pd-resp-label">${esc(item.label)}</span><span class="pd-resp-note">Confirm FOH sets</span></div>`;
          else h += `<div class="pd-resp-row"><span class="pd-resp-label">${esc(item.label)}</span><span class="pd-resp-note">Not on menu</span></div>`;
          return;
        }
        const valClass = POSITIVE.includes(item.value) ? 'pos' : (CLIENT.includes(item.value) ? 'cli' : 'neg');
        const showVal = item.value || '—';
        const noteTxt = item.note ? `<span class="pd-resp-note">${esc(item.note)}</span>` : '';
        h += `<div class="pd-resp-row"><span class="pd-resp-label">${esc(item.label)}</span><span><span class="pd-resp-val ${valClass}">${esc(showVal)}</span>${noteTxt}</span></div>`;
      });
      h += '</div>';
    });
    h += '</div>';
  }

  // Diet callouts
  if (STATE.dietFlags && STATE.dietFlags.length) {
    const flags = STATE.dietFlags.filter(f => f.text);
    if (flags.length) {
      h += `<div class="pd-diet">⚠ FLAGGED DIET / ALLERGY ITEMS — CONFIRM BEFORE SERVICE</div>`;
    }
  }

  // Menu
  if (STATE.menuItems && STATE.menuItems.length) {
    h += '<div class="pd-section">Menu</div>';
    h += '<div class="pd-menu-grid">';
    const half = Math.ceil(STATE.menuItems.length / 2);
    for (let col = 0; col < 2; col++) {
      h += '<div>';
      STATE.menuItems.slice(col * half, col * half + half).forEach(item => {
        const note = item.notes ? `<span class="pd-menu-note">${esc(item.notes)}</span>` : '';
        h += `<div class="pd-menu-item"><span>${esc(item.name)}</span>${note}</div>`;
      });
      h += '</div>';
    }
    h += '</div>';
  }

  // Buffet layout (compact chips, not SVG)
  const bl = STATE.buffetLayout || {};
  const hasColds = bl.coldItems && bl.coldItems.length;
  const hasHots = bl.hotItems && bl.hotItems.length;
  if (hasColds || hasHots) {
    h += '<div class="pd-section">Buffet Layout</div>';
    h += '<div class="pd-buffet">';
    h += '<span class="pd-buffet-label">Plates →</span>';
    if (hasColds) {
      h += '<span class="pd-buffet-label">Cold:</span>';
      bl.coldItems.forEach(c => {
        h += `<span class="pd-buffet-chip cold">${esc(c.label)}</span>`;
      });
    }
    if (hasHots) {
      h += '<span class="pd-buffet-label">Hot:</span>';
      bl.hotItems.forEach(item => {
        const cls = item.category || '';
        h += `<span class="pd-buffet-chip ${esc(cls)}">${esc(item.name)}</span>`;
      });
    }
    h += '</div>';
  }

  // Staff roster
  if (STATE.staff && STATE.staff.length) {
    h += '<div class="pd-section">Staff Roster</div>';
    h += '<table class="pd-roster"><thead><tr><th>Name</th><th>Role</th><th>Team</th><th>Shift</th><th>Station</th></tr></thead><tbody>';
    STATE.staff.forEach(s => {
      const shift = [s.shiftStart, s.shiftEnd].filter(Boolean).join(' – ');
      h += `<tr><td>${esc(s.name)}</td><td>${esc(s.role)}</td><td>${esc(s.team)}</td><td>${esc(shift)}</td><td>${esc(s.station)}</td></tr>`;
    });
    h += '</tbody></table>';
  }

  // Timeline (compact table)
  if (STATE.timeline && STATE.timeline.length) {
    h += '<div class="pd-section">Timeline</div>';
    h += '<table class="pd-timeline"><thead><tr><th>Time</th><th>Task</th><th>Cat</th><th>Notes</th><th>Team</th><th>Staff</th></tr></thead><tbody>';

    // Sort by time
    const sorted = [...STATE.timeline].sort((a, b) => {
      const at = a.timeMinutes != null ? a.timeMinutes : 9999;
      const bt = b.timeMinutes != null ? b.timeMinutes : 9999;
      return at - bt;
    });

    sorted.forEach(item => {
      const isInfo = (item.style === 'Info');
      const team = item.team || '';
      const teamClass = team.includes('FOH') && team.includes('BOH') ? 'pd-tl-all' :
                        team === 'FOH' ? 'pd-tl-foh' :
                        team === 'BOH' ? 'pd-tl-boh' :
                        team === 'Bar' ? 'pd-tl-bar' :
                        team === 'All' ? 'pd-tl-all' : '';
      const infoClass = isInfo ? ' pd-tl-info' : '';
      const catClass = (item.style || 'General').toLowerCase().includes('buffet') ? 'pd-cat-buffet' :
                       (item.style || 'General').toLowerCase().includes('cocktail') ? 'pd-cat-cocktail' :
                       isInfo ? 'pd-cat-info' : 'pd-cat-general';
      const staff = (item.assignedStaff && item.assignedStaff.length) ? esc(item.assignedStaff.join(', ')) : '';
      const catBadge = (item.style && !isInfo) ? `<span class="pd-cat-badge ${catClass}">${esc(item.style)}</span>` :
                       isInfo ? `<span class="pd-cat-badge pd-cat-info">Info</span>` : '';
      h += `<tr class="${teamClass}${infoClass}"><td class="pd-tl-time">${esc(item.time || '—')}</td><td class="pd-tl-task">${esc(item.name)}</td><td class="pd-tl-cat">${catBadge}</td><td class="pd-tl-notes">${esc(item.note || '')}</td><td class="pd-tl-team">${esc(team)}</td><td class="pd-tl-staff">${staff}</td></tr>`;
    });
    h += '</tbody></table>';
  }

  // Reference notes (dense text)
  if (STATE.refSections && STATE.refSections.length) {
    h += '<div class="pd-section">Setup &amp; Reference Notes</div>';
    STATE.refSections.forEach(ref => {
      if (ref.text && ref.text.trim()) {
        h += `<div class="pd-ref-title">${esc(ref.name)}</div>`;
        h += `<div class="pd-ref-body">${esc(ref.text)}</div>`;
      }
    });
  }

  const el = document.getElementById('print-doc');
  if (el) el.innerHTML = h;
}

// Wire print events
window.addEventListener('beforeprint', () => buildPrintDoc());
window.addEventListener('afterprint', () => {
  const el = document.getElementById('print-doc');
  if (el) el.innerHTML = '';
});

// ============================================================
// WIRE UP UI
// ============================================================
function initUploadZone(zoneId, fileInputId, handler) {
  const zone = document.getElementById(zoneId);
  const input = document.getElementById(fileInputId);
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', e => { if (e.target.files[0]) handler(e.target.files[0]); });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-active'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-active'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-active');
    if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initUploadZone('zone-worksheet', 'file-worksheet', handleWorksheetFile);
  initUploadZone('zone-roster', 'file-roster', handleRosterFile);

  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-print').addEventListener('click', () => window.print());

  const loadInput = document.createElement('input');
  loadInput.type = 'file'; loadInput.accept = '.json'; loadInput.style.display = 'none';
  document.body.appendChild(loadInput);
  loadInput.addEventListener('change', e => { if (e.target.files[0]) loadJSONFile(e.target.files[0]); });
  document.getElementById('btn-load-json').addEventListener('click', () => loadInput.click());

  document.getElementById('btn-add-staff').addEventListener('click', () => {
    STATE.staff.push({ id:'staff_'+Math.random().toString(36).slice(2,9), name:'', position:'', team:'FOH', isLead:false, scheduledIn:'', scheduledOut:'', station:'' });
    renderRoster();
  });

  document.getElementById('btn-add-row').addEventListener('click', () => {
    STATE.timeline.push({
      id:'tl_'+Math.random().toString(36).slice(2,9), name:'New task', time:'', timeMinutes:null,
      note:'', style:'General', trigger:null, team:'', source:'manual', generated:false,
      highlight:false, assignedStaff:[],
    });
    // Auto-sort so new row lands in chronological position if it has a time,
    // or stays at end if no time yet — user types the time and blur-sorts.
    sortTimelineByTime();
    renderTimeline();
    // scroll to show the newly added row
    setTimeout(() => {
      const lastRow = document.querySelector('.timeline-row:last-child');
      if (lastRow) lastRow.scrollIntoView({ behavior:'smooth', block:'nearest' });
    }, 50);
  });

  const sortBtn = document.getElementById('btn-sort-timeline');
  if (sortBtn) {
    sortBtn.addEventListener('click', () => {
      sortTimelineByTime();
      renderTimeline();
      toast('Timeline sorted by time');
    });
  }

  const overviewBody = document.getElementById('overview-body');
  overviewBody.addEventListener('input', e => {
    STATE.eventOverview = e.target.value;
    document.getElementById('section-overview').dataset.userTouched = 'true';
  });

  const attachmentInput = document.getElementById('file-attachment');
  document.getElementById('btn-add-attachment').addEventListener('click', () => attachmentInput.click());
  attachmentInput.addEventListener('change', e => {
    if (e.target.files.length) handleAttachmentFiles(e.target.files);
    attachmentInput.value = '';
  });
  document.getElementById('attachment-modal-close').addEventListener('click', closeAttachmentModal);
  document.querySelector('.attachment-modal-backdrop').addEventListener('click', closeAttachmentModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAttachmentModal();
  });

  renderAll();
});
