import React from 'react';
import { useApp } from '../state.jsx';
import closePng from '../assets/traffic/close.png';
import closeHoverPng from '../assets/traffic/close-hover.png';
import minimizePng from '../assets/traffic/minimize.png';
import minimizeHoverPng from '../assets/traffic/minimize-hover.png';
import fullscreenPng from '../assets/traffic/fullscreen.png';
import fullscreenHoverPng from '../assets/traffic/fullscreen-hover.png';
import unfocusedSvg from '../assets/traffic/unfocused.svg';

const lamps = [
  { name: 'close', label: 'Close', base: closePng, hover: closeHoverPng },
  { name: 'minimize', label: 'Minimize', base: minimizePng, hover: minimizeHoverPng },
  { name: 'fullscreen', label: 'Toggle Fullscreen', base: fullscreenPng, hover: fullscreenHoverPng },
];

export default function TrafficLights() {
  const { actions } = useApp();

  const onClick = (name) => {
    if (name === 'fullscreen') {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.().catch(() => {});
      return;
    }
    actions.toast(`${name === 'close' ? 'Close' : 'Minimize'} belongs to the CinemaX desktop window`);
  };

  return (
    <div className="window-lights" aria-label="Window controls">
      {lamps.map((lamp) => (
        <button
          key={lamp.name}
          type="button"
          className="traffic"
          aria-label={lamp.label}
          onClick={() => onClick(lamp.name)}
        >
          <img src={unfocusedSvg} alt="" draggable={false} />
          <img src={lamp.base} alt="" draggable={false} />
          <img src={lamp.hover} alt="" draggable={false} className="traffic-hover" />
        </button>
      ))}
    </div>
  );
}
