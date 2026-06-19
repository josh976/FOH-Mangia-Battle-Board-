# BACKUP BRIEFING — for Baltar, in case this Claude session cuts off mid-build

**This is an appraisal + fallback plan. You are not being asked to do work unless this session dies before finishing.**

---

## 1. WHERE THINGS STAND RIGHT NOW

Josh and Claude (this session) diffed your current repo export (`FOH-Battle-Board-v2_0.zip`) against Claude's working copy. Result: **zero real conflicts.** Every difference fell into two clean buckets:

- **Your repo has, that Claude's didn't:** Google Fonts (Bree Serif + Inter), expanded brand palette tokens (`--avocado`, `--avocado-soft`, `--orange-soft`), all scoped to `:root` and `<head>` only. Good, clean, additive work — confirmed via Pantone-sourced comments citing "Mangia Brand Guidelines v3."
- **Claude's copy has, that yours doesn't yet:** 4 bug/feature fixes from a prior round (see #3 below), confirmed via diff to be simply absent from your repo, not conflicting edits.

This session is now merging both into one final set, then adding a new scoped feature list (see #4). If this session dies before that finishes, here's what to do.

---

## 2. IF THIS SESSION DIES BEFORE FINISHING — WHAT TO DO

1. Check whether Josh has received a final "here are the 3 files, push these" message from Claude in the main conversation. If yes — that supersedes everything below, use those files.
2. If no final files were delivered, **do not guess or build from this briefing's description.** Open a fresh Claude session, paste this entire briefing plus the current repo files, and ask Claude to pick up from "Section 4: Scoped Build List" below. The fix descriptions here are accurate as of this writing but the actual code is what matters — don't hand-implement from prose summaries.
3. Your existing repo (the one in `FOH-Battle-Board-v2_0.zip`) is a safe, working fallback. It has the pre-fix buffet chips and the timeline-sort bug, but it is NOT broken — it's the same state the live site is already in. No urgency to revert anything.

---

## 3. THE 4 FIXES FROM THE PRIOR ROUND (confirmed absent from your repo, going into the merge)

1. **Timeline trigger-insert sort bug.** When a trigger sequence (e.g. "Insert Buffet open sequence") is clicked, generated steps with earlier times than the anchor row were displaying BELOW the anchor instead of above it — array was spliced but never re-sorted by time. Fix: new `sortTimelineByTime()` function, called after trigger insert and after worksheet import. NOT called on every render (would fight manual drag-reorder).

2. **"Wrap" badge renamed to "Strike"** — matches Mangia's actual terminology ("setup and strike").

3. **Service-style taxonomy split.** Old `STYLE_PATTERNS` in parser.js merged Cocktail Hour, Passed Apps, and Action Stations into one generic "Stations" badge. Split into: Buffet, Action Stations, Bar, Passed Apps, Cocktail Hour, Family Style, Plated, Ceremony, Strike — matching how Mangia actually categorizes service styles.

4. **Buffet layout diagram rebuilt as real spatial SVG** instead of a flat row of editable chips. Shows actual table shapes (cutlery/butter/bread/salad cold line, chafer rectangles scaled to item count, color-coded by category, flow arrows, plate stack) — matches Mangia's printed Buffet Drawing Template. A compact synced edit list (drag-reorder, rename, category, delete) sits below the diagram for editing; the diagram itself is read-only/visual.

---

## 4. SCOPED BUILD LIST FOR THIS ROUND (in progress when this briefing was written)

1. **Merge** — Baltar's font/palette additions + Claude's 4 fixes above into one clean file set. Low risk, mechanical, already diffed clean.

2. **New "Layout & Locations" section.** Currently, location-specific staff guidance (e.g. "Buffet - SW end of yard along fence line," "Park in Neighbors' yard per layout SW side") is buried inside the generic collapsed "Setup & reference notes" accordion, mixed in with Bar Overview/Decor/Buffetware/Equipment. Pulling `Service Setup / Layout` (already a parsed free-text section) plus location-flavored lines out of `Operations Notes` into its own clearly labeled section, positioned high on the board (after Event Overview, before the responsibility matrix) — since "where do things go" is oriented around early.

3. **Attachments rebuild.** v1 had attachments that embedded as tiny images and broke document flow/length. Rebuilding as: thumbnail strip in the editor (click to expand to full-size in a modal), EXCLUDED from print output entirely (reference material for building the board, not part of the staff-facing printed document).

4. **Responsibility matrix additions:**
   - Split the single "Fill water on tables" item into TWO separate Y/N items: "Prefill water goblets tableside" and "Tableside water service" (sometimes one, sometimes the other, sometimes both — confirmed by Josh)
   - Add "Mangia disposables" Y/N
   - Add "Event rentals" Y/N

5. **NOT in scope, explicitly deferred:** Switching to or also parsing the Proposal CSV format. CONFIRMED MULTIPLE TIMES: Proposal format parses to ~0 useful data through the current parser (0 timeline rows, 0 food items, vs. Worksheet's 26/16). Event Worksheet CSV remains the single source. Do not let anyone talk you into "just use the Proposal instead" — it was tested and rejected for good, verified, repeated reasons. The ONE thing from the Proposal worth possibly grabbing someday: an "Other Contacts" block (photographer/videographer/day-of coordinator with phone numbers) that doesn't exist in the Worksheet — flagged as a possible tiny future addition, not started, not urgent.

6. **NOT in scope:** Proposal-format-detected import warning (nice-to-have safety guard, not yet specified in detail — needs Josh's sign-off on exact warning behavior before building).

---

## 5. KEY DECISIONS NOT TO RELITIGATE (still true, confirmed repeatedly this session)

- Event Worksheet CSV is the ONLY input format. Confirmed via real parser test output at least twice. Proposal CSV silently produces a near-empty board if uploaded — this is a known gap (see item 6 above), not a reason to switch formats.
- Staff/labor roster comes from Nowsta CSV ONLY. The Worksheet's "Event Labor" section is internal headcount placeholders, not real staff data — ignore it for roster purposes.
- No AI/LLM calls in the parsing pipeline. Pure JS, offline-capable, deterministic.
- No backend dependency for the core app (export-JSON-to-save, no localStorage autosave, no Netlify Blobs) — this was the ORIGINAL explicit requirement. If v2.1/v2.2 Blobs-backed editable templates are still being considered, that's a deliberate architecture change Josh needs to approve on purpose, not something to ship as a routine update.
- FOH-facing scope only. BOH (field kitchen) content deliberately excluded — separate future repo if/when Josh asks.

---

## 6. WORKFLOW REMINDER

Claude has no push access and no GitHub/Netlify connector. The handoff is: Claude produces final files in chat → Josh relays to Baltar → Baltar applies + pushes. Baltar should not make independent changes in parallel without syncing first — that's exactly the "working in the dark in different directions" problem this whole process is trying to avoid. If Baltar has ideas or sees issues, flag them to Josh for relay back to Claude rather than implementing unilaterally.
