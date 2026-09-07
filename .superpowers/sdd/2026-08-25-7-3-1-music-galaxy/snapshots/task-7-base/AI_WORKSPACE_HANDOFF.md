# Glass Player — AI Workspace Transfer Briefing

> 交接日期：2026-08-09（Pacific/Auckland）  
> 当前产品版本：**Glass Player 7.1.1 — STABILITY UPDATE**  
> 当前架构：**Peregrine Lake**  
> 目标读者：获得整个 `GlassPlayer-dev` 文件夹权限、但看不到此前长对话的新 AI Workspace

---

## 0A. Governance addendum — rules for every future feature

This addendum is the long-form companion to AGENTS.md and CURRENT_STATE.md.
The three files have different jobs:

- AGENTS.md is the always-on hard/soft engineering contract.
- CURRENT_STATE.md is the short current runtime snapshot.
- AI_WORKSPACE_HANDOFF.md is the detailed historical and architectural
  briefing.

The first read in every new AI workspace is AGENTS.md, followed by
CURRENT_STATE.md and DELIVERY_CHECKLIST.md. The handoff is read by section,
not blindly reloaded for every small task. No feature may be implemented
before the request is mapped to one owner module and one contract, and no
delivery claim may be made before the checklist is completed.

All existing panels, sectors, shells, sidebars, queue surfaces, history panes,
popovers and player surfaces are protected blocks. A new feature may attach a
declared child or hook, but must not reorder their DOM, rename selectors,
change unrelated dimensions/overflow/stacking, duplicate a shell/backdrop, or
use a global selector to fix one local block. If a cross-panel change is
required, document every affected block and test each one.

### 0A.1 Mixed enforcement

Hard gates must be checked by architecture validation or contract tests:

1. one module registry, Store and Event Bus;
2. one playlist, manual queue and shuffle timeline;
3. one AudioContext, Deck A/B graph, EQ graph and Spatial A/B pair;
4. existing IndexedDB/localStorage names, schemas, stores, indexes and keys;
5. documented API/event names and dependency direction;
6. source ownership and SOURCE_ORDER consistency;
7. full version identity/changelog synchronization;
8. Space/F10 playback mapping with F9/F11 absent;
9. elapsed-time animation scheduling.

Visual/product rules are review gates and should become automated checks when
the same regression repeats:

- no fake white/black contrast slabs;
- no duplicated glass or SSE layers;
- no sector geometry shift used to conceal a bug;
- no uncontrolled text overflow;
- no mixed-language UI strings;
- no visible transition settle twitch;
- no pointer release freezing a value transition;
- no 60 FPS assumption in a 120 Hz contract.

### 0A.2 Feature-routing matrix

Use this matrix before writing a line of code. A feature may have secondary
consumers, but the first row is the canonical owner.

| Requested capability | Canonical owner | Existing source area | Secondary consumers | Required checks |
| --- | --- | --- | --- | --- |
| play/pause/seek/volume/speed | Playback Service + Audio Engine | services/playback*, engines/audio-engine* | Queue, History, PiP, Media Session, UI | command routing, intent tokens, one graph |
| previous/next/repeat/shuffle | Queue Service + Playback Service | services/queue*, services/playback* | Player/Queue UI, Neural | timeline cursor, manual priority, no duplicate queue |
| manual queue/reorder/clear | Queue Service | services/queue-service.js, queue-runtime.js | playback, library, queue UI | duplicate prevention, clear/resume, stable identity |
| file/folder import | Library Service + File Adapter | services/library*, adapters/browser/file-adapter.js | recognition, spectrum, UI | cache hit, progress, cancellation, no UI picker policy |
| temporary import | Library Service | services/library-service.js | Queue, Playback, History | identity, placement, play command validity |
| metadata/cover/rescan | Recognition Engine + Library Service | engines/recognition*, services/library* | History, Spectrum, UI | old history linkage and cache preservation |
| Spectrum ID/audio essence | Recognition Engine | engines/recognition-engine.js | trackCache, Library, History | stable anchors and schema compatibility |
| MFCC/BPM/Energy/loudness analysis | Spectrum Analyzer/Service | engines/spectrum-analyzer*, services/spectrum-service.js | Neural, UI, cache | cache-first, no render-time decode |
| original loudness/normalization | Spectrum + Audio boundary | spectrum analyzer, audio engine, settings | Sound UI | original loudness unchanged, bounded gain |
| EQ presets/custom | Equalizer Engine + EQ data | engines/equalizer-runtime.js, data/eq-presets.js | Settings, Sound UI | preset curve, custom memory, no raw AudioNode |
| Spatial modes | Spatial Engine + Spatial data | engines/spatial-engine.js, data/spatial-presets.js | Audio, Settings/Sound UI | true bypass, fixed values, A/B crossfade |
| behavior events | History/Neural Services | services/history*, services/neural* | Store, IndexedDB | event type, timestamp, dedupe, no UI-only event |
| user preference model | Neural Service | services/neural-service.js, neural-runtime.js | History, Recommendation | decay/confidence/maturity |
| Daily Mix/recommendation | Neural Service | services/neural-service.js, data/genre-relations.js | Queue/UI | feature-aware, fresh/diverse, immature fallback |
| listening history | History Service | services/history-service.js | Neural, History UI | calendar ranges, 75% accumulated completion |
| theme/accent/background | Settings + Player Visuals | settings-service, player-visuals, CSS | all views | light/dark roundtrip, actual surface contrast |
| page/sector transition | Motion Engine + Shared Controls | engines/motion-engine.js, ui/shared-controls.js | every view | idempotence, geometry stable, elapsed time |
| Soft Scroll Edge | Shared Controls + CSS shell | ui/shared-controls.js, app.css | scrolling views | shell/viewport, endpoint mask, resize/mutation |
| popover/selector material | Shared Controls + CSS | ui/shared-controls.js, app.css | Snooze/EQ/Font/Sort/Speed | one material contract, no extra backdrop |
| font/language/copy | i18n + Settings | data/i18n.js, settings-service, views | all UI | both locales, no fallback leakage |
| changelog/version | releases data + bootstrap/index | data/releases.js, bootstrap/main.js, index.html | settings/changelog | legal x.y.z, all identity surfaces |
| PiP | PiP Service/Adapter/Renderer | services/pip*, adapters/browser/pip*, ui/pip-renderer | Player, Playback | one playback source, cleanup/resize |
| performance/scheduling | owning module + Clock/Motion | runtime constants, clock adapter, motion | all affected modules | no duplicate init, yield, targeted profile |
| future Electron/SQLite | Ports/Adapters only | adapters/browser/*, storage-port | Bootstrap | no premature runtime rewrite |

If a proposed feature does not fit this table, stop and define a new module
boundary before coding.

### 0A.3 Interface rules

Every module must have one clear purpose, one owner for mutable state and a
documented public boundary. The boundary must say:

- input and output shape;
- error/fallback behavior;
- side effects;
- allowed callers;
- forbidden dependencies;
- lifecycle and cleanup;
- regression test.

Use frozen facades or cloned snapshots. Never return a mutable internal array,
AudioNode, DOM collection, IndexedDB transaction or private timer handle.

Event contracts are notifications, not hidden command channels. Add an event
only when an existing event cannot express the fact. Define its payload,
producer, consumers and unsubscribe behavior in EVENT_CONTRACTS.md and add a
contract test.

### 0A.4 State and data modification covenant

For every new state field:

1. declare its canonical owner in STATE_OWNERSHIP.md;
2. decide whether it is serializable;
3. decide whether it belongs in Store, a service runtime or IndexedDB;
4. preserve old records and old keys;
5. define default behavior for old/missing records;
6. add a read/write test;
7. update CURRENT_STATE.md if it changes runtime behavior.

Do not use display metadata as stable identity. Do not rewrite history because
the title, artist, album or genre changed. Do not make a schema migration just
to fix a rendering issue.

### 0A.5 Soft Scroll Edge implementation recipe

The current SSE implementation is a shell/viewport contract:

1. Add the new scroll surface to the central selector list in Shared Controls.
2. Choose an existing shared shell (side-panel, library-panel, history pane)
   or explicitly mark an owned shell. Do not create a floating duplicate panel.
3. Keep panel background, border, radius, shadow and isolation on the shell.
4. Keep scroll, moving rows and content padding on the transparent viewport.
5. Use scrollTop/clientHeight/scrollHeight to derive top and bottom clipping.
6. Schedule endpoint updates with requestAnimationFrame after scroll, resize,
   mutation and view changes.
7. Remove the top mask at the top, bottom mask at the bottom, and show both
   only in the middle.
8. Let the mask fade into the shell's existing surface. Never use hard-coded
   white/black, guessed sampled colors, a second blur rectangle, or a fade
   wider than the shell.
9. Validate top, short content, middle, bottom, resize and 100%/110% zoom.
10. If the effect requires moving the whole sector, move the viewport only;
    the shell must remain geometrically fixed.

The contract identifiers are gp-sse, data-gp-sse, gp-sse-shell,
gp-sse-viewport, gp-has-top and gp-has-bottom. The owner is
src/ui/shared-controls.js plus the existing app.css shell/viewport rules.

### 0A.6 Motion and audio recipes

Before adding an animation, write down its trigger, hover delay, duration,
easing, start/intermediate/end geometry, cancellation/re-entry behavior,
reduced-motion behavior, 60/90/120 Hz behavior, and cleanup. Use
CSS/Web Animations/requestAnimationFrame with elapsed-time interpolation.
Never use a fixed frame count or setInterval as a visual frame scheduler.

Before an audio change, draw the current signal path, identify every gain and
connection, record headroom, describe play/pause/seek/crossfade behavior and
prove that no second context, node or bus is created. A fix is incomplete
until duplicate connections, parameter jumps, old-bus leaks, NaN gain and
output peak behavior are checked.

### 0A.7 Import, version and completion recipes

Import progress represents completed stages: discovery/de-duplication,
metadata/cover, cache restoration, missing analysis, history identity,
neural refresh and final UI commit. It must not finish early and must not
re-decode cached tracks on every render.

For any user-visible release, update index title/cache-buster, bootstrap
facade, settings card, current-version button, both language release data and
the generated build. Bug-only releases default to HOTFIX BUILD. New feature
names require user-provided or user-approved naming. Unimplemented ideas stay
in Unreleased.

### 0A.8 Definition of done

A change is complete only when owner/dependencies are documented, protected
data is preserved, the source change is surgical, duplicate listeners or
connections are ruled out, build/architecture/contracts pass, targeted
regression checks pass, and actual Edge/audio/4K verification is reported
separately from static verification.

## 0. 一句话摘要

Glass Player 是一个 **Edge / Chromium 中直接通过 `file://` 运行的本地私人音乐播放器**。它已经从单个巨大 HTML 演进为 `index.html + app.css + 55 个有固定拼接顺序的 JavaScript 源文件 + build/app.js`，但仍然不是 npm、ES Modules、Electron 或服务器项目。

最重要的原则：**继续维护当前唯一运行时，不要重写，不要建立第二套状态/音频图/队列/数据库，不要破坏任何 IndexedDB、localStorage、听歌历史、Spectrum ID、MFCC、BPM、Energy、用户模型或推荐数据。**

---

## 1. 当前真实状态

### 1.1 产品身份

| 项目 | 当前值 |
|---|---|
| Generation | Gen 7 |
| Release | 7.1.1 |
| Release name | STABILITY UPDATE |
| Architecture | Peregrine Lake |
| GP Core | 4.1 |
| GP Fusion Engine | 3.0 |
| GP Motion Engine | 4.0 |
| GP Spatial Engine | 1.1 |
| GP Spectrum Engine | 2.2 |
| GP Spectrum ID | 1.0 |
| GP Neural Engine | 2.1 — Resonance Boost |
| Motion target | refresh-driven, nominal ceiling 120 Hz |

权威运行时身份位于：

- `src/bootstrap/main.js` 的只读 `window.GP` facade。
- `src/engines/spectrum-analyzer.js` 的运行时 metadata。
- `index.html` 的标题、CSS/JS cache revision、设置版本卡和当前版本按钮。
- `src/data/releases.js` 的当前版本、导出文件名和完整中英文更新日志。

### 1.2 当前入口

`index.html` 同步加载：

```html
<link rel="stylesheet" href="./app.css?v=7.1.1-r1">
<script src="./build/app.js?v=7.1.1-r1"></script>
```

没有 `type="module"`、`defer`、`async`、npm、Bundler 或开发服务器要求。用户通常直接双击 `index.html`，在 Edge 的 `file://` 环境运行。

### 1.3 当前验证 checkpoint

最后一次已验证构建（2026-08-03 后的 7.1.1 最新源码）：

```text
build/app.js SHA-256:
BB7AD8BD863D05BF1355189F529402F968A4DFF674BC165BB4672A51F87471B5
```

注意：任何后续源码变化都会合理改变此 hash；它不是永远固定的验收值。

最近一次执行：

- `build.ps1`：PASS
- `tests/contract-tests.ps1`：PASS
- 测试脚本实际包含约 **181 条 `Expect`**。
- 脚本末尾仍打印 `Contracts checked: 132`；这是陈旧的硬编码显示，不代表真实检查数量。

---

## 2. 文件权威顺序：绝对不要搞反

从高到低：

1. **`src/**`**：当前 JavaScript 源码权威。
2. **`SOURCE_ORDER.txt`**：唯一执行/拼接顺序权威。
3. **`index.html` + `app.css`**：当前 DOM 与 CSS 权威。
4. **`build/app.js`**：由 `build.ps1` 生成的实际运行文件；不要直接修改。
5. **`src/data/releases.js`**：内置完整产品历史与 Unreleased 路线图权威。
6. 根目录架构文档：可用于理解设计，但部分停留在 6.4.4，必须对照当前源码复核。
7. **根目录 `app.js`**：6.3.0/6.3.1 阶段保留的旧单文件 JavaScript 基线；当前 `index.html` 不加载它，禁止把新改动写进这里。
8. **`original/Glass Player 6.2.2.html`**：不可修改的历史基准，不是当前开发入口。

### 2.1 不要做的事情

- 不要编辑 `build/app.js` 后忘记同步 `src`。
- 不要以根目录 `app.js` 作为现有源码。
- 不要从 `original/Glass Player 6.2.2.html` 重新拆分或覆盖当前项目。
- 不要改变 `SOURCE_ORDER.txt`，除非确实新增/迁移了一个正式模块且验证了声明顺序依赖。
- 不要创建平行的 `GlassPlayer-new`、`backup.html`、`fixed-final-v2` 等垃圾副本。
- 不要顺手格式化 55 个源文件或合并重复 CSS；后出现的覆盖规则可能是有意行为。

---

## 3. 项目结构

```text
GlassPlayer-dev/
├─ index.html                  # 当前 DOM / 唯一页面入口
├─ app.css                     # 当前完整样式
├─ app.js                      # 旧阶段基线，不加载、不继续编辑
├─ SOURCE_ORDER.txt            # 55 个源码的唯一拼接顺序
├─ build.ps1                   # 拼接 src -> build/app.js
├─ validate-architecture.ps1   # 架构/治理静态检查
├─ build/
│  └─ app.js                   # 当前运行时生成物
├─ original/
│  └─ Glass Player 6.2.2.html  # 不可修改历史基准
├─ tests/
│  └─ contract-tests.ps1       # 当前静态产品契约
├─ src/
│  ├─ core/                    # registry, contracts, event bus, store, actions, selectors, context
│  ├─ adapters/browser/        # IndexedDB/localStorage, files, media session, PiP, clock
│  ├─ engines/                 # audio, recognition, spectrum, EQ, spatial, motion
│  ├─ services/                # playback, queue, library, history, neural, settings, PiP
│  ├─ data/                    # releases, i18n, EQ presets, spatial presets, genre graph
│  ├─ ui/                      # player/library/settings/sound/changelog/PiP/shared UI
│  └─ bootstrap/main.js        # 初始化唯一 App Context 与公开 facade
└─ *.md                        # 架构与历史报告；部分 checkpoint 已陈旧
```

### 3.1 55 文件执行顺序

不要凭文件夹顺序猜。完整顺序只读 `SOURCE_ORDER.txt`。宏观顺序是：

```text
Module registry
→ legacy runtime/audio/constants/storage/recognition/spectrum
→ Core contracts/store/context
→ browser adapters/ports
→ data + legacy UI/runtime implementations
→ formal engine/service/view factories
→ bootstrap/main.js
```

这是一个**普通脚本拼接运行时**：文件间仍共享同一个外层作用域，声明先后非常敏感。

---

## 4. 构建、检查与交付流程

### 4.1 每次源码修改后的最低验证

在 `GlassPlayer-dev` 根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\validate-architecture.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\tests\contract-tests.ps1
```

如果 PATH 中有 Node，再运行：

```powershell
node --check .\build\app.js
```

### 4.2 正确交付标准

- `build.ps1` 成功并给出新 SHA-256。
- architecture validation 为 PASS。
- contract tests 为 PASS。
- 没有新增 console parse error。
- 所有版本号/名称需要统一时已经同步。
- 明确区分：静态验证已完成；真实 Edge + 本地音乐 + PiP + 音频设备测试是否完成。

### 4.3 浏览器验证边界

此前 Codex 控制浏览器会阻止自动导航到本地 `file://` URL。因此很多交付只能确认：

- 构建
- 语法
- 静态契约
- 架构治理

不能把这些说成“已经在 Edge 中完整视觉验证”。真实媒体回归需要用户在 Edge 直接打开 `index.html`，使用其本地音乐文件测试。

---

## 5. 架构不变量

### 5.1 唯一运行时原则

必须始终只有：

- 一个 playlist runtime array。
- 一个 manual play queue。
- 一条 shuffle timeline + cursor。
- 一套 Deck A/B 与 Crossfade。
- 一个 AudioContext 生命周期。
- 一套 EQ 图。
- 一套 Spatial A/B Bus。
- 一套 IndexedDB adapter。
- 一套 behaviorEvents / userModel / recommendations。
- 一个 PiP 生命周期。
- 一个 App Store + Event Bus + App Context。

严禁为了修一个 bug 再创建第二个队列、第二个 AudioContext、第二个推荐模型或第二套 DOM 状态。

### 5.2 允许依赖方向

```text
Core
→ Browser Adapters + Engines + Data
→ Services
→ UI Views
→ Bootstrap
```

禁止：

- UI 直接持有/创建 AudioNode 或 IndexedDB transaction。
- Engine 操纵 View DOM。
- Adapter 依赖 UI。
- Core 反向依赖具体 Service。
- Service 创建第二套 UI 状态。

### 5.3 Store 只存可序列化状态

App Store 当前包括：

```text
library: tracks, currentTrackId, sortMode, importStatus
playback: status, wantsPlayback, position, duration, volume, mode,
          crossfadeEnabled, crossfadeSeconds
queue: items, manualActive, playingQueuedTrack, resumeTrackId,
       shuffleTimeline, shuffleCursor
settings: language, theme, backgroundMode, coverMode, adaptiveColor,
          spatialEnabled, spatialMode, loudnessNormalizationEnabled, eqPreset
analysis: activeTrackId, pending, completed, failed
ui: activeView, activePanel, historyMode
```

禁止把这些放入 Store：AudioContext、AudioNode、AudioBuffer、HTMLMediaElement、Canvas context、DOM、File、Object URL、timer、observer、IDB transaction、函数。

---

## 6. 数据与用户信息：最高优先级保护区

用户曾多次明确强调：**绝对不能删除听歌记录、算法得到的用户信息、歌曲缓存或重新分析所有歌曲。**

### 6.1 IndexedDB

数据库默认：

```text
name: glass-player-gen4
version: 5
```

Object stores：

| Store | Key | 重要内容 |
|---|---|---|
| `trackFeatures` | `contentKey` | MFCC、BPM、Energy、Loudness、分析版本等 |
| `behaviorEvents` | auto-increment `id` | skip、complete、replay、seek、选择、搜索、queue 等行为 |
| `userModel` | `id` | 长期偏好、时间偏好、置信度、证据量 |
| `recommendations` | `id` | Daily Mix 等缓存推荐 |
| `trackCache` | `contentKey` | metadata、封面/缩略图相关信息、Spectrum ID 与识别锚点 |

`trackCache` 关键 indexes：

```text
cachedAt
fileName
fileSize
fileIdentity
audioEssenceKey
spectrumId
recognition.anchorHead
recognition.anchorMiddle
recognition.anchorTail
recognition.flacPcmMd5
```

除非用户明确要求并接受迁移方案，否则不要修改：

- database name
- DB version
- store 名称
- keyPath
- index 名称/路径
- schema version 常量
- Spectrum ID 生成规则

### 6.2 localStorage

当前正式 keys：

```text
glassPlayerHistory
glassPlayerPrefs
glassPlayerSidebarCollapsed
```

不得静默改名或清空。设置迁移必须向后兼容。

### 6.3 重要现实边界

**浏览器 IndexedDB/localStorage 不在 GP 项目文件夹里。** 仅给新 Project 授权 `GlassPlayer-dev` 文件夹，不等于给 AI 读取用户 Edge profile 中的实际听歌历史、用户模型或缓存数据。不要假装已经检查这些真实数据。

同样，本地 Music 文件夹如果没有单独授权，新 AI 也看不到真实歌曲文件。

---

## 7. Spectrum ID、识别与缓存

### 7.1 目标

用户可能修改：

- 文件名
- Title
- Artist（例如 `Eason Chan` → `陈奕迅`）
- Genre
- Album 等表面 metadata

Spectrum ID 的职责是尽量通过不会因上述改名而变化的音频特征继续识别同一音频，使：

- 旧分析缓存可复用。
- 听歌历史能关联新 metadata。
- MFCC/BPM/Energy/Loudness 不必重新分析。
- Favorite Artist / Genre / 时间偏好未来仍能归一。

### 7.2 当前实现

`src/services/library-runtime.js`：

- 读取音频技术签名。
- FLAC 可利用 PCM MD5。
- 对文件头/中/尾建立 anchor。
- 组合生成 `gpsid:v1:<sha256>` Spectrum ID。
- 按 exact Spectrum ID、audio essence、稳定 anchors、legacy file identity 等路径匹配旧记录。
- 匹配后保留 `legacyContentKeys` 和 identity links。
- Metadata 重扫不会删除 Spectrum ID / MFCC / Energy / BPM / listening history。

关键版本：

```text
GP_FEATURE_SCHEMA_VERSION = 4
GP_TRACK_CACHE_SCHEMA_VERSION = 7
GP_RECOGNITION_SCHEMA_VERSION = 2
GP_SPECTRUM_ALGORITHM_VERSION = 2.1.0
```

不要因为 Title/Artist/Genre 改名就生成全新独立用户历史。

---

## 8. 音频系统

### 8.1 核心能力

- 本地音频播放。
- Deck A/B。
- Crossfade（当前 UI 范围 0.5–3.0s）。
- EQ + Custom EQ 记忆。
- Loudness normalization。
- Spatial Engine。
- 最终输出保护与诊断。
- 播放进度、音量、速度、模式控制。

### 8.2 Audio Graph 原则

历史上 Poly Sync 40 出现过鼓点/低频爆音，而耳机可能正常。后续修复必须坚持：

- 先定位首次超限节点，不要只塞一个重 Limiter。
- EQ 正增益要有 preamp compensation。
- Loudness 只能平滑调整固定增益，禁止 NaN、瞬跳和无限补偿。
- Spatial Dry/Wet、A/B Bus、Reflection、Reverb 不能重复连接。
- 旧 Spatial Bus 完成切换后必须断开。
- Seek、暂停、切歌、断开节点需要短 fade，防止波形不连续。
- Final output 保留约 -1 至 -1.5 dBFS 安全空间。
- 不通过永久大幅降低总音量掩盖上游错误。
- 不改变 FLAC 文件本身；Web Audio 解码后的 DSP 路径不等于修改码率。

### 8.3 Spatial Engine 1.1

UI 使用右上角总开关；关闭即真实 Dry bypass。当前 presets：

```text
Orbit
Desktop Speakers
Studio Monitors
Wide Stage
Front Binaural
Live Hall
Cinema
Dreamscape
```

内部仍保留 `none` 数据 preset 供 bypass，但 UI 不显示 “None” 选项。

除 Orbit 是用户明确要求的固定速率 3D 环绕外，其余 preset 应保持固定、可预测：播放过程禁止根据 RMS、Genre、BPM、MFCC、歌曲段落动态改变 Width/Reverb/HRTF。

模式切换使用约 400ms equal-power A/B crossfade；正常播放期间只保留一套有效 Spatial bus。

### 8.4 EQ

EQ 分为：

- Sound presets
- Device presets
- Manual / Custom

已有设备方向包括 QC35、QC Earbuds、Poly Sync 40、显示器/桌面音响、ZHAN G1 · B&O 等。EQ 曲线 UI 是平滑曲线，不允许点位/格子随缩放变形；preset 切换时各 frequency 点应连续移动，不可硬跳。

---

## 9. 播放、Queue 与 Shuffle

### 9.1 播放模式

```text
Sequential
Shuffle
Repeat One
```

### 9.2 手动 Queue

- 默认 Queue 展示固定歌单顺序并自动定位当前歌曲。
- 当前歌曲应位于顶部 SSE 以下第二个完整可见行，而不是被遮住。
- 用户手动“下一首播放”或加入 Queue 后，进入 manual Queue priority。
- manual Queue 有歌时，优先从上到下播放；结束后恢复进入 Queue 前的播放逻辑。
- Daily Mix 点击 Play 会整体加入 manual Queue，并继承 manual Queue 的功能。
- Queue 可拖拽；Shuffle 模式隐藏编号/拖拽控件，切回其他模式恢复。
- Queue 结束需要 notification。

### 9.3 Shuffle timeline

- Shuffle 只在“下一首”时生成新随机结果。
- 保留最近约 20 个历史节点，上一首能沿 timeline 返回，不能重新随机出另一首。
- 模型未成熟前必须是真正 uniform random；Neural 不允许提前干预。

### 9.4 当前键盘控制

最新决定：

```text
Space / F10 → Play / Pause
F9          → 不检测
F11         → 不检测
方向键/WASD/数字小键盘 → 不控制上一首/下一首
```

播放器按钮与 Media Session 的 Previous / Play / Pause / Next 仍保留。

实现位置：`src/services/pip-runtime.js`。

---

## 10. Listening History

### 10.1 统计原则

- 实际播放进度累计达到歌曲时长 75% 可记为一次 complete/play count，即使中间 Seek 过。
- 小于 75% 的离开按动态 skip penalty 处理。
- History 时间不能在 Pause、Seek、后台错误状态下虚增。
- 今天/本周/本月/本年/全部必须各自显示对应 calendar range 的次数与时长。
- “上周/上月/去年”是实际 calendar 边界，不是滚动 7/30/365 天。

### 10.2 五个时段

```text
Late Night / 深夜      22:00–04:59
Early Morning / 清晨  05:00–09:59
Midday / 午间          10:00–14:59
Afternoon / 下午       15:00–17:59
Evening / 晚间         18:00–21:59
```

History 和 Neural 使用同一分段逻辑。

### 10.3 历史身份同步

`src/services/history-service.js` 会尝试通过 Spectrum ID、audio essence、legacy content keys、artist/title aliases 合并改名前后的记录。不要重新引入“按当前显示标题直接作为唯一身份”的脆弱逻辑。

旧到无法映射的历史可能仍不可恢复；不要凭空伪造封面、时长或播放次数。

---

## 11. GP Neural Engine 2.1 — Resonance Boost

### 11.1 用户偏好与推荐必须分离

```text
Audio Features
(Spectrum ID / MFCC / BPM / Energy / Genre)
          +
Behavior Events
          +
Time Context
          ↓
Long-term User Preference Model
          +
Session Preference / Exploration / Freshness / Diversity
          ↓
Recommendation Score
          ↓
Daily Mix / mature Smart Shuffle
```

喜欢某艺人 0.95 不等于每次都推荐该艺人。

### 11.2 当前成熟门槛

```text
minimum effective events: 20
minimum active days: 5
minimum confidence: 0.70
half-life: 45 days
event retention window: 270 days
maximum model input: recent 12,000 events
```

模型未成熟：Shuffle 使用 uniform random。不要改变。

### 11.3 当前行为权重

| Behavior | 基础信号 |
|---|---:|
| Search select | +2.8 |
| Queue add | +2.6 |
| Replay | +2.5 |
| Manual select | +2.4 |
| Complete | +1.35 |
| Listen duration | 最多 +0.65 |
| Skip <8% | -2.6 |
| Skip <25% | -1.65 |
| Skip <55% | -0.8 |
| Skip <90% | -0.2 |
| Skip ≥90% | 0 |

探索反馈不会因一两首歌立刻改变长期偏好：来自 Shuffle/Recommendation 的早期接受和跳过会降权，需要连续证据。

### 11.4 Daily Mix

- 使用 Spectrum ID、MFCC、Genre、BPM、Energy。
- Genre + MFCC 是主相似度。
- 已知跨 Genre 只有在 MFCC 异常相似时才允许强跨簇。
- 兼顾 preference、freshness、diversity、recent history。
- 导入完成流程会自动生成。
- 生成记录写入 `recommendations` store。
- 重复推荐有 recent-set 防护，不能短时间反复推同一首。

### 11.5 离线 Genre graph

`src/data/genre-relations.js` 是静态离线关系库：

- 不在播放器运行时联网。
- 已知 Genre 使用固定关系图。
- 未知标签通过本地名称/别名相似度映射到最近类别。
- 推荐与 Shuffle 可通过相关 Genre 得到软相似度，而不是只做完全相等。

如果更新关系库，可以在开发阶段上网查资料，但最终数据必须随播放器离线交付。

---

## 12. 导入与性能

### 12.1 导入阶段职责

用户要求导入弹窗在退出前完成所有必要初始化：

- metadata
- cover / thumbnail
- Spectrum ID / cache matching
- cached MFCC/BPM/Energy/Loudness 恢复
- 必要的新分析排队或执行
- history identity reconciliation
- user model refresh
- Daily Mix generation
- UI list readiness

进度条不能先到终点、再在主界面继续卡住数秒。

### 12.2 缓存原则

- 同一音频只做一次昂贵分析。
- 成功结果写 IndexedDB。
- 重启或重新导入命中缓存时，不重新 decode/analyze。
- 本地歌曲信息“只加不减”指保留已有有效缓存，不因歌曲暂时没导入就删除。
- Rescan metadata 不应丢弃 Spectrum/MFCC/BPM/Energy/Loudness/history。

### 12.3 性能原则

- 主要目标：4K 下保持清晰和顺滑。
- 动画由 CSS / Web Animations / `requestAnimationFrame` 驱动；禁止固定 60Hz 帧计数和视觉 `setInterval`。
- 不要通过硬控鼠标、主线程长任务或降到 3fps 来“优化”。
- 背景当前保持静态，不恢复过去的动态 color blob / blurred-cover 漂移。
- 导入/Resonance 分批并主动让出渲染帧。
- MFCC/BPM/Energy 分析不要阻塞正在播放的音频。
- 不应为 120Hz 强制制造 120 次无意义计算；按时间插值、浏览器按显示器刷新节奏调用即可。

---

## 13. UI / Motion / Glass 公约

### 13.1 全局设计语言

- Glass / Acrylic + 轻拟物 + 平扁视觉。
- 圆角、Accent、阴影、边界必须自适应深浅主题和封面背景。
- UI 需要适配 Edge 100%/110% 缩放、窗口化、全屏、4K。
- 不允许歌词/长标题撑宽 Sector。
- 长标题只有确实溢出才滚动；完整显示时不能乱滚。
- 深色模式不能因为“增加对比”而所有 Sector 泛白。
- 浅色标题必须直接依据标题背后的实际背景判断黑/白可读色。

### 13.2 Motion 4.0

- 所有动效基于 elapsed time，原生支持 60/90/120Hz。
- 不以 frame count 控制动画。
- 页面/sector 切换使用共享 fade lifecycle。
- 最终 settle 帧不能出现突然位移、回抽、闪白或旧背景露出。
- 相同控件必须调用共享 class/底层逻辑，不要每个页面手搓一套。
- Hover 触发图标动画通常等待约 300ms；侧边栏 GP brand hint 当前为 550ms。
- 预选中的 Hover 大块遮罩已取消；图标 hover 动效仍保留。

### 13.3 Sidebar

- 可展开/收窄。
- 收窄后只显示图标与 GP logo。
- 不再 hover 整个侧栏自动展开；点击控制展开。
- 文字 fade 与边界收回必须同步，不得先跳位。
- 导航选中滑块没有光晕，移动时允许轻微缩放/拉长，但不能抽搐。
- Music Galaxy 位于 Settings 上方。

### 13.4 SSE（Soft Scroll Edge）

SSE 不是盖在内容上的白/黑雾条。当前底层逻辑：

- 固定外壳拥有真实背景和边框。
- 内部 viewport 负责滚动。
- 边缘通过 mask 让内容融入外壳。
- 只在对应方向还有内容时显示 top/bottom fade。
- 不能比 Sector 更宽、不能悬浮留缝、不能变成黑条/白条。

实现中心：`src/ui/shared-controls.js` + `app.css` 的 `gp-sse-*`。

### 13.5 Liquid scrollbar

- 使用 theme/accent 派生颜色。
- 滚动或 pointer over 时显示。
- 停止后 **500ms** fade out。
- 首帧不能先黑再变 Accent。

### 13.6 Popover material

Snooze 是共享弹窗材质的视觉基准：

```text
--gp-popover-surface
--gp-popover-blur
--gp-popover-shadow
```

Sort、Font、EQ preset、speed 等弹窗都应走同一底层，不要单独做发白、全不透明或像“水洒在纸上”的效果。任何时候最多只留一个情境弹窗；滚动弹窗外页面时应收回。

### 13.7 Range / horizontal bars

- 轨道实心、圆角。
- 已完成区域使用 Accent/高对比颜色。
- Hover 平滑略微加粗，不能一帧跳粗。
- 点击必须准确到鼠标位置。
- 拖动必须跟手；松开后动画不能停止在半路。
- 选中 thumb 使用轻量半透明玻璃，不是实心黑块。

---

## 14. 更新日志系统

### 14.1 数据与显示

- 数据源：`src/data/releases.js`。
- 支持中英文完整日志与 TXT 导出。
- UI 层级：`Gen x → x.y → x.y.z`。
- 历史上有合并显示逻辑；显示版本号必须仍然是合法 `x.y.z`，不能把 `6.0.1–6.0.7` 当成一个版本号标签。
- 不要随意重排历史；3.3.1/3.3.2 顺序曾被修复。
- `4.0.0 Beta` 已正式显示为 `4.0.0`。
- `Pre-release Update` 已删除。

### 14.2 当前 Changelog glider 契约

实现：`src/ui/changelog-view.js` + `src/data/releases.js` + `app.css`。

- 首次进入更新日志，默认 7.1.1 使用玻璃 glider，不显示普通实色 active 遮罩。
- 首次出现 fade in。
- 点击另一个 `x.x.x`，glider 移动并轻微放大。
- 展开/关闭其他层级导致目标按钮位移时，glider 用 `requestAnimationFrame` 实时跟随。
- 如果关闭包含当前选中版本的父级，glider fade out 并清除叶子选中。
- 重新展开父级不会无缘无故让旧 glider 自己出现；点击叶子版本才恢复。
- 页面隐藏阶段不能因为 `offsetParent === null` 就永久关闭默认 glider；等 View 真正显示后再测量。

### 14.3 当前 Changelog 对比度修复

`releaseIndex` 与 `releaseDetail` 都是 SSE owned surface：

- `var(--gp-sector-surface)` 只绘制在 `.gp-sse-shell-releaseIndex` / `.gp-sse-shell-releaseDetail`。
- 内部 `.release-index` / `.release-detail` 必须透明。
- 不允许 shell 与 viewport 同时上色，否则进入更新日志时对比度会比其他页面多叠一层。

---

## 15. 主题、背景、语言与字体

### 15.1 Theme

- Light / Dark / Auto。
- Auto：05:00–18:00 Light；18:00–05:00 Dark。
- 每个 Accent hue 需要独立的 Light/Dark 派生亮度，不能把上一个主题已经处理过的 Accent 再处理一遍。
- Adaptive Accent 来自当前封面 + 当前背景，避免过亮、过暗、过艳或与背景太相似。
- Light→Dark→Light 必须可逆，不得需要重启 HTML。

### 15.2 Background modes

当前支持大致三类：Glow / Cover Color / Blurred Cover。背景保持静态；歌曲切换时新旧背景 cross-blend，不能先闪白/灰再显示新背景。

唱片模式切歌时，唱片本体几何/旋转状态不应先回正；封面内容 fade 替换。

### 15.3 Language

- 中文/English。
- `src/data/i18n.js` + 动态 render 均需同步。
- 中文模式不允许混入 `Crossfade`、英文 empty-state、英文错误提示等。
- 新文案需要检查静态 DOM、toast、popover、changelog、动态模板和导出文本。

### 15.4 Fonts

当前精选包括：

- Apple 系统字体（SF Pro fallback）
- Microsoft 系统字体（Segoe UI Variable / Segoe UI）
- Mi Sans
- Cascadia Code
- Trebuchet MS
- Quicksand
- New York / serif fallback

字体大小与粗细连续调整；缩放时避免毛刺/重影。不要随意恢复已删除的微软雅黑、黑体、宋体、仿宋列表。

---

## 16. PiP

当前使用传统 video Picture-in-Picture，不使用 Document PiP：

- Document PiP 在 `file://` / Edge 中会显示不可隐藏的浏览器地址栏，用户明确否决。
- Traditional PiP 通过 Canvas/Video carrier 绘制静态封面、歌名、艺人和核心播放控制。
- PiP 应同步主题、字体、粗细、背景模式和播放状态。
- 小窗 resize 不能自发膨胀、右边界抽搐或把封面画糊。
- 不要恢复封面中心的装饰点。

---

## 17. 当前主要页面

```text
Player
Library / 歌曲库
Listening History
Music Galaxy
Settings
Changelog（从 Settings 版本卡进入）
```

Player 右侧面板：

```text
Queue
Sound
Daily Mix
```

Music Galaxy 当前只有“敬请期待 / Coming Soon”预告，没有 Canvas/WebGL 星图实现，也不应启动额外分析负荷。

---

## 18. Unreleased / 路线图

以当前 `src/data/releases.js` 的 `Unreleased` 为权威，不要只看历史版本里的旧计划。

当前方向：

- Music Galaxy：MFCC/BPM/Genre 距离 → 2D 坐标 → 星系/风格聚类 → 低成本 hover。
- Galaxy-aware Recommendation：利用缓存特征进一步改善 Shuffle/Daily Mix，同时保留 freshness、diversity、randomness。
- Electron Lake / SQLite / EXE：推迟到 Gen 9+。

重要：Music Time Machine / Timeline 曾在历史日志中规划，但后来明确从当前 Unreleased 移除。不要因为旧 5.4.1 历史记录而自动重新加入。

---

## 19. 用户协作偏好

### 19.1 工作方式

- 先检查真实文件/当前界面，不要靠猜。
- 大任务使用 step method：拆步骤、每步有验证目标。
- 先定位根因再改；用户非常反感“覆盖一层 CSS 假装修好”。
- 改动必须 surgical；不要碰用户没要求的正确功能。
- 用户可能在测试中连续追加反馈；把新反馈视为当前版本的继续修复，除非明确发布新版本。
- 不要把验证拖得很久；优先高价值静态/针对性测试。
- 交付时说清楚做了什么、验证到哪一层。

### 19.2 版本命名规则

- 修 bug：默认 release badge/name 使用 **HOTFIX BUILD**（除非用户指定其他名称）。
- 新功能：如果用户没有给名字，要先问更新名；不要擅自乱取。
- patch：小改 `+0.0.1`。
- feature/minor：例如 `x.y.z → x.(y+1).0`。
- generation/major：`x.x.x → (x+1).0.0`。
- 用户指定版本号时严格使用其指定值。
- 每次升级版本必须同步所有当前版本展示与导出名称，不只改一个标题。

### 19.3 版本升级同步清单

至少搜索：

```powershell
rg -n '7\.1\.1|STABILITY UPDATE|GP Core|GP Fusion|GP Motion|GP Spectrum|GP Neural' index.html app.css src tests
```

核对：

- `<title>`
- CSS/JS cache query
- Settings build card
- Current Version button
- `window.GP.version`
- analyzer runtime version
- engine versions（仅当确实升级）
- current release entry
- Chinese + English summary/detail
- TXT export header/file name
- contract tests

### 19.4 视觉偏好

- 用户追求 Apple/iOS 风格的高质量微交互，但不接受明显模仿导致的白雾、黑条、抽搐或 GPU 爆炸。
- 动画必须平滑、原路返回、最终 settle 精准。
- “微微”就是克制，不是夸张拉伸/发光。
- 光晕总体应轻；竖向侧边栏 glider 不要光晕。
- 4K 清晰度优先，不允许用明显糊化换性能。

---

## 20. 已知风险与经常回归的区域

以下不是全部“当前仍存在的 bug”，而是历史上最容易被相邻修改重新弄坏的区域：

1. **首次导入/导入完成卡顿**：metadata、cover、Spectrum、Neural、Daily Mix 的调度。
2. **切歌音爆**：EQ/Loudness/Spatial/headroom/旧 bus/参数瞬跳。
3. **4K 背景摩尔纹**：背景图层亚像素缩放、转场合成、低刷新率采样。
4. **Queue 自动定位**：首次播放、Pause/Play、切歌、离开/返回 Queue、短距离滚动。
5. **页面 settle 抽搐**：退出/间隔/进入动画结束时重复布局。
6. **Popover 材质漂移**：EQ/Font/Sort/Speed 与 Snooze 不一致。
7. **主题往返 Accent 漂移**：对已经派生过的颜色重复计算。
8. **Listening History identity**：改名后灰封面/旧名/重复历史。
9. **Changelog glider**：隐藏 View 首次测量、层级 reflow、父级关闭。
10. **Sidebar 收窄**：图标横跳、文字 fade 不同步、hover hint 飞行。
11. **横向 range**：点击偏差、拖动不跟手、mouseup 中断动画。
12. **本地化**：中文模式漏出英文动态文案。

每次改其中一个，都要回归相关交互，不要只检查静态截图。

---

## 21. 当前文档漂移

这些文件有价值，但标题/数字可能停在旧 checkpoint：

- `ARCHITECTURE_REPORT.md`：主要停在 6.4.4 / Core 4.0。
- `BUILD_REPORT.md`：包含 6.3.1 历史阶段和 6.4.4 checkpoint。
- `CONTRACT_TEST_REPORT.md`：写 32 checks，已落后于当前测试。
- `REGRESSION_REPORT.md`：6.4.4 checkpoint。
- `STORE_SCHEMA.md` / `STATE_OWNERSHIP.md`：结构仍有参考价值，但标题是 6.4.4。
- `tests/contract-tests.ps1`：实际约 181 个 `Expect`，输出字符串仍写 132。

处理原则：

- 当前行为以源码/测试为准。
- 不要为了“整理文档”顺手大改代码。
- 如果用户要求文档同步，再单独更新报告。

---

## 22. 编码与 PowerShell 注意事项

- 文件为 UTF-8，但 Windows PowerShell `Get-Content` 在部分环境会把中文显示成 mojibake。
- 不要因为终端显示乱码就重写整个文件编码。
- 优先用 `rg -n -F` 查看准确行，或显式使用 .NET UTF-8 读取。
- patch 失败时先用 `rg` 找当前精确文本，再做窄 patch。
- PowerShell execution policy 阻止脚本时使用：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File <script.ps1>
```

---

## 23. Git / 回滚现实

当前 `GlassPlayer-dev` 所在目录不是一个可用 Git repository（`git status` / `git rev-parse` 返回 not a git repository）。

因此：

- 不要假装可以 `git diff` 或 `git checkout` 回滚。
- 不要创建大量手工备份污染目录。
- 修改必须小、可审计，使用精确 patch。
- `original/Glass Player 6.2.2.html` 只是历史基准，不能用于回滚现代版本。
- 如果新 Project 自带版本控制，应先确认它的真实根目录和当前 branch，再使用 Git。

---

## 24. 给下一个 AI 的启动步骤

第一次接手时，按此顺序：

1. 阅读本文件。
2. 阅读 `SOURCE_ORDER.txt`。
3. 阅读用户当前请求涉及的 1–3 个真实源文件。
4. 查看 `tests/contract-tests.ps1` 中对应契约。
5. 明确假设、最小改动范围和成功标准。
6. 只改 `src/**` / `index.html` / `app.css` 中必要部分。
7. 如果改当前行为，同步 `src/data/releases.js` 的 7.1.1 日志；如果用户指定新版本，则做完整版本升级同步。
8. 运行 build + architecture + contracts。
9. 如能在真实 Edge 中测试，再做交互/音频/4K 验证；不能则明确说明。
10. 交付一个可点击的 `index.html` 路径，不要输出额外副本。

---

## 25. 最近一轮实际改动（最容易被遗漏）

截至交接：

1. Changelog `x.x.x` 叶子版本恢复玻璃 glider。
2. 首次进入默认 7.1.1 也使用玻璃 glider并 fade in。
3. 其他层级展开/收回时，glider 每帧跟随目标位置。
4. 关闭包含选中版本的父级时，glider fade out。
5. Changelog 的 SSE shell 只绘制一层 `--gp-sector-surface`，内部 viewport 透明，避免对比度叠加。
6. Liquid scrollbar 停止后 500ms fade out。
7. F9/F11 网页检测已取消。
8. Space/F10 Play/Pause 和 Media Session 保留。
9. 上述行为已经加入当前中英文 Changelog 与 contract tests。

对应文件：

```text
src/ui/changelog-view.js
src/data/releases.js
src/ui/shared-controls.js
src/services/pip-runtime.js
app.css
tests/contract-tests.ps1
```

---

## 26. 最终红线

如果一个修复方案会做下面任何一项，必须停下并重新设计：

- 删除/清空 IndexedDB 或 localStorage。
- 重新分析所有已缓存歌曲而无必要。
- 改 Spectrum ID 导致旧记录失联。
- 创建第二个 AudioContext/Audio Graph/Queue/playlist。
- 修改正确 UI 来掩盖另一个 bug。
- 用固定白/黑覆盖层伪装 SSE/玻璃融合。
- 为“120Hz”写固定 120 次循环。
- 用极低帧率、硬控输入或明显模糊换性能。
- 直接修改 `build/app.js` 或旧 `app.js`。
- 把历史报告中的旧版本当成当前 runtime。
- 声称做过未实际执行的 Edge/音频/4K 测试。

---

## 27. 建议的首条新 Workspace Prompt

可以把下面这段直接发给新 AI：

> 先阅读 `GlassPlayer-dev/AI_WORKSPACE_HANDOFF.md`、`SOURCE_ORDER.txt` 和当前请求涉及的源码。以 `src/** + SOURCE_ORDER.txt + index.html + app.css` 为唯一当前基线；不要编辑 `build/app.js`、根目录旧 `app.js` 或 `original/Glass Player 6.2.2.html`。保留现有 IndexedDB/localStorage、Spectrum ID、MFCC/BPM/Energy、听歌历史、behaviorEvents、userModel、recommendations、Queue、Audio Graph 和 UI。先说明假设与最小计划，再进行 surgical change；完成后运行 build、architecture validation 和 contract tests。不能真实验证 Edge/file:///本地音频时必须明确说明。

---

此 briefing 的目标不是取代源码，而是让新 AI 知道**哪里是真相、什么不能碰、如何验证、用户到底在意什么**。遇到冲突时：当前用户最新指令 > 当前源码行为 > 当前 contract tests > 本文件 > 旧版本报告/历史日志。
