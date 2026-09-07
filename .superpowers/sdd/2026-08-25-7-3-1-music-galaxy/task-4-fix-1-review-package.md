# Task 4 fix round 1 review package (no Git fallback)

Fix base snapshots:
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-4-review-base/index.html`
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-4-review-base/app.css`
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-4-review-base/i18n.js`
- `.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/snapshots/task-4-review-base/contract-tests.ps1`

Fix changed files: `src/data/i18n.js`, `tests/contract-tests.ps1`, and the
appended report. No DOM or CSS file changed in this fix.

## Finding under verification

`index.html:291` uses `aria-label="音乐银河图例"`, but the previous i18n table
had no direct EN/RU mapping. Non-Chinese assistive technology could therefore
announce Chinese text.

## Fix diff

`src/data/i18n.js` now includes:

```js
Object.assign(UI_EN,{"音乐银河图例":"Music Galaxy legend"});
Object.assign(UI_RU,{"音乐银河图例":"Легенда музыкальной галактики"});
```

`tests/contract-tests.ps1` now constructs the Chinese key from code points and
checks the DOM attribute, exact English value, and nonempty direct Russian
mapping without adding a raw non-ASCII literal to the new test expression:

```powershell
$galaxyLegendKey=-join @([char]0x97F3,[char]0x4E50,[char]0x94F6,[char]0x6CB3,[char]0x56FE,[char]0x4F8B)
$galaxyLegendRuMatch=[regex]::Match($i18nSource,'(?s)Object\.assign\(UI_RU,\{.*?"'+[regex]::Escape($galaxyLegendKey)+'":"(?<value>[^"]+)"')
Expect ($index.Contains('aria-label="'+$galaxyLegendKey+'"') -and $i18nSource.Contains('"'+$galaxyLegendKey+'":"Music Galaxy legend"') -and $galaxyLegendRuMatch.Success -and $galaxyLegendRuMatch.Groups['value'].Value.Length -gt 0 -and $galaxyLegendRuMatch.Groups['value'].Value -ne $galaxyLegendKey) 'Music Galaxy legend aria-label must have direct English and Russian localization'
```

## Report and checks

Read the appended Fix round 1 section in:
`.superpowers/sdd/2026-08-25-7-3-1-music-galaxy/task-4-report.md`

Reported results: legend contract GREEN; full contract retains only Task 5
interaction and 7.3.1 identity failures. No protected runtime/build/release
files changed.
