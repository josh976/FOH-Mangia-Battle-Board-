# EXECUTE PACKET — for Baltar

**Status: This is the FINAL set. Replaces the prior backup briefing's "in progress" framing — the build described there is done, tested, ready to push.**

---

## WHAT TO DO

1. Replace these 3 files in the repo with the 3 attached here:
   - `index.html`
   - `app.js`
   - `parser.js`
2. Commit, push to `main`.
3. Confirm Netlify auto-deploys (or trigger manually if it doesn't).
4. Reply to Josh with the deploy URL once live. No further changes needed from you beyond the replace + push — this is a complete, tested set, not a patch to merge by hand.

Do not hand-merge or cherry-pick pieces of these files into the existing repo files — replace wholesale. They were built starting from your last repo export, so your font/palette work is already included; a manual re-merge risks reintroducing the bugs this round fixes.

---

## WHAT CHANGED THIS ROUND (6 items)

1. **Merged your brand work** (Bree Serif + Inter fonts, avocado/orange-soft palette tokens) with the 4 fixes from the prior round (timeline trigger-sort bug, "Wrap"→"Strike" label, service-style taxonomy split, SVG buffet diagram). Confirmed via diff: zero real conflicts, your additions were purely additive to `:root`/`<head>`.

2. **New "Layout & Locations" section.** Pulls the `Service Setup / Layout` worksheet section wholesale, plus location-flavored lines out of `Operations Notes` (regex-matched on location keywords — wall/fence/driveway/park/SW/etc.), into its own prominent section positioned right after Event Overview. Previously this content was buried in the generic collapsed reference accordion. `Operations Notes` still appears in full in the generic accordion too — only the location-flavored lines are ALSO surfaced up top, nothing was removed from its original location.

3. **Responsibility matrix: water split + 2 new items.**
   - Old single "Fill water on tables" item replaced with two independent items: "Prefill water goblets tableside" and "Tableside water service" (events do one, the other, or both — confirmed by Josh, a merged item couldn't represent that).
   - Added "Mangia disposables" (Y/N) and "Event rentals" (Y/N).
   - Matrix is now 22 items (was 19). Auto-fill rules for the new water items are narrowly scoped and tested not to cross-fire on each other. Disposables/rentals have no auto-fill rules — always manual, consistent with the existing conservative philosophy (better unset than guessed wrong).

4. **Attachments rebuilt.** Thumbnail strip (84×84px, click to expand into a fullscreen lightbox modal with Esc/backdrop-click to close). Stored as data URLs in STATE so they travel with JSON export/load — no backend needed, consistent with the rest of the app. **Explicitly excluded from print** via a dedicated `@media print { #section-attachments{display:none!important} }` rule — verified in real browser print-media emulation. This fixes the v1 complaint about tiny embedded images breaking print document flow.

5. **Confirmed (no code change): Event Worksheet CSV remains the only supported input format.** Re-verified this round by running the actual parser against both Worksheet and Proposal CSVs for the same event — Worksheet: 26 timeline rows, 16 food items, full free-text sections. Proposal: 0 timeline rows, 0 food items. Not close. Do not let this get relitigated without re-running that comparison.

6. **Confirmed: staff/labor roster comes from Nowsta CSV only**, never from the Worksheet's "Event Labor" section (which is internal headcount placeholders, not real staff data).

---

## TESTING DONE

- 36 automated tests (jsdom headless), covering: prior-fix regression (timeline sort, Strike label, taxonomy, buffet SVG), new Layout & Locations extraction + rendering + editing, responsibility matrix split + new items + auto-fill isolation, attachments add/remove/modal/print-exclusion, full JSON round-trip with all new fields. All 36 pass.
- Real browser testing (Playwright) against actual Supp and Watts wedding worksheet CSVs through the real upload UI (not synthetic data) — confirmed zero console errors, correct rendering, correct print-media behavior.
- Manual visual review of all three new sections via screenshot.

---

## KNOWN, NOT FIXED THIS ROUND (deliberately deferred, not forgotten)

- Proposal-format-detected import warning (would prevent someone accidentally uploading a Proposal CSV and getting a silently near-empty board). Needs Josh's sign-off on exact warning wording/behavior before building — flagged, not specified.
- "Other Contacts" mini-field (photographer/videographer/coordinator info) — exists only in Proposal CSV, not Worksheet. Possible small future addition as an optional second upload. Not started.
- Place setting layout diagram, napkin fold reference panel — separate from buffet layout, not started, real reference material from Josh's docs waiting to be built.
- Netlify Blobs / editable-templates architecture (v2.1/v2.2 from your original brief) — still flagged as a deliberate architecture decision for Josh to make on purpose, not a routine update. Don't build this without explicit go-ahead — it changes the app from backend-free to backend-dependent, which was an explicit original requirement.

---

## IF SOMETHING LOOKS WRONG AFTER DEPLOY

Don't patch it yourself — relay back to Josh with specifics (screenshot + what's wrong), same loop as this round. The recurring failure mode this whole project has been managing is two parties editing in parallel without syncing; let's not reintroduce that now that we're caught up.
