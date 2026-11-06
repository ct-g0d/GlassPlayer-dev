import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Heart,
  ListMusic,
  ListPlus,
  Pause,
  Play,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import CoverArt from '../components/CoverArt.jsx';
import ScrollArea from '../components/ScrollArea.jsx';
import { EmptyState, Pill, Segmented } from '../components/ui.jsx';
import { QUEUE_TABS } from '../data/mock.js';
import { useApp } from '../state.jsx';
import { clamp, formatTime, plural } from '../utils.js';
import './now-playing.css';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const MODE_META = {
  sequential: { label: 'Sequential', Icon: Repeat },
  shuffle: { label: 'Shuffle', Icon: Shuffle },
  'repeat-one': { label: 'Repeat one', Icon: Repeat1 },
};

function rateLabel(rate) {
  return `${rate}×`;
}

export default function NowPlaying() {
  const { state, actions, currentTrack, mixTracks, queueTracks, isLiked } = useApp();
  const { isPlaying, position, volume, muted, mode, queueTab, prefs } = state;
  const [rateOpen, setRateOpen] = useState(false);
  const rateWrapRef = useRef(null);
  const rateTriggerRef = useRef(null);
  const ratePopRef = useRef(null);
  const ratePopId = useId();

  const duration = currentTrack.duration;
  const progress = duration ? clamp(position / duration, 0, 1) : 0;
  const playbackRate = prefs.playbackRate || 1;
  const showRemaining = Boolean(prefs.showRemaining);
  const liked = isLiked(currentTrack.id);
  const lossless = currentTrack.format === 'FLAC' || currentTrack.format === 'ALAC';
  const modeMeta = MODE_META[mode] ?? MODE_META.sequential;
  const ModeIcon = modeMeta.Icon;
  const activeTracks = queueTab === 'mix' ? mixTracks : queueTracks;
  const volumeLevel = muted ? 0 : volume;

  const queueSuggestion = useMemo(
    () => mixTracks.find((track) => track.id !== currentTrack.id && !state.queue.includes(track.id)) ?? null,
    [mixTracks, currentTrack.id, state.queue],
  );

  useEffect(() => {
    if (!rateOpen) return undefined;
    const onPointerDown = (event) => {
      if (!rateWrapRef.current?.contains(event.target)) setRateOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      setRateOpen(false);
      rateTriggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [rateOpen]);

  useEffect(() => {
    if (!rateOpen) return;
    const active = ratePopRef.current?.querySelector('[aria-checked="true"]');
    const first = ratePopRef.current?.querySelector('button');
    (active ?? first)?.focus({ preventScroll: true });
  }, [rateOpen]);

  function selectRate(rate) {
    actions.setPrefs({ playbackRate: rate });
    setRateOpen(false);
    rateTriggerRef.current?.focus({ preventScroll: true });
  }

  function queueDailyPick() {
    if (queueSuggestion) actions.addToQueue(queueSuggestion.id);
  }

  return (
    <section className={`np-view ${isPlaying ? 'is-playing' : ''}`} aria-label="Now playing">
      <div
        className="np-ambience"
        aria-hidden="true"
        style={{ '--np-glow': currentTrack.palette[1], '--np-glow-2': currentTrack.palette[2] }}
      >
        <span className="np-glow np-glow-a" />
        <span className="np-glow np-glow-b" />
      </div>

      <div className="np-stage">
        <div className="np-disc-stage" aria-hidden="true">
          <div className="np-turntable">
            <div className="np-disc">
              <div className="np-disc-rotor">
                <span className="np-grooves" />
                <div className="np-label">
                  <CoverArt
                    track={currentTrack}
                    mark={false}
                    style={{ width: '100%', height: '100%', borderRadius: '50%' }}
                  />
                </div>
                <span className="np-spindle" />
              </div>
              <span className="np-sheen" />
            </div>
            <div className="np-tonearm">
              <span className="np-arm-base" />
              <div className="np-arm">
                <span className="np-arm-weight" />
                <span className="np-arm-tube" />
                <span className="np-arm-head" />
              </div>
            </div>
          </div>
        </div>

        <div className="np-meta">
          <div className="np-badges">
            {lossless ? <Pill tone="lossless">Lossless</Pill> : null}
            <Pill>
              {currentTrack.format} · {currentTrack.bitDepth}-bit
            </Pill>
            <Pill>{currentTrack.sampleRate} kHz</Pill>
          </div>
          <h1 className="np-title">{currentTrack.title}</h1>
          <p className="np-artist">{currentTrack.artist}</p>
          <p className="np-album">
            {currentTrack.album} · {currentTrack.year} · {currentTrack.genre}
          </p>
        </div>

        <div className="np-progress">
          <input
            type="range"
            className="np-range np-seek"
            min={0}
            max={duration}
            step={1}
            value={Math.min(position, duration)}
            onChange={(event) => actions.seek(Number(event.target.value))}
            style={{ '--np-level': `${progress * 100}%` }}
            aria-label="Seek"
            aria-valuetext={`${formatTime(position)} of ${formatTime(duration)}`}
          />
          <div className="np-time-row">
            <span className="np-time">{formatTime(position)}</span>
            <div className="np-time-right">
              <div className={`np-eq ${isPlaying ? 'is-live' : ''}`} aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <button
                type="button"
                className="np-time np-time-toggle"
                onClick={() => actions.setPrefs({ showRemaining: !showRemaining })}
                aria-pressed={showRemaining}
                aria-label={showRemaining ? 'Show total duration' : 'Show remaining time'}
                title={showRemaining ? 'Show total duration' : 'Show remaining time'}
              >
                {showRemaining
                  ? `−${formatTime(Math.max(0, duration - position))}`
                  : formatTime(duration)}
              </button>
            </div>
          </div>
        </div>

        <div className="np-controls">
          <button
            type="button"
            className={`np-icon np-mode ${mode === 'sequential' ? '' : 'is-active'}`}
            onClick={actions.cycleMode}
            aria-label={`Playback mode: ${modeMeta.label}. Click to change`}
            title={`Playback mode: ${modeMeta.label}`}
          >
            <ModeIcon size={17} strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="np-icon np-skip"
            onClick={actions.prev}
            aria-label="Previous track"
            title="Previous track"
          >
            <SkipBack size={19} fill="currentColor" strokeWidth={1.3} />
          </button>
          <button
            type="button"
            className="np-play"
            onClick={actions.togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause size={19} fill="currentColor" strokeWidth={0} />
            ) : (
              <Play size={20} fill="currentColor" strokeWidth={0} className="np-play-glyph" />
            )}
          </button>
          <button
            type="button"
            className="np-icon np-skip"
            onClick={actions.next}
            aria-label="Next track"
            title="Next track"
          >
            <SkipForward size={19} fill="currentColor" strokeWidth={1.3} />
          </button>
          <div className="np-rate-wrap" ref={rateWrapRef}>
            <button
              type="button"
              ref={rateTriggerRef}
              className="np-rate"
              onClick={() => setRateOpen((open) => !open)}
              aria-label={`Playback speed: ${rateLabel(playbackRate)}`}
              aria-haspopup="menu"
              aria-expanded={rateOpen}
              aria-controls={ratePopId}
              title="Playback speed"
            >
              {rateLabel(playbackRate)}
            </button>
            {rateOpen ? (
              <div
                className="np-rate-pop glass-panel"
                id={ratePopId}
                role="menu"
                aria-label="Playback speed"
                ref={ratePopRef}
              >
                {RATES.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    role="menuitemradio"
                    aria-checked={playbackRate === rate}
                    className={`np-rate-item ${playbackRate === rate ? 'is-active' : ''}`}
                    onClick={() => selectRate(rate)}
                  >
                    {rateLabel(rate)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="np-secondary">
          <div className="np-secondary-group">
            <button
              type="button"
              className={`np-icon np-like ${liked ? 'is-liked' : ''}`}
              onClick={() => actions.toggleLike(currentTrack.id)}
              aria-label={liked ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={liked}
              title={liked ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
            </button>
            <button
              type="button"
              className="np-icon"
              onClick={queueDailyPick}
              disabled={!queueSuggestion}
              aria-label={
                queueSuggestion
                  ? `Queue ${queueSuggestion.title} from Daily Mix`
                  : 'All Daily Mix tracks are queued'
              }
              title={
                queueSuggestion
                  ? `Queue “${queueSuggestion.title}” from Daily Mix`
                  : 'All Daily Mix tracks are queued'
              }
            >
              <ListPlus size={18} strokeWidth={1.8} />
            </button>
          </div>
          <div className="np-volume">
            <button
              type="button"
              className="np-icon np-volume-btn"
              onClick={actions.toggleMute}
              aria-label={muted ? 'Unmute' : 'Mute'}
              aria-pressed={muted}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? (
                <VolumeX size={17} strokeWidth={1.8} />
              ) : (
                <Volume2 size={17} strokeWidth={1.8} />
              )}
            </button>
            <input
              type="range"
              className="np-range np-volume-range"
              min={0}
              max={1}
              step={0.01}
              value={volumeLevel}
              onChange={(event) => actions.setVolume(Number(event.target.value))}
              style={{ '--np-level': `${Math.round(volumeLevel * 100)}%` }}
              aria-label="Volume"
              aria-valuetext={`${Math.round(volumeLevel * 100)}%`}
            />
          </div>
        </div>
      </div>

      <aside className="np-queue glass-panel" aria-label="Up next">
        <div className="np-q-head">
          <div className="np-q-heading">
            <h2>Up Next</h2>
            <span className="np-q-count" title={plural(activeTracks.length, 'track')}>
              {activeTracks.length}
            </span>
          </div>
          <button
            type="button"
            className="np-q-clear"
            onClick={actions.clearQueue}
            disabled={queueTab !== 'queue' || queueTracks.length === 0}
            title="Clear queue"
          >
            Clear
          </button>
        </div>

        <Segmented
          options={QUEUE_TABS}
          value={queueTab}
          onChange={actions.setQueueTab}
          ariaLabel="Up next source"
          className="np-q-tabs"
        />

        <ScrollArea key={queueTab} className="np-queue-scroll no-scrollbar">
          {activeTracks.length === 0 ? (
            <div className="np-q-empty">
              <EmptyState icon={<ListMusic size={20} strokeWidth={1.5} />} title="Queue is empty">
                Add a track from Daily Mix.
              </EmptyState>
            </div>
          ) : (
            <div className="np-q-list" role="list">
              {activeTracks.map((track) => {
                const queued = state.queue.includes(track.id);
                const current = track.id === currentTrack.id;
                return (
                  <div
                    key={track.id}
                    role="listitem"
                    className={`np-q-row ${current ? 'is-current' : ''}`}
                  >
                    <button
                      type="button"
                      className="np-q-play"
                      onClick={() => actions.playTrack(track.id)}
                      aria-label={`Play ${track.title} by ${track.artist}`}
                    >
                      <CoverArt
                        track={track}
                        className="np-q-cover"
                        mark={false}
                        style={{ width: 30, height: 30, borderRadius: 7 }}
                      />
                      <span className="np-q-text">
                        <span className="np-q-title">{track.title}</span>
                        <span className="np-q-artist">{track.artist}</span>
                      </span>
                      <span className="np-q-duration mono">{formatTime(track.duration)}</span>
                    </button>
                    {queueTab === 'queue' ? (
                      <button
                        type="button"
                        className="np-q-action"
                        onClick={() => actions.removeFromQueue(track.id)}
                        aria-label={`Remove ${track.title} from queue`}
                        title="Remove from queue"
                      >
                        <X size={13} strokeWidth={2} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="np-q-action"
                        onClick={() => actions.addToQueue(track.id)}
                        disabled={queued || current}
                        aria-label={`Add ${track.title} to queue`}
                        title={queued ? 'Already in queue' : current ? 'Currently playing' : 'Add to queue'}
                      >
                        <Plus size={14} strokeWidth={2} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </aside>
    </section>
  );
}
