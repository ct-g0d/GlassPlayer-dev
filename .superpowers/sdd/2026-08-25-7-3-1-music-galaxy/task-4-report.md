# Task 4 — Music Galaxy localized DOM and shell CSS

## Status

Task 4 is complete within its assigned static UI boundary. The existing Music
Galaxy placeholder child is replaced by one localized, accessible Canvas shell.
No Galaxy rendering, pointer behavior, bootstrap wiring, runtime state,
persistence, audio, navigation, generated output, release identity, or
governance file was changed.

## Ownership and scope

- Classification: DOM-only view presentation and localized copy.
- Primary owner: the existing Music Galaxy DOM/CSS surface in `index.html` and
  `app.css`; strings are owned by `src/data/i18n.js`.
- Allowed later consumer: Task 5's Galaxy view behavior may populate the
  declared Canvas, status, tooltip, and localized dynamic strings.
- Protected: all `src/**` runtime modules, sidebar/nav order, Accent/focus
  behavior, Store/Event Bus, IndexedDB/localStorage, cache identity, audio
  graph, `SOURCE_ORDER.txt`, `build/app.js`, root `app.js`, historical source,
  releases, and governance documents.
- Persistence/schema/API/event/changelog impact: none.

## Changed files

- `index.html`
  - Preserved `<section class="view galaxy-view" data-view="galaxy">` and
    replaced only its former child.
  - Added one `.galaxy-surface` with a kicker, title, semantic subtitle, one
    stage/shell, exactly one focusable `#galaxyCanvas`, one polite hidden
    `#galaxyTooltip`, one polite `#galaxyStatus`, and a compact legend/hint row.
  - Canvas has a translated `aria-label`; the existing translation tree already
    translates text and `aria-label` attributes.
- `app.css`
  - Removed `.galaxy-coming-soon`.
  - Added scoped `.galaxy-*` shell rules for transparent acrylic material,
    contained responsive stage sizing, overflow safety, full-shell Canvas,
    small non-interactive popover material, readable status/legend, Accent
    focus-visible state, and reduced-motion transition suppression.
  - Extended the existing shared title typography selector to include the new
    `.galaxy-title`; no existing title behavior was otherwise changed.
- `src/data/i18n.js`
  - Removed the Galaxy `敬请期待` / `Coming Soon` / `Скоро` entries.
  - Added Chinese-to-English and direct `UI_RU` entries for title/subtitle,
    star/cluster legend, hover/pin guidance, empty instruction, coverage and
    point counts, song metadata labels, tempo wording, and Canvas label.
- `tests/contract-tests.ps1`
  - Replaced the legacy centered-placeholder assertion with the required real
    Canvas surface assertion.
  - Replaced the English `Coming Soon` assertion with a DOM/i18n localized-copy
    assertion that does not require placeholder text.
  - Updated the adaptive-title assertion to require `.galaxy-title` while
    retaining the existing 500 ms liquid-scrollbar condition.

## RED evidence

After the contract-only edits and before production DOM/CSS/i18n edits, the
contract script reported these intended Task 4 failures:

- `Music Galaxy must expose the real Canvas surface`
- `Music Galaxy localized copy missing`
- `Adaptive Galaxy text or 500ms liquid scrollbar fade missing`
- `Music Galaxy placeholder must be replaced`
- `Music Galaxy Canvas surface is missing`

The same RED run also reported the already-scheduled later-task failures:

- `Music Galaxy interaction/render contract is missing`
- `7.3.1 engine identity is missing`

An initial RED invocation exposed a PowerShell 5 no-BOM parser issue caused by
new non-ASCII literals in the test source. The localized-copy assertion was
made ASCII-safe while still reading `index.html` and `src/data/i18n.js` as
UTF-8. The next RED run reached the expected named contract failures above.

## GREEN and static verification

- PASS — Task 4's updated DOM/CSS/localization assertions now pass. The full
  contract script reports only the two later-task failures listed above.
- PASS — Static accessibility/shape check: exactly one Canvas, tooltip, and
  status element; Canvas has `tabindex="0"` and a localized `aria-label`.
- PASS — Static localization check: English subtitle/status/map strings and
  direct Russian subtitle/map strings are present.
- PASS — Static CSS check: Galaxy shell has `contain:layout paint`, Canvas
  fills its shell, tooltip is pointer-events-none, and the reduced-motion rule
  targets only Galaxy shell transitions.
- PASS — Product DOM/CSS/i18n placeholder scan is clean.
- NOT RUN — `build.ps1`, because it would regenerate the explicitly protected
  `build/app.js`; Task 8 owns generated output regeneration.
- NOT RUN — architecture validation; this task changes no source module or
  dependency edge, and the task brief requires the targeted contract/static
  checks instead.
- NOT RUN — JavaScript syntax check: `node` is unavailable on PATH.
- NOT RUN — Edge/file://, audio, 4K/110%, and 120 Hz verification. Canvas
  rendering and interaction do not exist until Task 5, so visual runtime
  acceptance is not yet meaningful.

## Residue scan and boundaries

The exact requested broad `rg` scan still reports:

- Negative contract patterns in `tests/contract-tests.ps1` (they ensure the
  product cannot regress to the placeholder).
- A pre-existing `src/ui/player-visuals.js` contrast query for
  `.galaxy-coming-soon`.
- Historical release-note references in `src/data/releases.js`.

They were deliberately left unchanged: this task expressly forbids modifying
runtime JavaScript and release files. The old Player Visuals selector should
be reconciled by the behavior/runtime work that owns it; historical release
notes should not be rewritten as current product state.

## Self-review

- No duplicate Canvas, tooltip, status, mask, backdrop, shell, runtime, or
  layout state was introduced.
- Sidebar and navigation markup/order were not touched.
- The focus treatment uses existing Accent variables and suppresses no browser
  behavior outside the Canvas.
- The material uses existing glass/popover variables and does not add a white
  or black contrast strip, page-wide backdrop, fixed-frame loop, JavaScript,
  timer, or persistence path.

## Concerns / follow-up

1. Task 5 must implement Canvas drawing, dynamic localized status/tooltip
   content, pointer/keyboard behavior, and the live title-contrast selector
   update without adding a second state owner.
2. Task 8 must regenerate `build/app.js`; the release/version identity remains
   intentionally RED until the owning tasks update it.

## Fix round 1 — Galaxy legend aria-label localization

### Root cause

`index.html` uses `aria-label="音乐银河图例"` on the Galaxy legend. The
existing translation tree translates `aria-label` values, but neither `UI_EN`
nor `UI_RU` had that exact key. English and Russian UI therefore retained the
Chinese label for assistive technology.

### RED evidence

The following ASCII-safe contract was added before the i18n fix. It constructs
the Chinese key from Unicode code points, so PowerShell 5 does not have to
parse a newly added non-ASCII test literal. It verifies the actual DOM
attribute, the exact English value, and a nonempty direct value within an
`Object.assign(UI_RU, ...)` mapping.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

Output before the i18n entries:

```text
FAIL
- Music Galaxy legend aria-label must have direct English and Russian localization
- Music Galaxy interaction/render contract is missing
- 7.3.1 engine identity is missing
```

### Minimal fix

- Added `"音乐银河图例":"Music Galaxy legend"` directly to `UI_EN`.
- Added `"音乐银河图例":"Легенда музыкальной галактики"` directly to `UI_RU`.
- Did not alter the DOM key, CSS, translation mechanism, runtime, generated
  build, Player Visuals, releases, or any protected surface.

### GREEN and static verification

```powershell
$index=Get-Content -Raw -Encoding UTF8 'index.html'; $i18n=Get-Content -Raw -Encoding UTF8 'src/data/i18n.js'; $legendKey=-join @([char]0x97F3,[char]0x4E50,[char]0x94F6,[char]0x6CB3,[char]0x56FE,[char]0x4F8B); $ru=[regex]::Match($i18n,'(?s)Object\.assign\(UI_RU,\{.*?"'+[regex]::Escape($legendKey)+'":"(?<value>[^"]+)"'); 'LegendAttribute: '+$index.Contains('aria-label="'+$legendKey+'"'); 'EnglishMapping: '+$i18n.Contains('"'+$legendKey+'":"Music Galaxy legend"'); 'RussianDirectMapping: '+($ru.Success -and $ru.Groups['value'].Value.Length -gt 0 -and $ru.Groups['value'].Value -ne $legendKey); powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1; rg -n '音乐银河图例|Music Galaxy legend|Легенда музыкальной галактики' index.html src/data/i18n.js tests/contract-tests.ps1
```

Output:

```text
LegendAttribute: True
EnglishMapping: True
RussianDirectMapping: True
FAIL
- Music Galaxy interaction/render contract is missing
- 7.3.1 engine identity is missing
src/data/i18n.js:71:  Object.assign(UI_EN,{"音乐银河图例":"Music Galaxy legend"});
src/data/i18n.js:72:  Object.assign(UI_RU,{"音乐银河图例":"Легенда музыкальной галактики"});
index.html:291:      <div class="galaxy-legend" aria-label="音乐银河图例">
tests/contract-tests.ps1:178:Expect ($index.Contains('aria-label="'+$galaxyLegendKey+'"') -and $i18nSource.Contains('"'+$galaxyLegendKey+'":"Music Galaxy legend"') -and $galaxyLegendRuMatch.Success -and $galaxyLegendRuMatch.Groups['value'].Value.Length -gt 0 -and $galaxyLegendRuMatch.Groups['value'].Value -ne $galaxyLegendKey) 'Music Galaxy legend aria-label must have direct English and Russian localization'
```

The new legend contract is GREEN. The full contract still has only the known
Task 5 interaction and later 7.3.1 identity failures.

### Fix round 1 self-review

- The exact Chinese DOM key has direct EN and RU entries; neither maps back to
  Chinese or relies on the English fallback.
- The test source adds no non-ASCII literal for this new check and parses under
  the same PowerShell 5 invocation used by the project contract.
- Only `src/data/i18n.js`, `tests/contract-tests.ps1`, and this task report
  changed in this fix round. No runtime or protected file changed.
