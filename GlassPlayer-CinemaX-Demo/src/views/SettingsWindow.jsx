import React, { useEffect, useRef } from 'react';
import { AudioLines, Folder, Info, Library, Palette, Play } from 'lucide-react';
import { useApp } from '../state.jsx';
import { ACCENTS, EQ_PRESETS, SPATIAL_MODES } from '../data/mock.js';
import { Segmented, Switch } from '../components/ui.jsx';
import { accentValue } from '../utils.js';
import closePng from '../assets/traffic/close.png';
import closeHoverPng from '../assets/traffic/close-hover.png';
import './settings.css';

const SECTIONS = [
  {
    id: 'appearance',
    label: 'Appearance',
    Icon: Palette,
    description: 'Theme, accent color and motion for this demo window.',
  },
  {
    id: 'playback',
    label: 'Playback',
    Icon: Play,
    description: 'How playback moves between tracks and reports time.',
  },
  {
    id: 'audio',
    label: 'Audio',
    Icon: AudioLines,
    description: 'Presets and the fixed signal graph behind every track.',
  },
  {
    id: 'library',
    label: 'Library',
    Icon: Library,
    description: 'How imports are analyzed and cached on this machine.',
  },
  {
    id: 'about',
    label: 'About',
    Icon: Info,
    description: 'Build identity and the architecture this frame represents.',
  },
];

const THEMES = [
  { id: 'dark', label: 'Dark' },
  { id: 'light', label: 'Light' },
];

const PLAYBACK_RATES = [
  { id: 0.75, label: '0.75×' },
  { id: 1, label: '1×' },
  { id: 1.25, label: '1.25×' },
  { id: 1.5, label: '1.5×' },
];

const FOLDERS = [
  { name: 'Lossless', count: 11 },
  { name: 'Music', count: 5 },
];

function FormRow({ label, children, stack = false }) {
  return (
    <div className="set-row">
      <span className="set-row-label">{label}</span>
      <div className={`set-row-control ${stack ? 'is-stacked' : ''}`}>{children}</div>
    </div>
  );
}

function ThemePreview({ theme }) {
  return (
    <span className={`set-theme-preview is-${theme}`} aria-hidden="true">
      <span className="set-mini-sidebar">
        <span className="set-mini-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="set-mini-nav" />
        <span className="set-mini-nav is-short" />
        <span className="set-mini-nav" />
      </span>
      <span className="set-mini-main">
        <span className="set-mini-title" />
        <span className="set-mini-card" />
        <span className="set-mini-row" />
        <span className="set-mini-row is-short" />
      </span>
    </span>
  );
}

export default function SettingsWindow() {
  const { state, actions } = useApp();
  const { prefs } = state;
  const theme = prefs.theme;
  const rootRef = useRef(null);
  const contentRef = useRef(null);
  const section = SECTIONS.find((item) => item.id === state.settingsSection) ?? SECTIONS[0];
  const setPref = (patch) => actions.setPrefs(patch);

  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [section.id]);

  if (!state.settingsOpen) return null;

  return (
    <div
      className="settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) actions.closeSettings();
      }}
    >
      <div
        ref={rootRef}
        className="settings-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-window-title"
        tabIndex={-1}
      >
        <header className="settings-titlebar">
          <button
            type="button"
            className="settings-traffic"
            title="Close Settings"
            aria-label="Close Settings"
            onClick={actions.closeSettings}
          >
            <img src={closePng} alt="" draggable={false} />
            <img src={closeHoverPng} alt="" draggable={false} className="settings-traffic-hover" />
          </button>
          <div className="settings-title">
            <h2 id="settings-window-title">Settings</h2>
            <span>Glass Player 7.6.2</span>
          </div>
        </header>

        <div className="settings-body">
          <aside className="settings-rail" aria-label="Settings sections">
            {SECTIONS.map(({ id, label, Icon }) => {
              const active = section.id === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`settings-nav-item ${active ? 'is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => actions.setSettingsSection(id)}
                >
                  <Icon size={16} strokeWidth={active ? 2 : 1.75} />
                  {label}
                </button>
              );
            })}
          </aside>

          <div ref={contentRef} className="settings-content">
            <div key={section.id} className="settings-pane">
              <div className="settings-pane-head">
                <h3>{section.label}</h3>
                <p>{section.description}</p>
              </div>
              <div className="divider" />

              {section.id === 'appearance' && (
                <>
                  <div className="set-row">
                    <span className="set-row-label">Theme</span>
                    <div className="set-row-control">
                      <div className="set-themes" role="group" aria-label="Theme">
                        {THEMES.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`set-theme ${theme === item.id ? 'is-selected' : ''}`}
                            aria-label={`${item.label} theme`}
                            aria-pressed={theme === item.id}
                            onClick={() => actions.setTheme(item.id)}
                          >
                            <ThemePreview theme={item.id} />
                            <span className="set-theme-label">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="set-row">
                    <span className="set-row-label">Accent color</span>
                    <div className="set-row-control">
                      <div className="set-accents" role="group" aria-label="Accent color">
                        {ACCENTS.map((item) => {
                          const selected = prefs.accent === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`set-accent ${selected ? 'is-selected' : ''}`}
                              style={{ '--swatch': accentValue(item, theme) }}
                              title={item.label}
                              aria-label={`${item.label} accent`}
                              aria-pressed={selected}
                              onClick={() => actions.setAccent(item.id)}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  <FormRow label="Reduce motion">
                    <Switch
                      checked={prefs.reduceMotion}
                      onChange={(value) => setPref({ reduceMotion: value })}
                      label="Reduce motion"
                    />
                  </FormRow>
                </>
              )}

              {section.id === 'playback' && (
                <>
                  <FormRow label="Crossfade">
                    <Switch
                      checked={prefs.crossfade}
                      onChange={(value) => setPref({ crossfade: value })}
                      label="Crossfade between tracks"
                    />
                    <input
                      type="range"
                      className="set-range"
                      min="1"
                      max="8"
                      step="1"
                      value={prefs.crossfadeSeconds}
                      aria-label="Crossfade duration in seconds"
                      onChange={(event) => setPref({ crossfadeSeconds: Number(event.target.value) })}
                    />
                    <span className="set-value mono">{prefs.crossfadeSeconds} s</span>
                  </FormRow>
                  <FormRow label="Gapless playback">
                    <Switch
                      checked={prefs.gapless}
                      onChange={(value) => setPref({ gapless: value })}
                      label="Gapless playback"
                    />
                  </FormRow>
                  <FormRow label="Normalize loudness">
                    <Switch
                      checked={prefs.normalize}
                      onChange={(value) => setPref({ normalize: value })}
                      label="Normalize loudness"
                    />
                  </FormRow>
                  <FormRow label="Resume playback">
                    <Switch
                      checked={prefs.resumePlayback}
                      onChange={(value) => setPref({ resumePlayback: value })}
                      label="Resume playback"
                    />
                  </FormRow>
                  <FormRow label="Show remaining time">
                    <Switch
                      checked={prefs.showRemaining}
                      onChange={(value) => setPref({ showRemaining: value })}
                      label="Show remaining time"
                    />
                  </FormRow>
                  <FormRow label="Playback rate">
                    <Segmented
                      options={PLAYBACK_RATES}
                      value={prefs.playbackRate}
                      onChange={(value) => setPref({ playbackRate: value })}
                      ariaLabel="Playback rate"
                    />
                  </FormRow>
                </>
              )}

              {section.id === 'audio' && (
                <>
                  <FormRow label="EQ preset">
                    <div className="set-chips" role="group" aria-label="EQ preset">
                      {EQ_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className={`set-chip ${prefs.eq === preset ? 'is-active' : ''}`}
                          aria-pressed={prefs.eq === preset}
                          onClick={() => setPref({ eq: preset })}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </FormRow>
                  <FormRow label="Spatial mode">
                    <Segmented
                      options={SPATIAL_MODES}
                      value={prefs.spatial}
                      onChange={(mode) => setPref({ spatial: mode })}
                      ariaLabel="Spatial mode"
                    />
                  </FormRow>
                  <FormRow label="Output device" stack>
                    <span className="set-static">System Default</span>
                    <span className="set-hint">Desktop app enumerates devices</span>
                  </FormRow>
                  <div className="divider set-note-divider" />
                  <p className="set-graph-note">
                    <AudioLines size={13} strokeWidth={1.9} aria-hidden="true" />
                    One AudioContext · Deck A/B
                  </p>
                </>
              )}

              {section.id === 'library' && (
                <>
                  <FormRow label="Auto-analyze imports">
                    <Switch
                      checked={prefs.autoAnalyze}
                      onChange={(value) => setPref({ autoAnalyze: value })}
                      label="Auto-analyze imports"
                    />
                  </FormRow>
                  <FormRow label="Cache spectrum">
                    <Switch
                      checked={prefs.cacheSpectrum}
                      onChange={(value) => setPref({ cacheSpectrum: value })}
                      label="Cache spectrum"
                    />
                  </FormRow>
                  <FormRow label="Spectrum cache" stack>
                    <div className="set-storage">
                      <div className="set-storage-copy">
                        <span>2.4 GB of 8 GB</span>
                        <span className="mono dim">30%</span>
                      </div>
                      <div
                        className="set-storage-bar"
                        role="img"
                        aria-label="Spectrum cache: 2.4 GB of 8 GB used"
                      >
                        <span style={{ width: '30%' }} />
                      </div>
                    </div>
                  </FormRow>
                  <FormRow label="Folders" stack>
                    <div className="set-folders">
                      {FOLDERS.map((folder) => (
                        <div key={folder.name} className="set-folder">
                          <Folder size={13} strokeWidth={1.75} />
                          <span>{folder.name}</span>
                          <span className="set-folder-count mono">{folder.count}</span>
                        </div>
                      ))}
                    </div>
                    <span className="set-hint">Imports and folder scanning live in the desktop app.</span>
                  </FormRow>
                </>
              )}

              {section.id === 'about' && (
                <>
                  <div className="set-about">
                    <div className="set-about-head">
                      <span className="set-about-mark" aria-hidden="true">
                        GP
                      </span>
                      <div className="set-about-id">
                        <span className="set-about-name">Glass Player</span>
                        <span className="set-about-version">7.6.2</span>
                        <span className="set-about-tag">REBRAND UPDATE</span>
                      </div>
                    </div>
                    <p className="set-about-line mono">CinemaX Frame Demo · localhost:1442</p>
                  </div>
                  <div className="divider" />
                  <FormRow label="Architecture">
                    <span className="set-static mono">Peregrine Lake · GP Core 4.1</span>
                  </FormRow>
                  <FormRow label="Window">
                    <span className="set-static mono">CinemaX · 1080 × 580</span>
                  </FormRow>
                  <p className="set-about-note">
                    This demo uses mock library data and writes no settings, history or cache to disk.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <footer className="settings-footer">
          <span className="settings-footer-note">Session-only demo settings</span>
          <button type="button" className="primary-button settings-done" onClick={actions.closeSettings}>
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
