import React from 'react';
import {
  CirclePlay,
  Disc3,
  Folder,
  FolderPlus,
  HardDrive,
  Heart,
  History,
  Library,
  Maximize2,
  Music2,
  Pause,
  Play,
  SlidersHorizontal,
  Usb,
} from 'lucide-react';
import { useApp } from '../state.jsx';
import { TRACKS } from '../data/mock.js';
import CoverArt from './CoverArt.jsx';
import { formatTime } from '../utils.js';

const NAV_ITEMS = [
  { id: 'now-playing', label: 'Now Playing', Icon: CirclePlay },
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'history', label: 'History', Icon: History },
  { id: 'inspector', label: 'Inspector', Icon: SlidersHorizontal },
];

const ITEM = 34;

const COLLECTIONS = [
  { id: 'all', label: 'All Tracks', Icon: Music2, count: TRACKS.length },
  { id: 'favorites', label: 'Favorites', Icon: Heart, count: TRACKS.filter((track) => track.liked).length },
  { id: 'lossless', label: 'Lossless', Icon: Disc3, count: TRACKS.filter((track) => ['FLAC', 'ALAC'].includes(track.format)).length },
];

const FOLDERS = ['Lossless', 'Music'];

const STORAGE = [
  { id: 'ssd', name: 'System SSD', detail: '214 GB free', Icon: HardDrive, online: true },
  { id: 'archive', name: 'Archive HD', detail: 'Offline', Icon: Usb, online: false },
];

function openCollection(actions, id) {
  actions.setTab('library');
  actions.setLibraryFilter(id);
  actions.setLibraryFolder(null);
  actions.setLibraryQuery('');
}

function openFolder(actions, folder) {
  actions.setTab('library');
  actions.setLibraryFilter('all');
  actions.setLibraryFolder(folder);
  actions.setLibraryQuery('');
}

export default function Sidebar() {
  const { state, actions, currentTrack } = useApp();
  const activeIndex = NAV_ITEMS.findIndex((item) => item.id === state.tab);
  const progress = Math.min(1, state.position / currentTrack.duration);
  const folderCount = (folder) => TRACKS.filter((track) => track.folder === folder).length;

  return (
    <aside className="sidebar-rail">
      <div className="sidebar-glass liquid-glass sidebar-ink">
        <div className="sidebar-top">
          <span className="sidebar-wordmark">
            Glass <b>Player</b>
          </span>
        </div>

        <div className="sidebar-scroll">
          <nav className="nav-list" aria-label="Main">
            <div className="nav-glider" style={{ transform: `translateY(${activeIndex * ITEM}px)` }} />
            {NAV_ITEMS.map(({ id, label, Icon }) => {
              const isActive = state.tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => actions.setTab(id)}
                  className={`nav-item ${isActive ? 'is-active' : ''}`}
                >
                  <Icon size={17} strokeWidth={isActive ? 2 : 1.75} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <span>Collections</span>
            </div>
            {COLLECTIONS.map(({ id, label, Icon, count }) => {
              const selected = state.tab === 'library' && state.libraryFilter === id && !state.libraryFolder;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => openCollection(actions, id)}
                  className={`sidebar-row ${selected ? 'is-selected' : ''}`}
                >
                  <Icon size={16} strokeWidth={1.75} />
                  <span className="row-label">{label}</span>
                  <span className="row-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <span>Folders</span>
              <button
                type="button"
                className="sidebar-add"
                title="Import Folder"
                onClick={() => actions.toast('Folder import lives in the real Glass Player')}
              >
                <FolderPlus size={13} strokeWidth={2} />
              </button>
            </div>
            {FOLDERS.map((folder) => {
              const selected = state.tab === 'library' && state.libraryFolder === folder;
              return (
                <button
                  key={folder}
                  type="button"
                  onClick={() => openFolder(actions, folder)}
                  className={`sidebar-row ${selected ? 'is-selected' : ''}`}
                >
                  <Folder size={16} strokeWidth={1.75} />
                  <span className="row-label">{folder}</span>
                  <span className="row-count">{folderCount(folder)}</span>
                </button>
              );
            })}
          </div>

          <div className="sidebar-section">
            <div className="sidebar-section-head">
              <span>Storage</span>
            </div>
            {STORAGE.map(({ id, name, detail, Icon, online }) => (
              <div key={id} className={`sidebar-row ${online ? '' : 'is-offline'}`} title={detail}>
                <div className="storage-dot-wrap">
                  <Icon size={16} strokeWidth={1.75} />
                  <span className={`storage-dot ${online ? 'is-online' : ''}`} />
                </div>
                <span className="row-label">{name}</span>
                <span className="row-count">{detail}</span>
              </div>
            ))}
          </div>
        </div>

        {state.tab !== 'now-playing' && (
          <div className="sidebar-mini">
            <div className="mini-tile" onClick={() => actions.setTab('now-playing')} title={currentTrack.title}>
              <CoverArt track={currentTrack} mark={false} className="mini-cover" />
              <div className="mini-shade" />
              <p className="mini-title">{currentTrack.title}</p>
              <button
                type="button"
                className="mini-play"
                aria-label={state.isPlaying ? 'Pause' : 'Play'}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.togglePlay();
                }}
              >
                {state.isPlaying ? <Pause size={12} fill="currentColor" strokeWidth={0} /> : <Play size={12} fill="currentColor" strokeWidth={0} />}
              </button>
              <button
                type="button"
                className="mini-open"
                aria-label="Open Now Playing"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.setTab('now-playing');
                }}
              >
                <Maximize2 size={12} strokeWidth={2} />
              </button>
              <div className="mini-progress">
                <span style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
            <div className="mini-caption">
              <span className="mini-track">{currentTrack.title}</span>
              <span className="mini-artist">
                {state.isPlaying ? 'Playing' : 'Paused'} · {formatTime(state.position)}
              </span>
            </div>
          </div>
        )}

        <div className="sidebar-bottom-space" />
      </div>
    </aside>
  );
}
