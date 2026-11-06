import React, { useEffect, useId, useMemo, useState } from 'react';
import { PanelLeft, Settings } from 'lucide-react';
import { useApp } from './state.jsx';
import { accentValue, hexToRgbString } from './utils.js';
import TrafficLights from './components/TrafficLights.jsx';
import Sidebar from './components/Sidebar.jsx';
import NowPlaying from './views/NowPlaying.jsx';
import Library from './views/Library.jsx';
import HistoryView from './views/History.jsx';
import Inspector from './views/Inspector.jsx';
import SettingsWindow from './views/SettingsWindow.jsx';

const APP_W = 1080;
const APP_H = 580;

function ThemeIcon({ theme }) {
  const mask = useId();
  const dark = theme === 'dark';
  const ease = 'theme-part';
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} className={`theme-icon ${dark ? 'is-dark' : 'is-light'}`}>
      <mask id={mask}>
        <rect width="24" height="24" fill="#fff" />
        <circle className={ease} fill="#000" style={{ cx: dark ? 17 : 32, cy: dark ? 7 : -8, r: 7 }} />
      </mask>
      <circle className={ease} fill="currentColor" mask={`url(#${mask})`} style={{ cx: 12, cy: 12, r: dark ? 8.5 : 4.5 }} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className={`theme-rays ${ease} ${dark ? 'is-hidden' : ''}`}
      >
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <line key={angle} x1="12" y1="2.5" x2="12" y2="4.5" transform={`rotate(${angle} 12 12)`} />
        ))}
      </g>
    </svg>
  );
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export default function App() {
  const { state, actions, accent, currentTrack } = useApp();
  const { tab, collapsed, settingsOpen, prefs, toast } = state;
  const theme = prefs.theme;
  const accentHex = useMemo(() => accentValue(accent, theme), [accent, theme]);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = `Glass Player — ${currentTrack.title}`;
  }, [theme, currentTrack.title]);

  useEffect(() => {
    const fit = () => {
      const fitted = Math.min(1, (window.innerWidth - 48) / APP_W, (window.innerHeight - 72) / APP_H);
      setScale(Math.max(0.4, fitted));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault();
        actions.openSettings();
        return;
      }
      if (settingsOpen) {
        if (event.key === 'Escape') actions.closeSettings();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        actions.togglePlay();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        actions.seek(Math.min(currentTrack.duration, state.position + 5));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        actions.seek(Math.max(0, state.position - 5));
      } else if (event.key.toLowerCase() === 'm') {
        actions.toggleMute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, settingsOpen, state.position, currentTrack.duration]);

  const frameStyle = {
    '--accent': accentHex,
    '--accent-rgb': hexToRgbString(accentHex),
    '--amb1': currentTrack.palette[1],
    '--amb2': currentTrack.palette[0],
    '--amb3': currentTrack.palette[2],
  };

  return (
    <div className="desktop">
      <div className="app-scale" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div
          className="app-frame"
          data-theme={theme}
          data-collapsed={collapsed ? 'true' : 'false'}
          style={frameStyle}
        >
          <div className={`ambient-stage ${tab === 'now-playing' ? 'is-player' : ''}`} aria-hidden="true">
            <div className="ambient-blob b1" />
            <div className="ambient-blob b2" />
            <div className="ambient-blob b3" />
          </div>

          <div className="window-edge" />
          <TrafficLights />

          <button
            type="button"
            className="sidebar-toggle"
            onClick={actions.toggleSidebar}
            title={collapsed ? 'Show Sidebar' : 'Hide Sidebar'}
            aria-label={collapsed ? 'Show Sidebar' : 'Hide Sidebar'}
            style={{
              left: `calc(${collapsed ? 83 : 85}px + 111px * var(--sidek))`,
              top: collapsed ? 7 : 9,
              width: collapsed ? 26 : 22,
              height: collapsed ? 26 : 22,
            }}
          >
            <PanelLeft size={18} strokeWidth={1.75} />
          </button>

          <div className={`content-stack ${tab === 'now-playing' ? 'is-player' : ''}`}>
            <div className={`view-shell ${tab === 'now-playing' ? '' : 'is-hidden'}`}>
              <NowPlaying />
            </div>
            {tab === 'library' && (
              <div key="library" className="view-shell">
                <Library />
              </div>
            )}
            {tab === 'history' && (
              <div key="history" className="view-shell">
                <HistoryView />
              </div>
            )}
            {tab === 'inspector' && (
              <div key="inspector" className="view-shell">
                <Inspector />
              </div>
            )}
          </div>

          <Sidebar />

          <div
            className="corner-controls"
            style={{ left: 'calc(14px + 150px * var(--sidek))', bottom: 'calc(14px - 6px * var(--sidek))' }}
          >
            <div className="corner-pill liquid-glass" />
            <button
              type="button"
              onClick={() => actions.setTheme(theme === 'dark' ? 'light' : 'dark')}
              title={theme === 'dark' ? 'Dark appearance (click for Light)' : 'Light appearance (click for Dark)'}
            >
              <ThemeIcon theme={theme} />
            </button>
            <button type="button" onClick={() => actions.openSettings()} title="Settings (Ctrl+,)">
              <Settings size={16} strokeWidth={1.75} />
            </button>
          </div>

          {settingsOpen && <SettingsWindow />}

          {toast && (
            <div key={toast.id} className="toast">
              {toast.text}
            </div>
          )}
        </div>
      </div>
      <p className="desktop-caption">GLASS PLAYER · CINEMAX FRAME · 1080 × 580 · LOCALHOST:1442</p>
    </div>
  );
}
