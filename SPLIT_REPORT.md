# SPLIT REPORT

Release: Glass Player 6.3.0 HARMONIC UPDATE  
Core: GP Core 3.0  
Source baseline: `original/Glass Player 6.2.2.html`

## File line counts

| File | Lines |
|---|---:|
| `original/Glass Player 6.2.2.html` | 8355 |
| `index.html` | 477 |
| `app.css` | 775 |
| `app.js` | 7134 |

Line-count method: newline sequence count plus one for each non-empty file. Extracted CSS and JavaScript retain the original leading and trailing newline content.

## Required declarations

| Check | Result |
|---|---|
| Logic modified | No |
| CSS order modified | No |
| DOM modified | No |

## Integrity checks

- Original baseline byte-for-byte copy: Pass
- Original source SHA-256: `b85f8f8d5d944645bd2b79334e40f3f485e8e92748f81b189cf6105925670625`
- CSS content character-for-character identical to the original `<style>` content: Pass
- JavaScript baseline order preserved: Pass. The only approved additions are 6.3.0 / GP Core 3.0 release metadata and bilingual changelog data.
- `app.css` SHA-256: `079bd1955bef707a572456b5cbcd097b5b382dd74688482732c4c05fd5424475`
- `index.html` SHA-256: `068882b94958751bbf3ee8671b2d4916d2a7c31f0ed6f85211ac0a63f9585660`
- `app.js` SHA-256: `d51344e628426ec85ed257fb6e321205f999437950f21d5d2c061cf214ba33b6`
- Pre-release-metadata split reassembly character-for-character identical to the decoded 6.2.2 source: Pass
- Final delta audit against the 6.2.2 baseline: Pass. Differences are limited to external-file tags, 6.3.0 / Ver. 3.0 / HARMONIC UPDATE / GP Core 3.0 identity strings, and the bilingual 6.3.0 changelog entry.
- Main inline CSS remaining in `index.html`: No
- Main inline JavaScript remaining in `index.html`: No
- Original outer IIFE and strict-mode directive preserved: Pass
- `type="module"`, `defer`, or `async` added: No
- JavaScript syntax check (`node --check app.js`): Pass
- Relative `file://` resource layout (`index.html`, `app.css`, and `app.js` in the same directory): Pass
- Automated browser-console inspection: Not run because the controlled browser blocks local `file://` navigation by security policy. No new split-related parse or extraction errors were found by the checks above.

No element order, ID, class, `data-*`, inline style, SVG, ARIA attribute, storage key, database contract, playback path or feature implementation was changed. Only release-facing text values were updated so every current-build label consistently identifies 6.3.0 HARMONIC UPDATE / GP Core 3.0; historical release names remain untouched.
