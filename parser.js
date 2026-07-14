// ============================================================
// MANGIA BATTLE BOARD — Worksheet & Roster Parsers
// Pure JS, no external dependencies, no AI calls.
// Parses the messy multi-section CSV export from the TPP-style
// Event Worksheet, and the clean Nowsta Time & Attendance CSV.
// ============================================================

// ---- Generic CSV row splitter (handles quoted fields with commas/newlines) ----
function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  // Normalize line endings, strip BOM
  text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    // TPP's export uses a non-standard backslash-escaped quote (\") for literal
    // inch marks (14\" Pizza) instead of doubling the quote per RFC 4180. Treat
    // backslash-quote as a literal " character, never a quote-toggle, regardless
    // of current quote state — otherwise it desyncs the state machine and an
    // entire downstream section gets swallowed into one field.
    if (c === '\\' && text[i + 1] === '"') {
      field += '"';
      i++; // consume the quote too
      continue;
    }
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ---- Text cleanup: fix mojibake apostrophes/quotes/bullets from bad exports ----
function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/\?\?/g, '"')           // doubled garble -> quote (rare)
    .replace(/\u2019|\u2018|\?(?=s\b)/g, "'")   // smart quotes / "guest?s" -> guest's
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u00e9/g, 'e')          // é fallback if encoding stripped (Rosé -> Rose) - only used as last resort
    .replace(/^\s*\?\s*/g, '')       // leading "? " bullet -> strip
    .replace(/\?\t/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Contact/Venue cells in the TPP export concatenate what were originally separate
// lines (name, street, city/state/zip, phone) with no delimiter at all, e.g.
// "Bekka Supp7024 N 16th StDalton Garden, ID 83815Home: 2087709191". Insert
// readable breaks at the boundaries we can reliably detect: before a digit that
// starts a street address, before "Home:"/"Cell:"/"Work:", and before a
// capitalized city name that precedes a state abbreviation + zip.
function formatAddressBlock(s) {
  if (!s) return '';
  let out = cleanText(s);
  out = out.replace(/([a-z])(\d)/g, '$1\n$2');                 // name -> street number
  // street suffix (St/Ave/Rd/Dr/Ln/Blvd/Way/Ct/Pl) directly followed by a capitalized
  // word = suffix abbreviation ran into the city name with no original delimiter
  out = out.replace(/\b(St|Ave|Rd|Dr|Ln|Blvd|Way|Ct|Pl|Cir)([A-Z][a-z])/g, '$1\n$2');
  out = out.replace(/(\d)([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s?[A-Z]{2}\s?\d{5})/g, '$1\n$2'); // street -> "City, ST 00000"
  out = out.replace(/\s*(Home|Cell|Work):/g, '\n$1:');
  return out.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// Known section header strings (exact, case-sensitive match on trimmed first cell)
const SECTION_HEADERS = new Set([
  'Timeline', 'Food', 'Beverage', 'Rental / Equipment', 'Setup',
  'Event Overview', 'Menu / Culinary Notes', 'Operations Notes',
  'Buffetware / Servingware', 'Decor Collection / Linen Color',
  'Equipment & Rentals', 'Service Setup / Layout', 'Catering Kitchen / Staging',
  'Additional Tasks / Responsibilities of Mangia', 'Staffing',
  'Event Labor', 'Bar Overview', 'Bar Setup', 'Bar Service',
  'Welcome Bar', "Couple's Drinks After Ceremony", 'Reception Bar',
  'Bar Equipment', 'Bar Policies', 'End of Night', 'Event Notes',
]);

function isFooterRow(row) {
  return row[0] && row[0].trim() === 'Printed Date:';
}

function isBlankRow(row) {
  return row.every(c => !c || !c.trim());
}

// ---- Header block parser (top of doc, fixed label/value pairs) ----
function parseHeaderBlock(rows) {
  const meta = {};
  // Row 0: "Event Worksheet,Event Date:,6/20/2026 - Saturday"
  if (rows[0]) meta.eventDate = cleanText(rows[0][2]);
  for (let i = 1; i < Math.min(rows.length, 8); i++) {
    const row = rows[i];
    if (!row || row[0] === 'Timeline' || SECTION_HEADERS.has((row[0] || '').trim())) break;
    for (let c = 0; c < row.length - 1; c += 2) {
      const label = cleanText(row[c]).replace(/:$/, '');
      const value = cleanText(row[c + 1]);
      if (!label) continue;
      switch (label) {
        case 'Invoice #': meta.invoiceNumber = value; break;
        case 'Event Title': meta.eventTitle = value; break;
        case 'Sales Rep': meta.salesRep = value; break;
        case 'Status': meta.status = value; break;
        case 'Guest Count': meta.guestCount = value; break;
        case 'Service Style': meta.serviceStyle = value; break;
        case 'Contact': meta.contact = formatAddressBlock(value); break;
        case 'Venue': meta.venue = formatAddressBlock(value); break;
        case 'Occasion': meta.occasion = value; break;
        case 'Event Type': meta.eventType = value; break;
      }
    }
  }
  // Extract numeric guest count for math (rate-based duration calcs)
  if (meta.guestCount) {
    const m = meta.guestCount.match(/\d+/);
    meta.guestCountNum = m ? parseInt(m[0], 10) : null;
  }
  return meta;
}

// ---- Timeline section parser ----
// Rows look like: "Buffet Open,8:00 PM,No service on 3rd party..."
function parseTimelineSection(rows) {
  const items = [];
  // skip the "Time Name:,Time:,Notes:" header row if present
  let start = 0;
  if (rows[0] && /Time Name/i.test(rows[0][0] || '')) start = 1;

  for (let i = start; i < rows.length; i++) {
    const row = rows[i];
    if (isBlankRow(row) || isFooterRow(row)) continue;
    const name = cleanText(row[0]);
    const time = cleanText(row[1]);
    const note = cleanText(row[2]);
    if (!name) continue;
    items.push({
      id: 'tl_' + Math.random().toString(36).slice(2, 9),
      name,
      time,
      timeMinutes: timeToMinutes(time),
      note,
      style: guessStyle(name),
      trigger: matchTrigger(name),
      source: 'imported',
      highlight: false,
    });
  }
  // sort by time of day, keeping undated rows at the end in original order
  items.sort((a, b) => {
    if (a.timeMinutes == null && b.timeMinutes == null) return 0;
    if (a.timeMinutes == null) return 1;
    if (b.timeMinutes == null) return -1;
    return a.timeMinutes - b.timeMinutes;
  });
  return items;
}

// Convert "8:00 PM" -> minutes since midnight, rolling past-midnight times forward (+1440)
// so a sequence like 9:30 PM ... 11:30 PM ... stays chronological even if it logically
// crosses into the next calendar day during sort comparisons within the same event.
function timeToMinutes(t) {
  if (!t) return null;
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return h * 60 + min;
}

function minutesToTime(mins) {
  let m = ((mins % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const min = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ap}`;
}

// Style guess used for structural (non-color) tagging — badges, not colors.
// INFO rows are timeline anchors with no Mangia action (Ceremony Start,
// Grand Entrance, etc.) — visually recessed on screen and print so staff
// can scan past them quickly. Checked FIRST so e.g. "Ceremony Start" never
// falls through to a generic catch-all. Order matters throughout.
const INFO_PATTERNS = [
  /^ceremony\s*(start|end|begins?)/i,
  /^first\s*dance/i,
  /^father.daughter|^mother.son/i,
  /^grand\s*entrance/i,
  /^toasts?$/i,
  /^reception\s*start/i,
  /^social\s*hour\s*(start|end)/i,
  /^(wedding|event)\s*(start|end)$/i,
  /^done\s*for\s*day$/i,
  /^rtb$/i,
  /^venue\s*access$/i,
  /^send\s*off$/i,
  /^(bride\s*and\s*groom|couple)\s*(enter|entrance|arrive)/i,
  // Logistics/admin rows — not FOH action items
  /^staff\s*schedule\s*(on|off)$/i,
  /^event\s*staff\s*schedule\s*off$/i,
];
function isInfoRow(name) {
  return INFO_PATTERNS.some(re => re.test(name.trim()));
}

const STYLE_PATTERNS = [
  [/buffet/i, 'Buffet'],
  [/flip\s*buffet/i, 'Buffet'],
  [/action\s*station/i, 'Action Stations'],
  [/\bbar\b/i, 'Bar'],
  [/passed\s*apps?|passed\s*hors/i, 'Passed Apps'],
  [/cocktail\s*hour|social\s*hour|happy\s*hour/i, 'Cocktail Hour'],
  [/family\s*style/i, 'Family Style'],
  [/plated|^serve\b|served\b/i, 'Plated'],
  [/ceremony/i, 'Ceremony'],
  [/strike|bussing|breakdown/i, 'Strike'],
];
function guessStyle(name) {
  if (isInfoRow(name)) return 'Info';
  for (const [re, label] of STYLE_PATTERNS) if (re.test(name)) return label;
  return 'General';
}

// Trigger matching — keyed to recognized row-name patterns, drives template injection.
// Strike trigger broadened: matches "Strike Start", "Strike End", "Final Bussing" etc.
const TRIGGER_PATTERNS = [
  [/buffet open/i, 'buffet_open'],
  [/flip\s*buffet/i, 'flip_buffet'],
  [/buffet close/i, 'buffet_close'],
  [/bar start/i, 'bar_start'],
  [/bar end/i, 'bar_end'],
  [/cocktail hour start|social hour start|happy hour start/i, 'stations_start'],
  [/cocktail hour end|social hour end|happy hour end/i, 'stations_end'],
  [/final bussing|strike\s*(start|begin)?$|^strike$/i, 'final_strike'],
  [/all tables set and ready/i, 'place_settings_check'],
];
function matchTrigger(name) {
  for (const [re, key] of TRIGGER_PATTERNS) if (re.test(name.trim())) return key;
  return null;
}

// ---- Food section parser ----
// Pattern: "Item Name,Notes,Qty" row, optionally followed by a description-only row
// (single cell, no commas-as-columns... actually still has commas in prose, so we
// detect a "description row" as: row[1] and row[2] both empty AND row[0] non-empty
// AND previous row had a qty.
function parseFoodSection(rows) {
  const items = [];
  let menuLabel = '';
  let i = 0;
  // skip blank/menu-name rows until "Menu Item:,Notes:,Quantity:" header
  while (i < rows.length && !/Menu Item:/i.test(rows[i][0] || '')) {
    if (rows[i][0] && rows[i][0].trim()) menuLabel = cleanText(rows[i][0]);
    i++;
  }
  i++; // skip the header row itself
  let pending = null;
  for (; i < rows.length; i++) {
    const row = rows[i];
    if (isFooterRow(row)) continue;
    if (isBlankRow(row)) continue;
    const c0 = cleanText(row[0]);
    const c1 = cleanText(row[1]);
    const c2 = cleanText(row[2]);
    if (!c0) continue;
    if (c2 || (c1 && /x\d|allerg|vegan|dairy|gluten|gf\b/i.test(c1))) {
      // looks like a new item row (has qty, or notes that read like a diet flag even w/o qty)
      if (pending) items.push(pending);
      pending = { name: c0, notes: c1, qty: c2, description: '' };
    } else if (pending && !c1 && !c2) {
      // description continuation row
      pending.description = (pending.description ? pending.description + ' ' : '') + c0;
    } else {
      if (pending) items.push(pending);
      pending = { name: c0, notes: c1, qty: c2, description: '' };
    }
  }
  if (pending) items.push(pending);
  return { menuLabel, items };
}

// ---- Diet/allergy extraction — scans Food items + free-text sections for diet flags ----
const DIET_KEYWORDS = /gluten\s*free|\bgf\b|dairy\s*free|\bdf\b|vegan|vegetarian|nut\s*allerg|no\s*nut|allerg/i;
function extractDietFlags(foodItems, freeTextSections) {
  const flags = [];
  for (const item of foodItems) {
    const blob = `${item.notes} ${item.description}`;
    if (DIET_KEYWORDS.test(blob)) {
      flags.push({ source: item.name, text: cleanText(item.notes) || cleanText(item.description) });
    }
  }
  for (const [sectionName, text] of Object.entries(freeTextSections)) {
    if (/diet/i.test(sectionName) || DIET_KEYWORDS.test(text)) {
      text.split(/\n|(?<=\.)\s+/).forEach(line => {
        const t = cleanText(line);
        if (t && DIET_KEYWORDS.test(t)) flags.push({ source: sectionName, text: t });
      });
    }
  }
  // de-dupe identical text flags
  const seen = new Set();
  return flags.filter(f => {
    const key = f.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- Layout & Locations extraction ----
// Staff need "where does stuff go" surfaced prominently, not buried in the
// generic collapsed reference accordion. Pulls Service Setup / Layout wholesale,
// plus location-flavored content from Setup (corporate events use this section
// instead of Service Setup / Layout), Operations Notes, and Catering Kitchen /
// Staging. Location keywords are broad enough to catch distance-to-venue,
// security/badge access, and physical logistics notes that staff need before
// they arrive — not just furniture placement.
const LOCATION_KEYWORDS = /\b(set up|setup|located?|location|along the|near the|side of|end of|wall|fence|driveway|garage|passthrough|park(ing)?|sw |ne |nw |se |stair|entrance|access|security|badge|kitchen|scullery|field kitchen|stage|tent|outside|inside|adjacent|floor|room|building|hour drive|min(ute)?s? drive|from hq|from shop)\b/i;

function extractLayoutLocations(freeTextSections) {
  const parts = [];

  // Service Setup / Layout — always pulled wholesale (most common location section)
  const layoutSection = freeTextSections['Service Setup / Layout'];
  if (layoutSection && layoutSection.trim()) {
    parts.push({ source: 'Service Setup / Layout', text: layoutSection.trim() });
  }

  // Setup — corporate events often put arrival/security/layout info here instead
  const setupSection = freeTextSections['Setup'];
  if (setupSection && setupSection.trim()) {
    // Pull location-flavored lines only (Setup can contain non-location content
    // like "Rentals: none", "Decor: black linens" — filter those out)
    const locationLines = setupSection.split('\n')
      .map(l => l.trim())
      .filter(l => l && LOCATION_KEYWORDS.test(l));
    if (locationLines.length) {
      parts.push({ source: 'Setup', text: locationLines.join('\n') });
    }
  }

  // Catering Kitchen / Staging — almost always has location-critical info
  const kitchenSection = freeTextSections['Catering Kitchen / Staging'];
  if (kitchenSection && kitchenSection.trim()) {
    parts.push({ source: 'Catering Kitchen / Staging', text: kitchenSection.trim() });
  }

  // Operations Notes — pull location-flavored lines only (mixed content section)
  const opsNotes = freeTextSections['Operations Notes'];
  if (opsNotes) {
    const locationLines = opsNotes.split('\n')
      .map(l => l.trim())
      .filter(l => l && LOCATION_KEYWORDS.test(l));
    if (locationLines.length) {
      parts.push({ source: 'Operations Notes', text: locationLines.join('\n') });
    }
  }

  return parts; // [{source, text}]
}


// Collapses all rows in the chunk into cleaned, newline-joined prose/bullets.
function parseFreeTextSection(rows) {
  const lines = [];
  for (const row of rows) {
    if (isFooterRow(row) || isBlankRow(row)) continue;
    const text = row.map(cleanText).filter(Boolean).join(' ');
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

// ---- Event Labor section parser (role header rows + staff rows) ----
function parseEventLaborSection(rows) {
  const roles = [];
  let current = null;
  for (const row of rows) {
    if (isFooterRow(row) || isBlankRow(row)) continue;
    const c0 = cleanText(row[0]);
    const c1 = cleanText(row[1]);
    // Role header rows have nothing in column 2 (sched in) — e.g. "Catering - FOH"
    if (c0 && !row[2] && !/unassigned/i.test(c0)) {
      current = { role: c0, count: null, staff: [] };
      const countMatch = c0.match(/^\[(\d+)\]/);
      roles.push(current);
      continue;
    }
    if (current && c0) {
      const countMatch = c0.match(/^\[(\d+)\]/);
      if (countMatch) current.count = parseInt(countMatch[1], 10);
      current.staff.push({
        label: c0.replace(/^\[\d+\]\s*/, ''),
        scheduledIn: cleanText(row[2]),
        scheduledOut: cleanText(row[3]),
        note: cleanText(row[4]),
      });
    }
  }
  return roles;
}

// ============================================================
// MAIN: Split the full CSV into section chunks, dispatch each
// ============================================================
function parseEventWorksheet(csvText) {
  const allRows = parseCSVRows(csvText).filter(r => !(r.length === 1 && !r[0]));
  const headerRows = [];
  const sections = []; // { name, rows: [] }
  let current = null;
  let i = 0;

  // Header block = rows before first recognized section header
  while (i < allRows.length) {
    const cell0 = (allRows[i][0] || '').trim();
    if (SECTION_HEADERS.has(cell0)) break;
    headerRows.push(allRows[i]);
    i++;
  }

  for (; i < allRows.length; i++) {
    const row = allRows[i];
    if (isFooterRow(row)) continue;
    const cell0 = (row[0] || '').trim();
    if (SECTION_HEADERS.has(cell0) && (row[1] === undefined || row[1] === '')) {
      current = { name: cell0, rows: [] };
      sections.push(current);
      continue;
    }
    if (current) current.rows.push(row);
    else {
      // content before any recognized section after header block — catch-all
      if (!isBlankRow(row)) {
        if (!sections.length || sections[sections.length - 1].name !== '__unmatched__') {
          current = { name: '__unmatched__', rows: [] };
          sections.push(current);
        }
        current.rows.push(row);
      }
    }
  }

  const meta = parseHeaderBlock(headerRows);
  const result = {
    meta,
    timeline: [],
    food: { menuLabel: '', items: [] },
    beverage: { menuLabel: '', items: [] },
    laborRoles: [],
    freeText: {},     // sectionName -> joined text
    unmatched: '',
  };

  for (const sec of sections) {
    switch (sec.name) {
      case 'Timeline':
        result.timeline.push(...parseTimelineSection(sec.rows));
        break;
      case 'Food':
        result.food = parseFoodSection(sec.rows);
        break;
      case 'Beverage':
        result.beverage = parseFoodSection(sec.rows); // same shape (Item/Notes/Qty)
        break;
      case 'Event Labor':
        result.laborRoles = parseEventLaborSection(sec.rows);
        break;
      case '__unmatched__':
        result.unmatched += (result.unmatched ? '\n' : '') + parseFreeTextSection(sec.rows);
        break;
      default:
        // every other known section -> free text bucket, keyed by section name
        const text = parseFreeTextSection(sec.rows);
        result.freeText[sec.name] = (result.freeText[sec.name] ? result.freeText[sec.name] + '\n' : '') + text;
        break;
    }
  }

  result.dietFlags = extractDietFlags(result.food.items, result.freeText);
  result.responsibilityMatrix = buildResponsibilityMatrix(result.freeText, result.timeline, result.food.items);
  result.eventOverview = result.freeText['Event Overview'] || '';
  result.buffetHotItems = buildBuffetLayoutSuggestion(result.food.items);
  result.layoutLocations = extractLayoutLocations(result.freeText);

  return result;
}

// ============================================================
// RESPONSIBILITY MATRIX
// Fixed Y/N task list modeled on Mangia's "Event Task Breakdown"
// form. Grouped to match the printed form. Each task can be
// auto-set to Y/N from worksheet free text when the signal is
// unambiguous and narrowly scoped — otherwise stays unset (null)
// for manual call. Every auto-set value records *why* it fired
// (matchedText) so it's auditable, not a black box, and is always
// manually overridable in the UI.
// ============================================================
// Restructured matrix: 3 groups answering the real questions staff ask
// at a glance. Trimmed from 22 items to 13 focused, actionable ones.
// Three-way options (Mangia/Third party/None) replace simple Y/N where
// the distinction actually matters for staff behavior.
// ============================================================
const RESPONSIBILITY_MATRIX_TEMPLATE = [
  // SCOPE — who's doing what (the "don't touch that" vs "that's ours" answers)
  // "Client provided" = client themselves (distinct from "Third party" = unknown vendor)
  { group: 'Scope', key: 'bar_service',       label: 'Bar service',                options: ['Mangia','Third party','Client provided','None'] },
  { group: 'Scope', key: 'cocktail_food',     label: 'Cocktail hour food',          options: ['Mangia','Third party','Client provided','None'] },
  { group: 'Scope', key: 'dessert',           label: 'Dessert',                     options: ['Mangia','Third party','Client provided','None'] },
  { group: 'Scope', key: 'bussing',           label: 'Bussing',                     options: ['Full clear','Mangia only','Assist','None'] },
  { group: 'Scope', key: 'place_settings',    label: 'Place settings',              options: ['Mangia sets','Venue sets','None'] },
  // SERVICE — how we're running it
  // "Client" = happening but not ours (client or third party doing it, staff need visibility)
  { group: 'Service', key: 'apps_passed',         label: 'Passed apps',             options: ['Y','N','Client'] },
  { group: 'Service', key: 'apps_stationary',     label: 'Stationary apps',         options: ['Y','N','Client'] },
  { group: 'Service', key: 'beverages_reminder',  label: 'Beverages on menu',       options: ['Y','N'], isReminder: true },
  { group: 'Service', key: 'water_service',       label: 'Tableside water',         options: ['Prefill only','Full service','None'] },
  // LOGISTICS — what we're working with
  { group: 'Logistics', key: 'mangia_disposables', label: 'Mangia disposables',     options: ['Y','N'] },
  { group: 'Logistics', key: 'event_rentals',      label: 'Event rentals',          options: ['Mangia handles','Client handles','None'] },
  { group: 'Logistics', key: 'scullery',           label: 'Scullery',               options: ['Mangia sets up','Client provided','None'] },
  { group: 'Logistics', key: 'power_onsite',       label: 'Power onsite',           options: ['Y','N'] },
  { group: 'Logistics', key: 'water_onsite',       label: 'Water onsite',           options: ['Y','N'] },
];

const RESPONSIBILITY_RULES = [
  // Bar — self-serve / third-party = "Third party". Client-provided bar = "Client provided"
  { key: 'bar_service', value: 'Third party', re: /self\s*serve\s*bar|third[\s-]?party\s*bar|3rd\s*party\s*bar|no\s*mangia\s*bar/i },
  { key: 'bar_service', value: 'Client provided', re: /client\s*provided\s*bar|client\s*bar|client\s*handles?\s*bar/i },

  // Cocktail hour food — client provided or third party
  { key: 'cocktail_food', value: 'Third party', re: /third[\s-]?party.*(cocktail|apps)|3rd\s*party.*(cocktail|apps)/i },
  { key: 'cocktail_food', value: 'Client provided', re: /client\s*provided.*(cocktail|apps)|client\s*handle[sd]?\s*(cocktail|apps|charcuterie)|client\s*apps/i },
  { key: 'cocktail_food', value: 'Mangia',       re: /mangia.*(cocktail\s*hour|passed\s*apps|stationary\s*apps)/i },

  // Dessert
  { key: 'dessert', value: 'Third party', re: /third[\s-]?party.*dessert|3rd\s*party.*dessert/i },
  { key: 'dessert', value: 'Client provided', re: /client\s*handled?\s*cake|client.*dessert|no\s*mangia.*dessert|sweet\s*frostings/i },
  { key: 'dessert', value: 'Mangia',      re: /mangia.*dessert|cut\s*cake|serve\s*dessert/i },

  // Bussing — "Assist" = help within labor window, not responsible for completion
  { key: 'bussing', value: 'Full clear',   re: /full\s*bus(s)?\b|full\s*clear|clear\s*all/i },
  { key: 'bussing', value: 'Assist',        re: /assist.*bus|bus.*assist|bus(s)?ing.*service\s*window|bus(s)?ing.*labor\s*(block|window)|help\s*bus/i },
  { key: 'bussing', value: 'Mangia only',  re: /\bbuss?\s*mangia\s*disposables|clear\s*mangia\s*disposables|mangia\s*disposables\s*only/i },

  // Place settings
  { key: 'place_settings', value: 'Venue sets', re: /venue\s*setting\s*tables|no\s*pre\s*set\s*place\s*settings?|client.*place\s*settings/i },
  { key: 'place_settings', value: 'Mangia sets', re: /set(ting)?\s*tables?\s*with\s*place\s*settings?|mangia.*place\s*settings?/i },

  // Apps — "Client" = happening but not ours
  { key: 'apps_passed',     value: 'Client', re: /third[\s-]?party.*(apps|appetizer)|client\s*provided.*(apps|appetizer)|no\s*mangia.*(apps|appetizer)|client\s*handle[sd]?\s*apps|client\s*apps/i },
  { key: 'apps_passed',     value: 'Y', re: /passed\s*apps?/i },
  { key: 'apps_stationary', value: 'Client', re: /client\s*handle[sd]?\s*(stationary|apps|charcuterie)|third[\s-]?party.*(stationary|charcuterie)|client\s*provided.*(apps|charcuterie)/i },
  { key: 'apps_stationary', value: 'Y', re: /stationary\s*apps?|station(ary)?\s*app\s*table|charcuterie.*mangia|gourmet\s*cheese\s*display/i },

  // Beverages on menu — reminder flag: fires when beverage items detected
  { key: 'beverages_reminder', value: 'Y', re: /infused\s*water|huckleberry\s*lemonade|iced\s*tea|sweet\s*tea|lemonade|beverage\s*(dispenser|table|service)|coffee\s*service/i },

  // Water service — scanned from both free text and food items (Vinther pattern)
  { key: 'water_service', value: 'Full service', re: /tableside\s*water\s*service.*bringing|full\s*tableside|refill(ing)?\s*water\s*(pitchers?|during)/i },
  { key: 'water_service', value: 'Prefill only', re: /prefill\s*(goblets?|glasses?)|prefill\s*only|\bprefill\b[^.]{0,30}water|tableside\s*water\s*service[^.]{0,30}prefill/i },

  // Power and water onsite
  { key: 'power_onsite', value: 'N', re: /no\s*(venue\s*)?power|no\s*power\s*onsite|generator\s*required|no\s*electricity/i },
  { key: 'power_onsite', value: 'Y', re: /power\s*(is\s*)?available|venue\s*has\s*power|electrical\s*available|generator\s*not\s*required/i },
  { key: 'water_onsite',  value: 'N', re: /no\s*water\s*onsite|no\s*water\s*available|client\s*hauling\s*waste/i },
  { key: 'water_onsite',  value: 'Y', re: /water\s*(and\s*counter\s*)?avail|water\s*onsite|venue.*water|has\s*kitchen.*water/i },

  // Event rentals — distinguish provider
  { key: 'event_rentals', value: 'Client handles', re: /client\s*handle[s]?\s*rentals|client\s*provides?\s*(plates|tables|chairs)|third[\s-]?party\s*rentals?\s*[-—]\s*no\s*mangia|all\s*about\s*weddings|client\s*to\s*set\s*tables/i },
  { key: 'event_rentals', value: 'Mangia handles', re: /mangia.*rentals?|event\s*rents|mangia.*rent/i },

  // Scullery
  { key: 'scullery', value: 'Mangia sets up', re: /mangia\s*sets?\s*up\s*(scullery|dish|washing)|mangia\s*scullery/i },
  { key: 'scullery', value: 'Client provided', re: /client\s*scullery|venue\s*scullery|existing\s*scullery/i },
];

// Scan a worksheet's free-text sections + timeline notes for responsibility
// signals. Returns { [key]: { value:'Y'|'N', matchedText, source } }
function detectResponsibilityFlags(freeText, timeline, foodItems) {
  const flags = {};
  const sourcesToScan = [];
  for (const [name, text] of Object.entries(freeText || {})) {
    if (!text) continue;
    text.split('\n').forEach(line => { if (line.trim()) sourcesToScan.push({ source: name, text: line.trim() }); });
  }
  (timeline || []).forEach(t => {
    if (t.note) sourcesToScan.push({ source: 'Timeline: ' + t.name, text: t.note });
  });
  // Also scan food item names and notes — events like Vinther list water service
  // as a menu line item ("Tableside Water Service - Bringing Water") rather than
  // mentioning it in ops notes, so the free-text rules would miss it without this.
  (foodItems || []).forEach(i => {
    const text = cleanText(i.name) + (i.notes ? ' ' + cleanText(i.notes) : '');
    if (text.trim()) sourcesToScan.push({ source: 'Menu: ' + cleanText(i.name), text: text.trim() });
  });

  for (const rule of RESPONSIBILITY_RULES) {
    if (flags[rule.key]) continue;
    for (const src of sourcesToScan) {
      if (rule.re.test(src.text)) {
        flags[rule.key] = { value: rule.value, matchedText: src.text, source: src.source };
        break;
      }
    }
  }
  return flags;
}

function buildResponsibilityMatrix(freeText, timeline, foodItems) {
  const flags = detectResponsibilityFlags(freeText, timeline, foodItems);
  return RESPONSIBILITY_MATRIX_TEMPLATE.map(t => ({
    ...t,
    value: flags[t.key] ? flags[t.key].value : null,
    auto: !!flags[t.key],
    matchedText: flags[t.key] ? flags[t.key].matchedText : null,
    matchedSource: flags[t.key] ? flags[t.key].source : null,
  }));
}

// ============================================================
// BUFFET LAYOUT TEMPLATE
// Fixed cold-side layout (cutlery/butter/bread/salad) is constant
// per Mangia's standard. Hot items are event-specific and ordered
// least-to-most-expensive (veggie -> starch -> protein) by default;
// fully editable per event since the actual hot items vary.
// Start side is the salad end, per correction.
// ============================================================
const BUFFET_LAYOUT_DEFAULTS = {
  startSide: 'salad', // salad-side is always the start of the line
  coldLine: [
    { slot: 'cutlery', label: 'Cutlery' },
    { slot: 'butter', label: 'Butter' },
    { slot: 'bread', label: 'Bread' },
    { slot: 'salad', label: 'Salad' },
  ],
  hotLineNote: 'Hot items ordered least-to-most-expensive: veggie first, starch second, protein last. Cold sides (potato salad, mac salad) go before the salad. Rotate chafers 90\u00b0 to fill table space if needed \u2014 never leave open table.',
};

// Attempt to pre-sort an event's hot food items into the buffet line order
// using simple keyword categorization. This is a starting suggestion only —
// always manually reviewed/reordered in the UI, never trusted blind, since
// menu language varies too much for confident auto-classification.
const HOT_ITEM_CATEGORY_HINTS = [
  [/tri\s*tip|steak|chicken|salmon|pork|beef|brisket|sausage|stuffed.*pepper|vegetarian\s*entr/i, 'protein'],
  [/mac\s*(and|n)?\s*cheese|potato(es)?|rice|pasta|stuffing|quinoa(?!.*stuffed)/i, 'starch'],
  [/veg(gie|etable)|green\s*bean|haricot|carrot|squash/i, 'veggie'],
];
function suggestHotItemCategory(itemName) {
  for (const [re, cat] of HOT_ITEM_CATEGORY_HINTS) if (re.test(itemName)) return cat;
  return null; // unknown — left for manual categorization, no guess shown
}
const CATEGORY_ORDER = { veggie: 0, starch: 1, protein: 2 };

function buildBuffetLayoutSuggestion(foodItems) {
  const hots = (foodItems || [])
    .filter(i => {
      const n = i.name.trim();
      if (/-\s*passed\b|\bpassed\b/i.test(n)) return false;        // cocktail hour, not buffet line
      if (/salad/i.test(n)) return false;                          // any named salad, not just exact "Salad"
      if (/dressing|sauce|relish\s*\(|disposable|\bbox\b/i.test(n)) return false;
      if (/\bwater\b|\btea\b|lemonade|coffee|\bcoffee\b|beverage/i.test(n)) return false;
      if (/^roll|dinner\s*roll|bread\b/i.test(n)) return false;     // cold-line bread, not a hot
      if (/^cocktail\s*hour$/i.test(n)) return false;               // stray section-label row
      return true;
    })
    .map(i => ({ name: i.name, category: suggestHotItemCategory(i.name), notes: i.notes || '' }));
  hots.sort((a, b) => {
    const ca = a.category ? CATEGORY_ORDER[a.category] : 99;
    const cb = b.category ? CATEGORY_ORDER[b.category] : 99;
    return ca - cb;
  });
  return hots;
}

// ============================================================
// PACK LIST DISH / SERVEWARE LOOKUP
// No reliable auto-detection source exists for this (menu language
// is too inconsistent across events) — this is a manually maintained
// reference table the user builds over time. Structure only; starts
// empty. Matching against a menu item is a simple case-insensitive
// substring/alias lookup, left to the UI layer.
// ============================================================
function emptyDishLookup() { return {}; } // { [menuItemNameLower]: { dish, servingware, notes } }


function parseNowstaRoster(csvText) {
  const rows = parseCSVRows(csvText);
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  const idx = (name) => header.indexOf(name);

  const iFirst = idx('First Name'), iLast = idx('Last Name'), iPhone = idx('Phone Number'),
        iPosition = idx('Position'), iIn = idx('Scheduled In'), iOut = idx('Scheduled Out'),
        iEmail = idx('Email');

  const staff = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || isBlankRow(row)) continue;
    const first = cleanText(row[iFirst]);
    const last = cleanText(row[iLast]);
    if (!first && !last) continue; // totals row etc.
    staff.push({
      id: 'staff_' + Math.random().toString(36).slice(2, 9),
      name: `${first} ${last}`.trim(),
      phone: cleanText(row[iPhone]),
      email: cleanText(row[iEmail]),
      position: cleanText(row[iPosition]),
      isLead: /lead|captain/i.test(row[iPosition] || ''),
      team: /BOH/i.test(row[iPosition] || '') ? 'BOH' : (/bar/i.test(row[iPosition] || '') ? 'Bar' : 'FOH'),
      scheduledIn: cleanText(row[iIn]),
      scheduledOut: cleanText(row[iOut]),
      station: '',
    });
  }
  // Leads/captains sort to top within team
  staff.sort((a, b) => (b.isLead - a.isLead));
  return staff;
}

// Exports for use in app.js / inline script
if (typeof module !== 'undefined') {
  module.exports = {
    parseEventWorksheet, parseNowstaRoster, parseCSVRows,
    timeToMinutes, minutesToTime, cleanText, guessStyle, matchTrigger,
    isInfoRow, INFO_PATTERNS,
    RESPONSIBILITY_MATRIX_TEMPLATE, buildResponsibilityMatrix, detectResponsibilityFlags,
    BUFFET_LAYOUT_DEFAULTS, buildBuffetLayoutSuggestion, suggestHotItemCategory,
    emptyDishLookup, extractLayoutLocations,
  };
}
