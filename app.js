// ============================================================
// MANGIA BATTLE BOARD — App logic
// ============================================================

const STATE = {
  meta: { eventTitle:'', invoiceNumber:'', eventDate:'', guestCount:'', guestCountNum:null,
          serviceStyle:'', venue:'', contact:'', occasion:'', salesRep:'',
          staffRestrooms:'', staffParking:'' },
  staff: [],
  timeline: [],
  dietFlags: [],
  refSections: [], // [{name, text}]
  eventOverview: '',
  responsibilityMatrix: [], // [{group,key,label,value,auto,matchedText,matchedSource}]
  buffetLayout: {
    startSide: 'salad',
    hotItems: [], // [{name, category, notes}] — user-editable order
  },
  dishLookup: {}, // { [menuItemNameLower]: { dish, servingware, notes } }
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
    label: 'Stations / cocktail hour open',
    anchorLabel: 'Cocktail Hour Start',
    steps: [
      { offset:-20, name:'Set stationary app table / passed app trays', team:'FOH' },
      { offset:-10, name:'Diet-flagged apps set aside + labeled', team:'BOH' },
      { offset:0,   name:'Begin passing / stations service', team:'FOH' },
    ],
  },
  stations_end: {
    label: 'Stations / cocktail hour close',
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
    ],
  },
};

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

      const toggle = document.createElement('div');
      toggle.className = 'resp-toggle';
      ['Y','N','—'].forEach(opt => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'resp-btn' + (
          (opt === 'Y' && item.value === 'Y') || (opt === 'N' && item.value === 'N') || (opt === '—' && item.value === null)
            ? ' active-' + (opt === 'Y' ? 'y' : opt === 'N' ? 'n' : 'unset') : ''
        );
        btn.textContent = opt;
        btn.addEventListener('click', () => {
          item.value = opt === '—' ? null : opt;
          item.auto = false; // manual override clears the auto provenance
          renderResponsibility();
        });
        toggle.appendChild(btn);
      });
      row.appendChild(toggle);
      groupWrap.appendChild(row);
    });
    body.appendChild(groupWrap);
  });
}

// ============================================================
// BUFFET LAYOUT RENDER
// ============================================================
function renderBuffetLayout() {
  const section = document.getElementById('section-buffet');
  const body = document.getElementById('buffet-body');
  const hasHots = STATE.buffetLayout.hotItems && STATE.buffetLayout.hotItems.length;
  const isBuffetEvent = /buffet/i.test(STATE.meta.serviceStyle || '') || STATE.timeline.some(t => t.style === 'Buffet');
  if (!hasHots && !isBuffetEvent) { section.style.display = 'none'; return; }
  section.style.display = '';
  body.innerHTML = '';

  // cold line — fixed, illustrative
  const coldRow = document.createElement('div');
  coldRow.className = 'buffet-cold-row';
  const coldLabel = document.createElement('div');
  coldLabel.className = 'buffet-start-label';
  coldLabel.innerHTML = '<i>start</i> →';
  coldRow.appendChild(coldLabel);
  BUFFET_LAYOUT_DEFAULTS.coldLine.forEach(slot => {
    const box = document.createElement('div');
    box.className = 'buffet-slot buffet-slot-cold';
    box.textContent = slot.label;
    coldRow.appendChild(box);
  });
  const arrowBox = document.createElement('div');
  arrowBox.className = 'buffet-arrow';
  arrowBox.textContent = '→';
  coldRow.appendChild(arrowBox);
  body.appendChild(coldRow);

  // hot line — editable, draggable order
  const hotRow = document.createElement('div');
  hotRow.className = 'buffet-hot-row';
  if (!hasHots) {
    const empty = document.createElement('div');
    empty.className = 'buffet-hot-empty';
    empty.textContent = 'No hot items detected — add manually below';
    hotRow.appendChild(empty);
  } else {
    STATE.buffetLayout.hotItems.forEach((item, idx) => {
      hotRow.appendChild(renderBuffetHotChip(item, idx));
    });
  }
  body.appendChild(hotRow);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-sm btn-ghost no-print';
  addBtn.style.marginTop = '10px';
  addBtn.textContent = '+ Add hot item';
  addBtn.addEventListener('click', () => {
    STATE.buffetLayout.hotItems.push({ name: 'New item', category: null, notes: '' });
    renderBuffetLayout();
  });
  body.appendChild(addBtn);

  const note = document.createElement('div');
  note.className = 'buffet-note';
  note.textContent = BUFFET_LAYOUT_DEFAULTS.hotLineNote;
  body.appendChild(note);
}

const CATEGORY_COLOR_CLASS = { veggie:'cat-veggie', starch:'cat-starch', protein:'cat-protein' };
function renderBuffetHotChip(item, idx) {
  const chip = document.createElement('div');
  chip.className = 'buffet-slot buffet-slot-hot ' + (item.category ? CATEGORY_COLOR_CLASS[item.category] : 'cat-unknown');
  chip.draggable = true;
  chip.dataset.idx = idx;

  chip.addEventListener('dragstart', e => { dragSrcId = 'buffet_' + idx; chip.style.opacity = '.4'; });
  chip.addEventListener('dragend', () => chip.style.opacity = '1');
  chip.addEventListener('dragover', e => e.preventDefault());
  chip.addEventListener('drop', e => {
    e.preventDefault();
    if (!dragSrcId || !String(dragSrcId).startsWith('buffet_')) return;
    const fromIdx = parseInt(String(dragSrcId).replace('buffet_',''), 10);
    const toIdx = idx;
    if (fromIdx === toIdx) return;
    const arr = STATE.buffetLayout.hotItems;
    const [moved] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, moved);
    renderBuffetLayout();
  });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = item.name;
  nameInput.className = 'buffet-hot-name';
  nameInput.addEventListener('input', e => item.name = e.target.value);
  chip.appendChild(nameInput);

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
  chip.appendChild(catSel);

  const delBtn = document.createElement('button');
  delBtn.className = 'icon-btn no-print';
  delBtn.textContent = '✕';
  delBtn.title = 'Remove';
  delBtn.addEventListener('click', () => {
    STATE.buffetLayout.hotItems.splice(idx, 1);
    renderBuffetLayout();
  });
  chip.appendChild(delBtn);

  return chip;
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

  // keep sorted by time for display, but respect manual drag order for
  // same-time or undated rows by relying on stable array order
  STATE.timeline.forEach(item => {
    body.appendChild(renderTimelineRow(item));
  });
}

function renderTimelineRow(item) {
  const row = document.createElement('div');
  row.className = 'timeline-row' + (item.highlight ? ' is-highlighted' : '') + (item.generated ? ' is-generated' : '');
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

  // time
  const tdTime = document.createElement('div');
  tdTime.className = 'tl-time';
  const timeInput = document.createElement('input');
  timeInput.type = 'text';
  timeInput.value = item.time || '';
  timeInput.placeholder = '—';
  timeInput.addEventListener('input', e => {
    item.time = e.target.value;
    item.timeMinutes = timeToMinutes(e.target.value);
  });
  tdTime.appendChild(timeInput);
  row.appendChild(tdTime);

  // drag handle
  const tdDrag = document.createElement('div');
  tdDrag.className = 'tl-drag';
  tdDrag.textContent = '⠿';
  tdDrag.title = 'Drag to reorder';
  row.appendChild(tdDrag);

  // main: name + badge + note
  const tdMain = document.createElement('div');
  tdMain.className = 'tl-main';

  const nameRow = document.createElement('div');
  nameRow.className = 'tl-name-row';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'tl-name';
  nameInput.value = item.name || '';
  nameInput.addEventListener('input', e => item.name = e.target.value);
  nameRow.appendChild(nameInput);

  const badge = document.createElement('span');
  badge.className = 'tl-badge';
  badge.textContent = item.style || 'General';
  nameRow.appendChild(badge);

  // trigger chip — only on imported rows with a matched trigger that hasn't
  // had its template inserted yet
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

  const noteWrap = document.createElement('div');
  noteWrap.className = 'tl-note';
  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.value = item.note || '';
  noteInput.placeholder = 'Notes / instructions';
  noteInput.addEventListener('input', e => item.note = e.target.value);
  noteWrap.appendChild(noteInput);
  tdMain.appendChild(noteWrap);

  row.appendChild(tdMain);

  // team
  const tdTeam = document.createElement('div');
  tdTeam.className = 'tl-team';
  const teamSel = document.createElement('select');
  ['','FOH','BOH','Bar','FOH+BOH','BOH+FOH','All'].forEach(t => {
    const o = document.createElement('option'); o.value = t; o.textContent = t || '—';
    if ((item.team || '') === t) o.selected = true;
    teamSel.appendChild(o);
  });
  teamSel.addEventListener('change', e => item.team = e.target.value);
  tdTeam.appendChild(teamSel);
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
  const tpl = TRIGGER_TEMPLATES[anchorItem.trigger];
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

  // insert right after the anchor row, in template order
  STATE.timeline.splice(anchorIdx + 1, 0, ...newRows);
  anchorItem.triggerApplied = true;
  toast(tpl.label + ' added — edit any row as needed');
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
      STATE.meta = { ...STATE.meta, ...result.meta };
      STATE.timeline = result.timeline.map(t => ({ ...t, team:'', generated:false, triggerApplied:false }));
      STATE.dietFlags = result.dietFlags;
      STATE.refSections = Object.entries(result.freeText)
        .filter(([name]) => name !== 'Event Overview') // promoted to its own section
        .map(([name, text]) => ({ name, text }));
      STATE.eventOverview = result.eventOverview || '';
      STATE.responsibilityMatrix = result.responsibilityMatrix || [];
      STATE.buffetLayout.hotItems = result.buffetHotItems || [];
      renderAll();
      document.getElementById('zone-worksheet').classList.add('loaded');
      document.getElementById('zone-worksheet').querySelector('.upload-zone-sub').textContent = file.name;
      toast('Worksheet imported — ' + STATE.timeline.length + ' timeline rows loaded');
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

function renderAll() {
  renderMeta();
  renderOverview();
  renderResponsibility();
  renderDiet();
  renderRoster();
  renderTimeline();
  renderBuffetLayout();
  renderRef();
}

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
      note:'', style:'General', trigger:null, team:'', source:'manual', generated:false, highlight:false,
    });
    renderTimeline();
  });

  const overviewBody = document.getElementById('overview-body');
  overviewBody.addEventListener('input', e => {
    STATE.eventOverview = e.target.value;
    document.getElementById('section-overview').dataset.userTouched = 'true';
  });

  renderAll();
});
