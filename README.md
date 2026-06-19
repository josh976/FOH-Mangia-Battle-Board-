# Mangia Battle Board — FOH

Single-page battle board for Mangia Catering Co. event staff. Auto-fills timeline,
responsibility matrix, buffet layout, and diet callouts from TPP Event Worksheet +
Nowsta roster CSVs.

**No backend, no AI — pure browser-side parsing, save = JSON download, print = paper.**

## Live deploy

TBD (Netlify auto-deploys from `main` once connected)

## Local development

```bash
# From the repo root:
python3 -m http.server 8000
# then open http://localhost:8000 in any browser
```

That's it. No build step, no bundler, no Node. Three static files load in the browser.

## Files

| File        | Purpose                                                          |
|-------------|------------------------------------------------------------------|
| `index.html`| Single-page shell, CSS, DOM. Loads parser + app as `<script>`.   |
| `parser.js` | Pure-JS CSV parsers (TPP Event Worksheet + Nowsta roster).       |
| `app.js`    | UI state machine, render functions, drag-reorder, save/load.    |

## How to use it

1. Open the app (live URL or local `python3 -m http.server`)
2. Drag your **Event Worksheet CSV** into the left upload zone
3. Drag your **Nowsta Time & Attendance CSV** into the right upload zone
4. The timeline, responsibility matrix, and buffet layout auto-populate
5. Click **`+ Insert [trigger]`** chips to drop pre-built timeline sequences
6. Tweak anything by hand — every field is editable inline
7. **`Export JSON`** saves the full state to a `.json` file (also stored in localStorage as autosave)
8. **`Print / Save PDF`** for the printed copy your staff carries on event day

## Status

- **v2.0** — Claude's prior build imported, Mangia brand palette applied, fonts loaded
- **v2.1** (next) — editable trigger templates + dish/serveware reference table

## Architecture

- No framework, no build step. Vanilla JS + DOM.
- All state in a single `STATE` object — exported to JSON, restored from JSON.
- Print stylesheet preserves the yellow highlight, hides UI chrome, breaks sections cleanly.
- 7 trigger templates with offset-minutes math from anchor row's parsed time.
- 16 regex rules for responsibility matrix auto-fill (specific-first, audit trail).

## Known v2.0 gaps (deferred to v2.1+)

- Trigger templates are hardcoded constants — not yet user-editable
- Dish/serveware lookup is an empty `{}` — manual reference table not yet wired
- No undo for delete (timeline / staff / hot-item ✕ buttons)
- No keyboard shortcuts (Cmd+S to save, Enter to add row, etc.)
- Print stylesheet is functional but not tested on real paper yet

## Brand

Mangia Catering Co. Pantone TPG palette verified from official brand guidelines v3.
See `<style>` block in `index.html` for color tokens.