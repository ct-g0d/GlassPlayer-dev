/**
 * nexus-bridge.js — Universal Media & Telemetry Bridge for Glass Player
 * 
 * Provides bi-directional integration with Nexus Launcher and remote hosts:
 * 1. Universal Transport Layer:
 *    - BroadcastChannel('nexus-media')
 *    - window.parent.postMessage (iframed context)
 *    - window.opener.postMessage (popup window context)
 *    - window.electronAPI / window.nexusMediaBridge / window.nexusStorage / ipcRenderer
 * 2. Event-Driven Audio Telemetry:
 *    - Hooks HTMLMediaElement events (play, pause, ended, volumechange, seeked, throttled timeupdate)
 *    - Intercepts Audio constructors and prototype methods for zero-touch capture
 *    - MutationObserver monitoring DOM track metadata (#nowTitle, #nowArtist, #playIcon, etc.)
 * 3. Optimized Cover Art Generator:
 *    - Offscreen 160x160 canvas exporting JPEG Data URL
 *    - Source URL and dimensions hash caching to eliminate redundant redraws
 * 4. Inbound Controls:
 *    - toggle, play, pause, prev, next, seek (seconds / percentage), volume, muted, theme
 * 5. Outbound Handshake & Telemetry:
 *    - Emits { nexus: 'ready' } on boot
 *    - Emits { nexus: 'nowPlaying' } whenever state mutates or on request
 */

(() => {
  'use strict';

  // Guard against duplicate execution
  if (typeof window !== 'undefined' && window.__nexusBridgeLoaded) {
    return;
  }
  if (typeof window !== 'undefined') {
    window.__nexusBridgeLoaded = true;
  }

  /* ================= 1. Configuration & Constants ================= */
  const APP_NAME = 'glassplayer';
  const APP_VERSION = '7.7.1-r1';
  const TIMEUPDATE_THROTTLE_MS = 250;
  const HEARTBEAT_INTERVAL_MS = 500;
  const COVER_SIZE = 160;
  const COVER_QUALITY = 0.85;

  /* ================= 2. State & Caches ================= */
  const trackedMediaElements = new Set();
  let primaryAudioElement = null;

  function getActiveMediaElement() {
    for (const el of trackedMediaElements) {
      if (el && !el.paused && !el.ended) {
        return el;
      }
    }
    return primaryAudioElement;
  }

  // Cached cover art
  let offscreenCanvas = null;
  let cachedCoverHash = '';
  let cachedCoverDataUrl = '';

  // Telemetry broadcast state
  let lastBroadcastDigest = '';
  let lastTimeUpdateTimestamp = 0;
  let trailingBroadcastTimer = null;

  function scheduleTrailingBroadcast(delay = 50) {
    if (trailingBroadcastTimer) {
      clearTimeout(trailingBroadcastTimer);
    }
    trailingBroadcastTimer = setTimeout(() => {
      trailingBroadcastTimer = null;
      broadcastNowPlaying(true);
    }, delay);
  }

  // DOM Helpers
  const $ = (selector) => (typeof document !== 'undefined' ? document.querySelector(selector) : null);

  /* ================= 3. Universal Transport Layer ================= */
  let broadcastChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel('nexus-media');
      broadcastChannel.onmessage = (event) => {
        if (event && event.data) {
          handleInbound(event.data);
        }
      };
    }
  } catch (err) {
    console.warn('[NexusBridge] BroadcastChannel init error:', err);
  }

  // Window message listener (parent, opener, same-origin)
  if (typeof window !== 'undefined') {
    window.addEventListener('message', (event) => {
      if (event && event.data) {
        handleInbound(event.data);
      }
    });

    // Electron Preload / IPC Hooks if exposed
    if (window.nexusMediaBridge) {
      if (typeof window.nexusMediaBridge.onMediaControl === 'function') {
        window.nexusMediaBridge.onMediaControl((action) => {
          handleInbound(typeof action === 'object' ? action : { action });
        });
      }
      if (typeof window.nexusMediaBridge.onThemeSync === 'function') {
        window.nexusMediaBridge.onThemeSync((theme) => {
          handleInbound({ nexus: 'theme', theme });
        });
      }
    }

    if (window.electronAPI && typeof window.electronAPI.on === 'function') {
      window.electronAPI.on('nexus-media-control', (action) => {
        handleInbound(typeof action === 'object' ? action : { action });
      });
      window.electronAPI.on('nexus-theme-sync', (theme) => {
        handleInbound({ nexus: 'theme', theme });
      });
    }
  }

  /**
   * Broadcast a payload to all available transports
   */
  function broadcast(data) {
    if (!data || typeof data !== 'object') return;

    // 1. BroadcastChannel('nexus-media')
    try {
      if (broadcastChannel) {
        broadcastChannel.postMessage(data);
      }
    } catch (_) {}

    // 2. window.parent.postMessage (if inside iframe)
    try {
      if (typeof window !== 'undefined' && window.parent && window.parent !== window) {
        window.parent.postMessage(data, '*');
      }
    } catch (_) {}

    // 3. window.opener.postMessage (if opened via window.open)
    try {
      if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
        window.opener.postMessage(data, '*');
      }
    } catch (_) {}

    // 4. Electron Preload Bridges
    try {
      if (typeof window !== 'undefined') {
        // window.nexusMediaBridge
        if (window.nexusMediaBridge && typeof window.nexusMediaBridge.reportNowPlaying === 'function') {
          if (data.nexus === 'nowPlaying') {
            window.nexusMediaBridge.reportNowPlaying(data);
          }
        }

        // window.electronAPI
        if (window.electronAPI) {
          if (typeof window.electronAPI.send === 'function') {
            window.electronAPI.send('nexus-media', data);
          }
          if (data.nexus === 'nowPlaying' && typeof window.electronAPI.reportNowPlaying === 'function') {
            window.electronAPI.reportNowPlaying(data);
          }
        }

        // window.ipcRenderer
        if (window.ipcRenderer && typeof window.ipcRenderer.send === 'function') {
          if (data.nexus === 'nowPlaying') {
            window.ipcRenderer.send('nexus:now-playing-update', data);
          }
          window.ipcRenderer.send('nexus-media', data);
        }

        // window.nexusStorage fallback
        if (window.nexusStorage && typeof window.nexusStorage.setItem === 'function') {
          if (data.nexus === 'nowPlaying') {
            window.nexusStorage.setItem('nexus-media-status', JSON.stringify(data));
          }
        }
      }
    } catch (_) {}
  }

  /* ================= 4. Optimized Cover Art Generator ================= */

  /**
   * Generates a 160x160 JPEG Data URL from the current active cover element.
   * Utilizes source URL and natural dimension hashing to eliminate redundant redraws.
   */
  function getOptimizedCoverDataUrl() {
    if (typeof document === 'undefined') return '';

    // Find the current active cover element in Glass Player
    const candidateImages = [$('#staticCover'), $('#rotorCover')];
    const img = candidateImages.find((el) => {
      return el && el.naturalWidth > 0 && (el.getAttribute('src') || el.src);
    });

    if (!img) {
      cachedCoverHash = '';
      cachedCoverDataUrl = '';
      return '';
    }

    const currentSrc = img.currentSrc || img.src || '';
    const hash = `${currentSrc}#${img.naturalWidth}x${img.naturalHeight}`;

    if (hash === cachedCoverHash && cachedCoverDataUrl) {
      return cachedCoverDataUrl;
    }

    try {
      if (!offscreenCanvas) {
        offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = COVER_SIZE;
        offscreenCanvas.height = COVER_SIZE;
      }

      const ctx = offscreenCanvas.getContext('2d', { alpha: false });
      if (ctx) {
        // Dark background filler
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, COVER_SIZE, COVER_SIZE);

        // Aspect-ratio cover centering
        const nw = img.naturalWidth || COVER_SIZE;
        const nh = img.naturalHeight || COVER_SIZE;
        const scale = Math.max(COVER_SIZE / nw, COVER_SIZE / nh);
        const dw = nw * scale;
        const dh = nh * scale;
        const dx = (COVER_SIZE - dw) / 2;
        const dy = (COVER_SIZE - dh) / 2;

        ctx.drawImage(img, dx, dy, dw, dh);
        cachedCoverDataUrl = offscreenCanvas.toDataURL('image/jpeg', COVER_QUALITY);
        cachedCoverHash = hash;
      }
    } catch (err) {
      // Possible cross-origin taint or canvas export exception
      cachedCoverDataUrl = '';
      cachedCoverHash = hash;
    }

    return cachedCoverDataUrl;
  }

  /* ================= 5. Time Utilities ================= */

  function parseDurationString(str) {
    if (!str || typeof str !== 'string') return 0;
    const parts = str.trim().split(':').map(Number);
    if (parts.some(isNaN)) return 0;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  }

  /* ================= 6. State Assembly & Telemetry ================= */

  function getNowPlayingState() {
    const titleEl = $('#nowTitle');
    const artistEl = $('#nowArtist');
    const playIconEl = $('#playIcon');
    const curTimeEl = $('#curTime');
    const durTimeEl = $('#durTime');
    const seekEl = $('#seek');
    const volEl = $('#vol');

    const activeEl = getActiveMediaElement();
    if (activeEl) {
      primaryAudioElement = activeEl;
    }

    const title = (titleEl ? titleEl.textContent : '').trim();
    const artist = (artistEl ? artistEl.textContent : '').trim();
    const cur = (curTimeEl ? curTimeEl.textContent : '0:00').trim();
    const dur = (durTimeEl ? durTimeEl.textContent : '0:00').trim();

    // Determine playing status
    // In Glass Player:
    // - activeEl !paused && !ended
    // - #playIcon contains <rect> pause bars when playing, <path> triangle when paused
    // - window.GP.core.audio.getState().isPlaying
    let playing = false;
    if (activeEl && !activeEl.paused && !activeEl.ended) {
      playing = true;
    } else if (playIconEl && /<rect/i.test(playIconEl.innerHTML)) {
      playing = true;
    } else if (typeof window !== 'undefined' && window.GP?.core?.audio?.getState?.()) {
      playing = Boolean(window.GP.core.audio.getState().isPlaying);
    }

    const loaded = dur !== '0:00' && dur !== '';

    // Numerical seconds
    const durationSeconds = (primaryAudioElement && !isNaN(primaryAudioElement.duration) && primaryAudioElement.duration > 0)
      ? primaryAudioElement.duration
      : parseDurationString(dur);

    // Calculate normalized progress (0..1)
    let pos = 0;
    if (primaryAudioElement && durationSeconds > 0 && !isNaN(primaryAudioElement.currentTime)) {
      pos = primaryAudioElement.currentTime / durationSeconds;
    } else if (seekEl && +seekEl.max > 0) {
      pos = (+seekEl.value) / (+seekEl.max);
    }
    pos = Math.max(0, Math.min(1, isNaN(pos) ? 0 : pos));

    const currentSeconds = (primaryAudioElement && !isNaN(primaryAudioElement.currentTime))
      ? primaryAudioElement.currentTime
      : (durationSeconds > 0 ? pos * durationSeconds : parseDurationString(cur));

    // Volume & Mute
    let volume = 1;
    let muted = false;
    if (volEl) {
      const parsedVol = parseFloat(volEl.value);
      volume = !isNaN(parsedVol) ? parsedVol : 1;
    } else if (primaryAudioElement) {
      volume = primaryAudioElement.volume;
    }

    if (primaryAudioElement) {
      muted = primaryAudioElement.muted || volume === 0;
    } else {
      muted = volume === 0;
    }

    const cover = getOptimizedCoverDataUrl();

    return {
      nexus: 'nowPlaying',
      app: APP_NAME,
      title,
      artist,
      cover,
      playing,
      loaded,
      cur,
      dur,
      pos,
      currentTime: Math.round(currentSeconds * 100) / 100,
      duration: Math.round(durationSeconds * 100) / 100,
      volume: Math.round(volume * 100) / 100,
      muted,
      timestamp: Date.now()
    };
  }

  function broadcastNowPlaying(force = false) {
    const state = getNowPlayingState();
    const digest = `${state.title}|${state.artist}|${state.playing}|${state.loaded}|${state.cur}|${state.dur}|${Math.round(state.currentTime * 2)}|${Math.round(state.pos * 500)}|${state.volume}|${state.muted}|${state.cover ? state.cover.length : 0}`;

    if (!force && digest === lastBroadcastDigest) {
      return;
    }
    lastBroadcastDigest = digest;
    broadcast(state);
  }

  function broadcastReady() {
    broadcast({
      nexus: 'ready',
      app: APP_NAME,
      version: APP_VERSION,
      capabilities: ['telemetry', 'controls', 'coverArt', 'theme'],
      timestamp: Date.now()
    });
  }

  /* ================= 7. Audio Telemetry & Media Hooks ================= */

  function registerAudioElement(el) {
    if (!el || !(el instanceof HTMLMediaElement) || trackedMediaElements.has(el)) return;
    trackedMediaElements.add(el);

    if (!primaryAudioElement || !el.paused || el.currentTime > 0) {
      primaryAudioElement = el;
    }

    const immediateEvents = ['play', 'pause', 'ended', 'volumechange', 'seeked', 'loadedmetadata', 'ratechange'];
    immediateEvents.forEach((evtName) => {
      el.addEventListener(evtName, () => {
        if (evtName === 'play') {
          primaryAudioElement = el;
        } else {
          const active = getActiveMediaElement();
          primaryAudioElement = active || el;
        }
        broadcastNowPlaying(true);
      }, { passive: true });
    });

    el.addEventListener('timeupdate', () => {
      if (!el.paused || !primaryAudioElement || primaryAudioElement.paused) {
        primaryAudioElement = el;
      }
      const now = performance.now();
      if (now - lastTimeUpdateTimestamp >= TIMEUPDATE_THROTTLE_MS) {
        lastTimeUpdateTimestamp = now;
        broadcastNowPlaying(false);
      }
    }, { passive: true });
  }

  function hookAudioPrototypes() {
    if (typeof HTMLMediaElement === 'undefined') return;

    // 1. Intercept HTMLMediaElement.prototype.play / pause
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function(...args) {
      registerAudioElement(this);
      primaryAudioElement = this;
      return origPlay.apply(this, args);
    };

    const origPause = HTMLMediaElement.prototype.pause;
    HTMLMediaElement.prototype.pause = function(...args) {
      registerAudioElement(this);
      return origPause.apply(this, args);
    };

    // 2. Intercept HTMLMediaElement.prototype.addEventListener
    const origAddEventListener = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function(type, listener, options) {
      registerAudioElement(this);
      return origAddEventListener.call(this, type, listener, options);
    };

    // 3. Intercept window.Audio constructor
    if (typeof window !== 'undefined' && typeof window.Audio === 'function') {
      const OrigAudio = window.Audio;
      window.Audio = function(...args) {
        const instance = new OrigAudio(...args);
        registerAudioElement(instance);
        return instance;
      };
      window.Audio.prototype = OrigAudio.prototype;
    }

    // 4. Intercept AudioContext.createMediaElementSource
    const hookAudioContext = (CtxClass) => {
      if (!CtxClass || !CtxClass.prototype) return;
      const origCreateSource = CtxClass.prototype.createMediaElementSource;
      if (typeof origCreateSource === 'function') {
        CtxClass.prototype.createMediaElementSource = function(mediaElement) {
          registerAudioElement(mediaElement);
          return origCreateSource.call(this, mediaElement);
        };
      }
    };
    if (typeof window !== 'undefined') {
      hookAudioContext(window.AudioContext);
      hookAudioContext(window.webkitAudioContext);
    }

    // 5. Intercept document.createElement('audio')
    if (typeof document !== 'undefined') {
      const origCreateElement = document.createElement;
      document.createElement = function(tagName, options) {
        const el = origCreateElement.call(this, tagName, options);
        if (el instanceof HTMLMediaElement) {
          registerAudioElement(el);
        }
        return el;
      };
    }
  }

  /* ================= 8. DOM Mutation Observer ================= */

  function setupDomMutationObserver() {
    if (typeof document === 'undefined') return;

    const targetSelectors = [
      '#nowTitle',
      '#nowArtist',
      '#durTime',
      '#curTime',
      '#playIcon',
      '#staticCover',
      '#rotorCover',
      '#discRotor'
    ];

    const observer = new MutationObserver(() => {
      broadcastNowPlaying();
    });

    const observedNodes = new Set();
    function attachToTargets() {
      targetSelectors.forEach((sel) => {
        const el = document.querySelector(sel);
        if (el && !observedNodes.has(el)) {
          observedNodes.add(el);
          observer.observe(el, {
            childList: true,
            characterData: true,
            attributes: true,
            subtree: true
          });
        }
      });
    }

    attachToTargets();

    // Re-check targets when body content mutates
    const onBodyAvailable = () => {
      attachToTargets();
      if (document.body) {
        const bodyObserver = new MutationObserver(() => {
          attachToTargets();
        });
        bodyObserver.observe(document.body, { childList: true, subtree: true });
      }
    };

    if (document.body) {
      onBodyAvailable();
    } else {
      document.addEventListener('DOMContentLoaded', onBodyAvailable);
    }
  }

  /* ================= 9. Inbound Controls Handler ================= */

  function setTheme(theme) {
    if (typeof theme !== 'string') return;
    const t = theme.toLowerCase().trim();
    if (t !== 'light' && t !== 'dark' && t !== 'auto') return;

    const btn = document.querySelector(`#themeSeg [data-v="${t}"]`);
    if (btn) {
      btn.click();
    } else if (document.body) {
      document.body.setAttribute('data-theme', t);
      if (t === 'dark') {
        document.body.classList.add('dark');
        document.body.classList.remove('light');
      } else if (t === 'light') {
        document.body.classList.add('light');
        document.body.classList.remove('dark');
      }
    }
  }

  function handleSeek(payload) {
    const currentState = getNowPlayingState();
    const duration = currentState.duration || 0;

    let targetRatio = null;
    let targetSeconds = null;

    if (typeof payload.seconds === 'number') targetSeconds = payload.seconds;
    else if (typeof payload.time === 'number') targetSeconds = payload.time;
    else if (typeof payload.pos === 'number') targetRatio = payload.pos;
    else if (typeof payload.percent === 'number') targetRatio = payload.percent > 1 ? payload.percent / 100 : payload.percent;
    else if (typeof payload.percentage === 'number') targetRatio = payload.percentage > 1 ? payload.percentage / 100 : payload.percentage;
    else if (typeof payload.value === 'number') {
      if (payload.value <= 1) {
        targetRatio = payload.value;
      } else if (duration > 0 && payload.value <= duration) {
        targetSeconds = payload.value;
      } else {
        targetRatio = payload.value / 1000;
      }
    }

    if (targetRatio !== null && targetSeconds === null) {
      targetRatio = Math.max(0, Math.min(1, targetRatio));
      targetSeconds = targetRatio * duration;
    } else if (targetSeconds !== null && targetRatio === null) {
      targetSeconds = Math.max(0, duration > 0 ? Math.min(duration, targetSeconds) : targetSeconds);
      targetRatio = duration > 0 ? targetSeconds / duration : 0;
    }

    if (targetSeconds !== null && targetRatio !== null) {
      const activeEl = getActiveMediaElement() || primaryAudioElement;
      if (activeEl) {
        try {
          activeEl.currentTime = targetSeconds;
        } catch (_) {}
      }
      const seekEl = document.getElementById('seek');
      if (seekEl) {
        seekEl.value = Math.round(targetRatio * 1000);
        seekEl.style.setProperty('--seek-pct', (targetRatio * 100) + '%');
        seekEl.dispatchEvent(new Event('input', { bubbles: true }));
        seekEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      scheduleTrailingBroadcast(50);
    }
  }

  function handleVolume(payload) {
    let vol = payload.volume ?? payload.value ?? payload.level;
    if (typeof vol === 'number') {
      if (vol > 1) vol = vol / 100;
      vol = Math.max(0, Math.min(1, vol));

      const volEl = document.getElementById('vol');
      if (volEl) {
        volEl.value = vol;
        volEl.style.setProperty('--vol-pct', (vol * 100) + '%');
        volEl.dispatchEvent(new Event('input', { bubbles: true }));
        volEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const activeEl = getActiveMediaElement() || primaryAudioElement;
      if (activeEl) {
        try {
          activeEl.volume = vol;
        } catch (_) {}
      }
      scheduleTrailingBroadcast(50);
    }
  }

  function handleMuted(payload) {
    const volEl = document.getElementById('vol');
    const volIcon = document.getElementById('volIcon');
    const activeEl = getActiveMediaElement() || primaryAudioElement;
    const targetMuted = typeof payload.muted === 'boolean'
      ? payload.muted
      : (typeof payload.value === 'boolean' ? payload.value : null);

    if (targetMuted !== null) {
      const currentVol = volEl ? parseFloat(volEl.value) : (activeEl ? activeEl.volume : 1);
      const isMuted = currentVol === 0 || (activeEl && activeEl.muted);
      if (targetMuted !== isMuted) {
        if (volIcon) {
          volIcon.click();
        } else if (activeEl) {
          activeEl.muted = targetMuted;
        }
      }
    } else {
      if (volIcon) {
        volIcon.click();
      } else if (activeEl) {
        activeEl.muted = !activeEl.muted;
      }
    }
    scheduleTrailingBroadcast(50);
  }

  function handleInbound(msg) {
    if (!msg || typeof msg !== 'object') return;

    // 1. Theme sync
    if (msg.nexus === 'theme' || msg.action === 'theme' || msg.type === 'theme') {
      const theme = msg.theme || msg.value;
      if (theme) setTheme(theme);
      return;
    }

    // 2. Telemetry handshake or query
    if (
      msg.nexus === 'query' ||
      msg.action === 'query' ||
      msg.action === 'getNowPlaying' ||
      msg.action === 'status' ||
      msg.action === 'handshake' ||
      msg.action === 'ping' ||
      msg.type === 'ping' ||
      msg.type === 'query'
    ) {
      broadcastReady();
      broadcastNowPlaying(true);
      return;
    }

    // 3. Playback Controls
    let action = msg.action || msg.command || msg.type;
    if (!action && typeof msg.nexus === 'string' && msg.nexus !== 'control') {
      action = msg.nexus;
    } else if (msg.nexus === 'control' && !action) {
      action = msg.action;
    }
    if (!action) return;

    switch (action) {
      case 'toggle': {
        const playBtn = document.getElementById('playBtn');
        const activeEl = getActiveMediaElement() || primaryAudioElement;
        if (playBtn) {
          playBtn.click();
        } else if (window.GP?.core?.audio?.toggle) {
          window.GP.core.audio.toggle();
        } else if (activeEl) {
          activeEl.paused ? activeEl.play() : activeEl.pause();
        }
        scheduleTrailingBroadcast(50);
        break;
      }

      case 'play': {
        const state = getNowPlayingState();
        const activeEl = getActiveMediaElement() || primaryAudioElement;
        if (!state.playing) {
          const playBtn = document.getElementById('playBtn');
          if (playBtn) {
            playBtn.click();
          } else if (window.GP?.core?.audio?.play) {
            window.GP.core.audio.play();
          } else if (activeEl) {
            activeEl.play();
          }
        }
        scheduleTrailingBroadcast(50);
        break;
      }

      case 'pause': {
        const state = getNowPlayingState();
        const activeEl = getActiveMediaElement() || primaryAudioElement;
        if (state.playing) {
          const playBtn = document.getElementById('playBtn');
          if (playBtn) {
            playBtn.click();
          } else if (window.GP?.core?.audio?.pause) {
            window.GP.core.audio.pause();
          } else if (activeEl) {
            activeEl.pause();
          }
        }
        scheduleTrailingBroadcast(50);
        break;
      }

      case 'prev':
      case 'previous': {
        const prevBtn = document.getElementById('prevBtn');
        if (prevBtn) {
          prevBtn.click();
        } else if (window.GP?.core?.audio?.previous) {
          window.GP.core.audio.previous();
        }
        scheduleTrailingBroadcast(50);
        break;
      }

      case 'next': {
        const nextBtn = document.getElementById('nextBtn');
        if (nextBtn) {
          nextBtn.click();
        } else if (window.GP?.core?.audio?.next) {
          window.GP.core.audio.next();
        }
        scheduleTrailingBroadcast(50);
        break;
      }

      case 'seek': {
        handleSeek(msg);
        break;
      }

      case 'volume': {
        handleVolume(msg);
        break;
      }

      case 'muted':
      case 'mute': {
        handleMuted(msg);
        break;
      }

      case 'theme': {
        const theme = msg.theme || msg.value;
        if (theme) setTheme(theme);
        break;
      }
    }
  }

  /* ================= 10. Initialization ================= */

  // Hook prototypes immediately
  hookAudioPrototypes();

  // Setup DOM Mutation Observer
  setupDomMutationObserver();

  // Apply URL ?theme= parameter if present on load
  try {
    if (typeof window !== 'undefined' && window.location) {
      const q = new URLSearchParams(window.location.search);
      const initialTheme = q.get('theme');
      if (initialTheme) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => setTheme(initialTheme));
        } else {
          setTheme(initialTheme);
        }
      }
    }
  } catch (_) {}

  // Periodic heartbeat polling to ensure remote widgets never desync
  const heartbeatTimer = setInterval(() => {
    broadcastNowPlaying(false);
  }, HEARTBEAT_INTERVAL_MS);
  if (heartbeatTimer && typeof heartbeatTimer.unref === 'function') {
    heartbeatTimer.unref();
  }

  // Broadcast initial handshake and state
  broadcastReady();
  broadcastNowPlaying(true);

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      broadcastReady();
      broadcastNowPlaying(true);
    });
    window.addEventListener('load', () => {
      broadcastReady();
      broadcastNowPlaying(true);
    });
  }

  /* ================= 11. Public Export ================= */
  const PublicAPI = {
    appName: APP_NAME,
    version: APP_VERSION,
    broadcast,
    broadcastReady,
    broadcastNowPlaying,
    getNowPlayingState,
    handleControl: handleInbound,
    setTheme,
    getOptimizedCoverDataUrl,
    channel: broadcastChannel
  };

  if (typeof window !== 'undefined') {
    window.NexusBridge = PublicAPI;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PublicAPI;
  }
})();
