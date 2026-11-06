import React from 'react';
import { ArrowRight, AudioLines, Heart, Plus } from 'lucide-react';
import { useApp } from '../state.jsx';
import PageHeader from '../components/PageHeader.jsx';
import ScrollArea from '../components/ScrollArea.jsx';
import CoverArt from '../components/CoverArt.jsx';
import { KpiCard, Pill } from '../components/ui.jsx';
import { formatDate, formatNumber, formatTime } from '../utils.js';
import './inspector.css';

const BAR_COUNT = 64;

function barsFor(id) {
  const seed = Array.from(id).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 3), 0);
  return Array.from({ length: BAR_COUNT }, (_, index) => {
    const wave = Math.abs(Math.sin((index + 1) * 0.47 + seed * 0.017));
    const grain = ((seed * (index + 11)) % 89) / 89;
    return 0.14 + (wave * 0.62 + grain * 0.38) * 0.86;
  });
}

function DetailRow({ label, value, title, accent = false }) {
  return (
    <div className="insp-row">
      <dt>{label}</dt>
      <dd className={`mono ${accent ? 'insp-accent' : ''}`} title={title}>
        {value}
      </dd>
    </div>
  );
}

export default function Inspector() {
  const { state, actions, currentTrack, isLiked } = useApp();
  const track = currentTrack;
  const liked = isLiked(track.id);
  const lossless = track.format === 'FLAC' || track.format === 'ALAC';
  const bitrate = Math.round((Number.parseInt(track.size, 10) * 8 * 1024) / track.duration);
  const progress = track.duration ? Math.min(1, state.position / track.duration) : 0;
  const bars = barsFor(track.id);

  return (
    <>
      <PageHeader title="Inspector" subtitle={`${track.title} · ${track.artist}`}>
        <div className="insp-header-pills">
          <Pill>{track.format}</Pill>
          <Pill>
            {track.bitDepth}-bit · {track.sampleRate} kHz
          </Pill>
          {lossless ? <Pill tone="lossless">Lossless</Pill> : null}
        </div>
      </PageHeader>

      <div className="page-main">
        <ScrollArea className="view-scroll insp-scroll">
          <section className="glass-panel insp-hero" aria-label="Current track overview">
            <div className="insp-hero-body">
              <CoverArt track={track} className="insp-cover" />
              <div className="insp-hero-meta">
                <div className="insp-hero-title-row">
                  <h2 className="insp-title">{track.title}</h2>
                  <div className="insp-hero-actions">
                    <button
                      type="button"
                      className={`icon-button insp-like ${liked ? 'is-active' : ''}`}
                      aria-label={liked ? 'Remove from favorites' : 'Add to favorites'}
                      aria-pressed={liked}
                      onClick={() => actions.toggleLike(track.id)}
                    >
                      <Heart size={15} strokeWidth={1.9} fill={liked ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      type="button"
                      className="ghost-button insp-queue"
                      onClick={() => actions.addToQueue(track.id)}
                    >
                      <Plus size={13} strokeWidth={2} />
                      Add to queue
                    </button>
                  </div>
                </div>
                <p className="insp-artist">{track.artist}</p>
                <p className="insp-line">
                  {track.album} · {track.year} · {track.genre} · <span className="mono">{track.file}</span>
                </p>
                <div className="insp-hero-pills">
                  <Pill tone="accent">{track.format}</Pill>
                  <Pill>{track.bitDepth}-bit</Pill>
                  <Pill>{track.sampleRate} kHz</Pill>
                  {lossless ? <Pill tone="lossless">Lossless</Pill> : null}
                </div>
              </div>
            </div>
            <div className="insp-wave" aria-hidden="true">
              {bars.map((height, index) => (
                <span
                  key={index}
                  className={`insp-bar ${(index + 0.5) / BAR_COUNT <= progress ? 'is-played' : ''}`}
                  style={{ height: `${Math.round(height * 100)}%` }}
                />
              ))}
            </div>
          </section>

          <div className="insp-kpis">
            <KpiCard label="Sample Rate" value={track.sampleRate} unit="kHz" note={track.format} />
            <KpiCard
              label="Bit Depth"
              value={`${track.bitDepth}-bit`}
              note={lossless ? 'Lossless source' : 'Decoded PCM'}
            />
            <KpiCard label="BPM" value={track.bpm} note="Spectrum estimate" />
            <KpiCard
              label="Dynamic Range"
              value={track.dynamicRange.toFixed(1)}
              unit="dB"
              note={`${track.loudness} LUFS loudness`}
            />
          </div>

          <div className="insp-grid">
            <section className="card-surface insp-card" aria-labelledby="insp-file-title">
              <h3 id="insp-file-title">File &amp; Format</h3>
              <dl>
                <DetailRow label="File name" value={track.file} title={track.file} />
                <DetailRow label="Size" value={track.size} />
                <DetailRow label="Format" value={track.format} />
                <DetailRow label="Est. Bitrate" value={`${formatNumber(bitrate)} kbps`} />
                <DetailRow label="Duration" value={formatTime(track.duration)} />
                <DetailRow label="Folder" value={track.folder} />
              </dl>
            </section>

            <section className="card-surface insp-card" aria-labelledby="insp-analysis-title">
              <h3 id="insp-analysis-title">Audio Analysis</h3>
              <dl>
                <DetailRow label="Spectrum ID" value={track.spectrumId} accent />
                <DetailRow label="BPM" value={track.bpm} />
                <div className="insp-row">
                  <dt>Energy</dt>
                  <dd className="insp-energy">
                    <span className="insp-meter" aria-hidden="true">
                      <span style={{ width: `${Math.round(track.energy * 100)}%` }} />
                    </span>
                    <span className="mono">{Math.round(track.energy * 100)}%</span>
                  </dd>
                </div>
                <DetailRow label="Loudness" value={`${track.loudness} LUFS`} />
                <DetailRow label="Dynamic Range" value={`${track.dynamicRange.toFixed(1)} dB`} />
                <DetailRow label="Year" value={track.year} />
              </dl>
            </section>

            <section className="card-surface insp-card" aria-labelledby="insp-library-title">
              <h3 id="insp-library-title">Library</h3>
              <dl>
                <DetailRow label="Plays" value={formatNumber(track.plays)} />
                <DetailRow label="Added" value={formatDate(track.added)} />
                <DetailRow label="Last played" value={track.lastPlayed} />
                <DetailRow label="Favorite" value={liked ? 'Yes' : 'No'} />
                <DetailRow label="Genre" value={track.genre} />
                <DetailRow label="Album" value={track.album} title={track.album} />
              </dl>
            </section>
          </div>

          <section className="card-surface insp-chain" aria-label="Signal chain">
            <span className="insp-chain-title">
              <AudioLines size={14} strokeWidth={1.9} />
              Signal chain
            </span>
            <div className="insp-chain-nodes">
              <Pill>Spectrum Analyzer</Pill>
              <ArrowRight size={12} strokeWidth={1.8} className="insp-arrow" aria-hidden="true" />
              <Pill>Neural Engine</Pill>
              <ArrowRight size={12} strokeWidth={1.8} className="insp-arrow" aria-hidden="true" />
              <Pill>Playback</Pill>
            </div>
            <span className="insp-chain-note dim">Cached features, no live analysis</span>
          </section>
        </ScrollArea>
      </div>
    </>
  );
}
