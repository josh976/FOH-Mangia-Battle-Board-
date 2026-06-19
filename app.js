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
  layoutLocations: [], // [{source, text}] — surfaced separately from refSections, staff need this early
  responsibilityMatrix: [], // [{group,key,label,value,auto,matchedText,matchedSource}]
  buffetLayout: {
    startSide: 'salad',
    hotItems: [], // [{name, category, notes}] — user-editable order
  },
  dishLookup: {}, // { [menuItemNameLower]: { dish, servingware, notes } }
  attachments: [], // [{id, name, dataUrl, type}] — reference images, excluded from print
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
// Real spatial table diagram (cold line + hot line as literal
// table shapes, matching Mangia's printed buffet drawing
// template) with a synced plain-list editor beneath it for
// text/category/order edits. The diagram is regenerated from
// STATE on every change — it's a view, not a separate state.
// ============================================================
function renderBuffetLayout() {
  const section = document.getElementById('section-buffet');
  const body = document.getElementById('buffet-body');
  const hasHots = STATE.buffetLayout.hotItems && STATE.buffetLayout.hotItems.length;
  const isBuffetEvent = /buffet/i.test(STATE.meta.serviceStyle || '') || STATE.timeline.some(t => t.style === 'Buffet');
  if (!hasHots && !isBuffetEvent) { section.style.display = 'none'; return; }
  section.style.display = '';
  body.innerHTML = '';

  body.appendChild(buildBuffetDiagramSVG(STATE.buffetLayout.hotItems));

  // ---- synced edit list (text/category/order/delete) ----
  const editWrap = document.createElement('div');
  editWrap.className = 'buffet-edit-list no-print';
  if (!hasHots) {
    const empty = document.createElement('div');
    empty.className = 'buffet-hot-empty';
    empty.textContent = 'No hot items detected — add manually below';
    editWrap.appendChild(empty);
  } else {
    STATE.buffetLayout.hotItems.forEach((item, idx) => {
      editWrap.appendChild(renderBuffetEditRow(item, idx));
    });
  }
  body.appendChild(editWrap);

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
const CATEGORY_SVG_FILL = { veggie:'var(--leafy-soft)', starch:'#FBF3DC', protein:'#FBF0E6', null:'var(--paper)' };
const CATEGORY_SVG_STROKE = { veggie:'var(--leafy)', starch:'var(--gold)', protein:'var(--orange)', null:'var(--line-strong)' };

// ---- builds the visual diagram as a real <svg>, scaling chafer width to item count ----
function buildBuffetDiagramSVG(hotItems) {
  const wrap = document.createElement('div');
  wrap.className = 'buffet-svg-wrap';

  const cold = BUFFET_LAYOUT_DEFAULTS.coldLine;
  const coldTableW = 280, coldTableX = 55, tableY = 10, tableH = 100;
  const hotTableX = coldTableX + coldTableW + 40;
  const itemCount = Math.max(hotItems.length, 1);
  const hotTableW = Math.max(280, itemCount * 120);
  const plateX = hotTableX + hotTableW + 35;
  const totalW = plateX + 60;

  let svg = `<svg class="buffet-diagram" viewBox="0 0 ${totalW} 220" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<defs><marker id="bf-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
    <path d="M0,0 L6,3 L0,6 Z" fill="var(--line-strong)"/></marker></defs>`;

  // start label + arrow
  svg += `<text x="0" y="30" class="buf-start-tag">start</text>
    <path d="M30,26 L${coldTableX - 7},26" class="buf-flow-arrow" marker-end="url(#bf-arrow)"/>`;

  // cold line table
  svg += `<rect x="${coldTableX}" y="${tableY}" width="${coldTableW}" height="${tableH}" rx="4" class="buf-table"/>`;
  svg += `<rect x="${coldTableX+10}" y="${tableY+10}" width="55" height="40" rx="2" class="buf-cold-item"/>
    <text x="${coldTableX+37}" y="${tableY+34}" text-anchor="middle" class="buf-sublabel">Cutlery</text>`;
  svg += `<circle cx="${coldTableX+95}" cy="${tableY+30}" r="22" class="buf-cold-item"/>
    <text x="${coldTableX+95}" y="${tableY+34}" text-anchor="middle" class="buf-sublabel">Butter</text>`;
  svg += `<rect x="${coldTableX+140}" y="${tableY+8}" width="60" height="44" rx="2" class="buf-cold-item" transform="rotate(15 ${coldTableX+170} ${tableY+30})"/>
    <text x="${coldTableX+170}" y="${tableY+70}" text-anchor="middle" class="buf-sublabel">Bread</text>`;
  svg += `<circle cx="${coldTableX+245}" cy="${tableY+30}" r="28" class="buf-cold-item"/>
    <text x="${coldTableX+245}" y="${tableY+34}" text-anchor="middle" class="buf-sublabel">Salad</text>`;
  svg += `<text x="${coldTableX+coldTableW/2}" y="${tableY+85}" text-anchor="middle" class="buf-section-label">cold line</text>`;

  // arrow to hot table
  svg += `<path d="M${coldTableX+coldTableW},60 L${hotTableX-7},60" class="buf-flow-arrow" marker-end="url(#bf-arrow)"/>`;

  // hot line table
  svg += `<rect x="${hotTableX}" y="${tableY}" width="${hotTableW}" height="${tableH}" rx="4" class="buf-table"/>`;
  if (!hotItems.length) {
    svg += `<text x="${hotTableX+hotTableW/2}" y="${tableY+55}" text-anchor="middle" class="buf-sublabel" style="font-style:italic;">no hot items yet</text>`;
  } else {
    const pad = 10, gap = 6;
    const slotW = (hotTableW - pad*2 - gap*(itemCount-1)) / itemCount;
    hotItems.forEach((item, i) => {
      const x = hotTableX + pad + i * (slotW + gap);
      const fill = CATEGORY_SVG_FILL[item.category] || CATEGORY_SVG_FILL[null];
      const stroke = CATEGORY_SVG_STROKE[item.category] || CATEGORY_SVG_STROKE[null];
      const dash = item.category ? '' : 'stroke-dasharray="4,3"';
      svg += `<rect x="${x}" y="${tableY+10}" width="${slotW}" height="80" rx="2"
        fill="${fill}" stroke="${stroke}" stroke-width="1.5" ${dash}/>`;
      // wrap name across up to 2 lines, simple char-based wrap
      const words = escapeHtml(item.name).split(' ');
      let lines = [], cur = '';
      words.forEach(w => {
        if ((cur + ' ' + w).trim().length > 14 && cur) { lines.push(cur); cur = w; }
        else cur = (cur ? cur + ' ' : '') + w;
      });
      if (cur) lines.push(cur);
      lines = lines.slice(0, 2);
      const labelYStart = tableY + 50 - (lines.length - 1) * 6;
      lines.forEach((line, li) => {
        svg += `<text x="${x+slotW/2}" y="${labelYStart + li*12}" text-anchor="middle" class="buf-sublabel" style="font-weight:600;">${line}</text>`;
      });
      svg += `<text x="${x+slotW/2}" y="${tableY+82}" text-anchor="middle" class="buf-sublabel" style="font-size:8px;opacity:.75;">${item.category || '?'}</text>`;
    });
  }
  svg += `<text x="${hotTableX+hotTableW/2}" y="${tableY+85}" text-anchor="middle" class="buf-section-label">hot line</text>
    <text x="${hotTableX+hotTableW/2}" y="${tableY+96}" text-anchor="middle" class="buf-sublabel" style="font-size:8.5px;font-style:italic;">veggie &#8594; starch &#8594; protein</text>`;

  // arrow + plates
  svg += `<path d="M${hotTableX+hotTableW},60 L${plateX-7},60" class="buf-flow-arrow" marker-end="url(#bf-arrow)"/>`;
  svg += `<circle cx="${plateX+18}" cy="35" r="14" class="buf-plate"/>
    <circle cx="${plateX+18}" cy="60" r="14" class="buf-plate"/>
    <circle cx="${plateX+18}" cy="85" r="14" class="buf-plate"/>
    <text x="${plateX+18}" y="115" text-anchor="middle" class="buf-sublabel">Plates</text>`;

  // guest flow line
  svg += `<path d="M48,150 C ${totalW*0.3},180 ${totalW*0.6},180 ${totalW-70},150" class="buf-flow-arrow" stroke-dasharray="2,3" marker-end="url(#bf-arrow)"/>
    <text x="${totalW/2}" y="195" text-anchor="middle" class="buf-sublabel" style="font-style:italic;">guest flow &#8594;</text>`;

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
      STATE.meta = { ...STATE.meta, ...result.meta };
      STATE.timeline = result.timeline.map(t => ({ ...t, team:'', generated:false, triggerApplied:false }));
      sortTimelineByTime();
      STATE.dietFlags = result.dietFlags;
      STATE.refSections = Object.entries(result.freeText)
        .filter(([name]) => name !== 'Event Overview' && name !== 'Service Setup / Layout')
        // Event Overview promoted to its own section; Service Setup / Layout
        // promoted into the new Layout & Locations section below — both
        // excluded here so they're not ALSO sitting in the generic
        // collapsed accordion, which would just be confusing duplication.
        .map(([name, text]) => ({ name, text }));
      STATE.eventOverview = result.eventOverview || '';
      STATE.layoutLocations = result.layoutLocations || [];
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
  renderLayoutLocations();
  renderResponsibility();
  renderDiet();
  renderRoster();
  renderTimeline();
  renderBuffetLayout();
  renderAttachments();
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

  const attachmentInput = document.getElementById('file-attachment');
  document.getElementById('btn-add-attachment').addEventListener('click', () => attachmentInput.click());
  attachmentInput.addEventListener('change', e => {
    if (e.target.files.length) handleAttachmentFiles(e.target.files);
    attachmentInput.value = ''; // allow re-selecting the same file later
  });
  document.getElementById('attachment-modal-close').addEventListener('click', closeAttachmentModal);
  document.querySelector('.attachment-modal-backdrop').addEventListener('click', closeAttachmentModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAttachmentModal();
  });

  renderAll();
});
