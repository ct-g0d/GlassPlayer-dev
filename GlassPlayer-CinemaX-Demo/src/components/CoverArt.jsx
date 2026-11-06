import React from 'react';
import { TRACK_BY_ID } from '../data/mock.js';
import { initials } from '../utils.js';

export default function CoverArt({ track, className = '', mark = true, style, children }) {
  const item = typeof track === 'string' ? TRACK_BY_ID[track] : track;
  if (!item) return null;
  return (
    <div
      className={`cover-art pattern-${item.pattern} ${className}`}
      style={{
        '--c1': item.palette[0],
        '--c2': item.palette[1],
        '--c3': item.palette[2],
        ...style,
      }}
      aria-hidden="true"
    >
      {mark && <span className="cover-mark">{initials(item.album)}</span>}
      {children}
    </div>
  );
}
