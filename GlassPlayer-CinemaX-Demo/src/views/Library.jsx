import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  Folder,
  Grid2x2,
  Heart,
  ListPlus,
  Play,
  Rows3,
  Search,
  SearchX,
  X,
} from 'lucide-react';
import PageHeader from '../components/PageHeader.jsx';
import ScrollArea from '../components/ScrollArea.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { Pill } from '../components/ui.jsx';
import { useApp } from '../state.jsx';
import { LIBRARY_FILTERS, SORT_OPTIONS, TRACKS } from '../data/mock.js';
import { formatNumber, formatTime, plural } from '../utils.js';
import './library.css';

const LOSSLESS_FORMATS = new Set(['FLAC', 'ALAC']);

function sortTracks(tracks, sort) {
  const copy = [...tracks];
  if (sort === 'title') return copy.sort((a, b) => a.title.localeCompare(b.title) || a.artist.localeCompare(b.artist));
  if (sort === 'artist') return copy.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  if (sort === 'recent') return copy.sort((a, b) => b.added.localeCompare(a.added));
  if (sort === 'plays') return copy.sort((a, b) => b.plays - a.plays);
  return copy;
}

function Equalizer({ playing }) {
  return (
    <span className={`lib-eq ${playing ? 'is-playing' : ''}`}>
      <span />
      <span />
      <span />
    </span>
  );
}

function TrackRow({ track, index, actions, liked, isCurrent, isPlaying, progress }) {
  const lossless = LOSSLESS_FORMATS.has(track.format);
  return (
    <div className={`lib-row ${isCurrent ? 'is-current' : ''}`} role="listitem">
      {isCurrent ? (
        <span className="lib-row-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        className="lib-row-hit"
        onClick={() => actions.playTrack(track.id)}
        aria-label={`Play ${track.title} by ${track.artist}`}
      />
      <div className="lib-row-content" aria-hidden="true">
        <span className="lib-index">
          {isCurrent ? <Equalizer playing={isPlaying} /> : String(index + 1).padStart(2, '0')}
        </span>
        <div className="lib-track-cell">
          <span className="lib-row-cover">
            <CoverArt track={track} className="lib-row-art" mark={false} />
            <span className="lib-cover-play">
              <Play size={12} fill="currentColor" strokeWidth={0} />
            </span>
          </span>
          <span className="lib-track-text">
            <span className="lib-title">{track.title}</span>
            <span className="lib-artist">{track.artist}</span>
          </span>
        </div>
        <span className="lib-album">{track.album}</span>
        <span className="lib-format">
          <Pill tone={lossless ? 'lossless' : 'default'}>{track.format}</Pill>
        </span>
        <span className="lib-plays mono">{formatNumber(track.plays)}</span>
        <span className="lib-time mono">{formatTime(track.duration)}</span>
      </div>
      <div className="lib-row-actions">
        <button
          type="button"
          className={`lib-action ${liked ? 'is-liked' : ''}`}
          onClick={() => actions.toggleLike(track.id)}
          aria-label={liked ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
          aria-pressed={liked}
          title={liked ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} strokeWidth={1.9} />
        </button>
        <button
          type="button"
          className="lib-action"
          onClick={() => actions.addToQueue(track.id)}
          aria-label={`Add ${track.title} to queue`}
          title="Add to queue"
        >
          <ListPlus size={15} strokeWidth={1.9} />
        </button>
      </div>
    </div>
  );
}

function TrackCard({ track, actions, liked, isCurrent }) {
  const lossless = LOSSLESS_FORMATS.has(track.format);
  return (
    <article className={`lib-card ${isCurrent ? 'is-current' : ''}`} role="listitem">
      <button
        type="button"
        className="lib-card-hit"
        onClick={() => actions.playTrack(track.id)}
        aria-label={`Play ${track.title} by ${track.artist}`}
      />
      <div className="lib-grid-cover">
        <CoverArt track={track} className="lib-grid-art" mark={false} />
        <span className="lib-grid-shade" aria-hidden="true" />
        <span className="lib-grid-play" aria-hidden="true">
          <Play size={16} fill="currentColor" strokeWidth={0} />
        </span>
        <Pill tone="media" className={`lib-grid-format ${lossless ? 'is-lossless' : ''}`}>
          {track.format}
        </Pill>
        <div className="lib-grid-actions">
          <button
            type="button"
            className={`lib-grid-heart ${liked ? 'is-liked' : ''}`}
            onClick={() => actions.toggleLike(track.id)}
            aria-label={liked ? `Remove ${track.title} from favorites` : `Add ${track.title} to favorites`}
            aria-pressed={liked}
            title={liked ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Heart size={13} fill={liked ? 'currentColor' : 'none'} strokeWidth={1.9} />
          </button>
        </div>
      </div>
      <div className="lib-grid-meta" aria-hidden="true">
        <p className="lib-grid-title">{track.title}</p>
        <p className="lib-grid-artist">{track.artist}</p>
      </div>
    </article>
  );
}

export default function Library() {
  const { state, actions, currentTrack } = useApp();
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef(null);
  const sortButtonRef = useRef(null);
  const searchRef = useRef(null);

  const likedSet = useMemo(() => new Set(state.likes), [state.likes]);
  const query = state.libraryQuery.trim();
  const hasQuery = query.length > 0;
  const isGrid = state.libraryView === 'grid';
  const activeFilter = LIBRARY_FILTERS.find((item) => item.id === state.libraryFilter) ?? LIBRARY_FILTERS[0];
  const activeSort = SORT_OPTIONS.find((item) => item.id === state.librarySort) ?? SORT_OPTIONS[0];

  const scoped = useMemo(() => {
    const byFolder = state.libraryFolder
      ? TRACKS.filter((track) => track.folder === state.libraryFolder)
      : TRACKS;
    if (state.libraryFilter === 'favorites') return byFolder.filter((track) => likedSet.has(track.id));
    if (state.libraryFilter === 'lossless') return byFolder.filter((track) => LOSSLESS_FORMATS.has(track.format));
    return byFolder;
  }, [state.libraryFolder, state.libraryFilter, likedSet]);

  const results = useMemo(() => {
    const needle = query.toLowerCase();
    const searched = needle
      ? scoped.filter((track) =>
          `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(needle),
        )
      : scoped;
    return sortTracks(searched, state.librarySort);
  }, [scoped, query, state.librarySort]);

  const collectionLabel = state.libraryFolder
    ? state.libraryFilter === 'all'
      ? `${state.libraryFolder} folder`
      : `${activeFilter.label} · ${state.libraryFolder} folder`
    : activeFilter.label;
  const subtitle = hasQuery
    ? `${collectionLabel} · ${results.length} of ${plural(scoped.length, 'track')}`
    : `${collectionLabel} · ${plural(results.length, 'track')}`;

  const currentProgress = currentTrack.duration
    ? Math.min(1, Math.max(0, state.position / currentTrack.duration))
    : 0;

  useEffect(() => {
    if (!sortOpen) return undefined;
    const handlePointer = (event) => {
      if (!sortRef.current?.contains(event.target)) setSortOpen(false);
    };
    const handleKey = (event) => {
      if (event.key !== 'Escape') return;
      setSortOpen(false);
      sortButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('pointerdown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [sortOpen]);

  const resetFilters = () => {
    if (hasQuery) {
      actions.setLibraryQuery('');
      searchRef.current?.focus();
      return;
    }
    actions.setLibraryFilter('all');
    actions.setLibraryFolder(null);
  };

  return (
    <div className="lib-view">
      <PageHeader title="Library" subtitle={subtitle}>
        <div className="search-field lib-search">
          <Search size={14} strokeWidth={2} />
          <input
            ref={searchRef}
            type="text"
            value={state.libraryQuery}
            onChange={(event) => actions.setLibraryQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && state.libraryQuery) {
                event.preventDefault();
                actions.setLibraryQuery('');
              }
            }}
            placeholder="Search tracks"
            aria-label="Search tracks"
            autoComplete="off"
            spellCheck={false}
          />
          {state.libraryQuery ? (
            <button
              type="button"
              className="lib-search-clear"
              onClick={() => {
                actions.setLibraryQuery('');
                searchRef.current?.focus();
              }}
              aria-label="Clear search"
              title="Clear search"
            >
              <X size={12} strokeWidth={2.4} />
            </button>
          ) : null}
        </div>

        <div className="lib-sort" ref={sortRef}>
          <button
            ref={sortButtonRef}
            type="button"
            className="ghost-button lib-sort-btn"
            onClick={() => setSortOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
            aria-label={`Sort tracks: ${activeSort.label}`}
            title="Sort tracks"
          >
            <ArrowUpDown size={13} strokeWidth={2} />
            <span className="lib-sort-label">{activeSort.label}</span>
            <ChevronDown size={12} strokeWidth={2} className={`lib-sort-chevron ${sortOpen ? 'is-open' : ''}`} />
          </button>
          {sortOpen ? (
            <div className="lib-popover" role="listbox" aria-label="Sort tracks">
              {SORT_OPTIONS.map((option) => {
                const active = option.id === state.librarySort;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`lib-popover-item ${active ? 'is-active' : ''}`}
                    onClick={() => {
                      actions.setLibrarySort(option.id);
                      setSortOpen(false);
                      sortButtonRef.current?.focus();
                    }}
                  >
                    <span>{option.label}</span>
                    {active ? <Check size={14} strokeWidth={2.2} /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="icon-button lib-view-toggle"
          onClick={() => {
            setSortOpen(false);
            actions.setLibraryView(isGrid ? 'list' : 'grid');
          }}
          aria-label={isGrid ? 'Show list view' : 'Show grid view'}
          title={isGrid ? 'Show list view' : 'Show grid view'}
        >
          {isGrid ? <Rows3 size={16} strokeWidth={1.9} /> : <Grid2x2 size={15} strokeWidth={1.9} />}
        </button>
      </PageHeader>

      <div className="page-main lib-main">
        <div className="lib-toolbar">
          <div className="lib-chips" role="group" aria-label="Library filters">
            {LIBRARY_FILTERS.map((filter) => {
              const active = state.libraryFilter === filter.id;
              return (
                <button
                  key={filter.id}
                  type="button"
                  className={`lib-chip ${active ? 'is-active' : ''}`}
                  onClick={() => actions.setLibraryFilter(filter.id)}
                  aria-pressed={active}
                >
                  {filter.label}
                </button>
              );
            })}
            {state.libraryFolder ? (
              <span className="lib-chip is-folder">
                <Folder size={12} strokeWidth={1.9} />
                <span>{state.libraryFolder}</span>
                <button
                  type="button"
                  className="lib-chip-clear"
                  onClick={() => actions.setLibraryFolder(null)}
                  aria-label={`Clear ${state.libraryFolder} folder filter`}
                  title="Clear folder"
                >
                  <X size={11} strokeWidth={2.4} />
                </button>
              </span>
            ) : null}
          </div>
        </div>

        {results.length === 0 ? (
          <div className="lib-empty">
            <div className="lib-empty-icon">
              <SearchX size={25} strokeWidth={1.6} />
            </div>
            <strong>{hasQuery ? `No tracks match “${query}”` : 'No tracks in this view'}</strong>
            <span>
              {hasQuery
                ? 'Try a different title, artist or album.'
                : 'Choose another collection or clear the folder filter.'}
            </span>
            <button type="button" className="ghost-button" onClick={resetFilters}>
              {hasQuery ? 'Clear search' : 'Reset filters'}
            </button>
          </div>
        ) : isGrid ? (
          <ScrollArea className="lib-scroll lib-grid-scroll" aria-label="Tracks grid">
            <div className="lib-grid" role="list">
              {results.map((track) => (
                <TrackCard
                  key={track.id}
                  track={track}
                  actions={actions}
                  liked={likedSet.has(track.id)}
                  isCurrent={track.id === state.currentId}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="lib-table">
            <div className="lib-thead" aria-hidden="true">
              <span>#</span>
              <span>Track</span>
              <span>Album</span>
              <span>Format</span>
              <span className="lib-th-num">Plays</span>
              <span className="lib-th-num">Time</span>
              <span />
            </div>
            <ScrollArea className="lib-scroll" aria-label="Tracks">
              <div className="lib-tbody" role="list">
                {results.map((track, index) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    index={index}
                    actions={actions}
                    liked={likedSet.has(track.id)}
                    isCurrent={track.id === state.currentId}
                    isPlaying={state.isPlaying}
                    progress={currentProgress}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
}
