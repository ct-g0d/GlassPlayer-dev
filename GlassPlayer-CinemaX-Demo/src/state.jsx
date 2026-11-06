import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import {
  ACCENTS,
  DAILY_MIX_IDS,
  DEFAULT_PREFS,
  FAVORITE_IDS,
  INITIAL_CURRENT_ID,
  INITIAL_QUEUE,
  TRACKS,
  TRACK_BY_ID,
} from './data/mock.js';

const AppContext = createContext(null);

const initialState = {
  tab: 'now-playing',
  collapsed: false,
  settingsOpen: false,
  settingsSection: 'appearance',
  toast: null,
  prefs: { ...DEFAULT_PREFS },
  currentId: INITIAL_CURRENT_ID,
  isPlaying: true,
  position: 42,
  volume: 0.72,
  muted: false,
  mode: 'sequential',
  queue: [...INITIAL_QUEUE],
  queueTab: 'queue',
  likes: [...FAVORITE_IDS],
  libraryQuery: '',
  libraryFilter: 'all',
  libraryFolder: null,
  librarySort: 'original',
  libraryView: 'list',
  historyMode: 'time',
  historyRange: 'week',
};

function nextTrackId(state) {
  if (state.mode === 'shuffle') {
    const pool = TRACKS.filter((track) => track.id !== state.currentId);
    return pool[Math.floor(Math.random() * pool.length)].id;
  }
  if (state.queue.length > 0) return state.queue[0];
  const index = TRACKS.findIndex((track) => track.id === state.currentId);
  return TRACKS[(index + 1) % TRACKS.length].id;
}

function advance(state) {
  const nextId = nextTrackId(state);
  const usedQueue = state.mode !== 'shuffle' && state.queue[0] === nextId;
  return {
    ...state,
    currentId: nextId,
    position: 0,
    queue: usedQueue ? state.queue.slice(1) : state.queue,
  };
}

function reducer(state, action) {
  switch (action.type) {
    case 'TICK': {
      const track = TRACK_BY_ID[state.currentId];
      const next = state.position + action.delta * (state.prefs.playbackRate || 1);
      if (next < track.duration) return { ...state, position: next };
      if (state.mode === 'repeat-one') return { ...state, position: 0 };
      return advance({ ...state, isPlaying: true });
    }
    case 'SET_TAB':
      return { ...state, tab: action.tab };
    case 'TOGGLE_SIDEBAR':
      return { ...state, collapsed: !state.collapsed };
    case 'SET_THEME':
      return { ...state, prefs: { ...state.prefs, theme: action.theme } };
    case 'SET_ACCENT':
      return { ...state, prefs: { ...state.prefs, accent: action.accent } };
    case 'SET_PREFS':
      return { ...state, prefs: { ...state.prefs, ...action.patch } };
    case 'OPEN_SETTINGS':
      return { ...state, settingsOpen: true, settingsSection: action.section ?? state.settingsSection };
    case 'CLOSE_SETTINGS':
      return { ...state, settingsOpen: false };
    case 'SET_SETTINGS_SECTION':
      return { ...state, settingsSection: action.section };
    case 'PLAY_TRACK':
      return {
        ...state,
        currentId: action.id,
        position: 0,
        isPlaying: true,
        tab: 'now-playing',
        queue: state.queue.filter((id) => id !== action.id),
      };
    case 'TOGGLE_PLAY': {
      const track = TRACK_BY_ID[state.currentId];
      if (!state.isPlaying && state.position >= track.duration - 0.05) {
        return { ...state, isPlaying: true, position: 0 };
      }
      return { ...state, isPlaying: !state.isPlaying };
    }
    case 'NEXT':
      return advance(state);
    case 'PREV': {
      if (state.position > 4) return { ...state, position: 0 };
      const index = TRACKS.findIndex((track) => track.id === state.currentId);
      const prev = TRACKS[(index - 1 + TRACKS.length) % TRACKS.length];
      return { ...state, currentId: prev.id, position: 0 };
    }
    case 'SEEK': {
      const track = TRACK_BY_ID[state.currentId];
      return { ...state, position: Math.max(0, Math.min(track.duration, action.position)) };
    }
    case 'SET_VOLUME':
      return { ...state, volume: Math.max(0, Math.min(1, action.value)), muted: false };
    case 'TOGGLE_MUTE':
      return { ...state, muted: !state.muted };
    case 'CYCLE_MODE': {
      const order = ['sequential', 'shuffle', 'repeat-one'];
      const mode = order[(order.indexOf(state.mode) + 1) % order.length];
      return { ...state, mode, toast: { id: Date.now(), text: `Playback mode: ${modeLabel(mode)}` } };
    }
    case 'SET_MODE':
      return { ...state, mode: action.mode };
    case 'SET_QUEUE_TAB':
      return { ...state, queueTab: action.tab };
    case 'ADD_TO_QUEUE': {
      if (action.id === state.currentId || state.queue.includes(action.id)) {
        return { ...state, toast: { id: Date.now(), text: 'Already in the queue' } };
      }
      return {
        ...state,
        queue: [...state.queue, action.id],
        toast: { id: Date.now(), text: `Queued “${TRACK_BY_ID[action.id].title}”` },
      };
    }
    case 'REMOVE_FROM_QUEUE':
      return { ...state, queue: state.queue.filter((id) => id !== action.id) };
    case 'CLEAR_QUEUE':
      return {
        ...state,
        queue: [],
        toast: { id: Date.now(), text: 'Queue cleared' },
      };
    case 'TOGGLE_LIKE': {
      const liked = state.likes.includes(action.id);
      return {
        ...state,
        likes: liked ? state.likes.filter((id) => id !== action.id) : [...state.likes, action.id],
        toast: { id: Date.now(), text: liked ? 'Removed from favorites' : 'Added to favorites' },
      };
    }
    case 'SET_LIBRARY_QUERY':
      return { ...state, libraryQuery: action.value };
    case 'SET_LIBRARY_FILTER':
      return { ...state, libraryFilter: action.value };
    case 'SET_LIBRARY_FOLDER':
      return { ...state, libraryFolder: action.value };
    case 'SET_LIBRARY_SORT':
      return { ...state, librarySort: action.value };
    case 'SET_LIBRARY_VIEW':
      return { ...state, libraryView: action.value };
    case 'SET_HISTORY_MODE':
      return { ...state, historyMode: action.value };
    case 'SET_HISTORY_RANGE':
      return { ...state, historyRange: action.value };
    case 'SHOW_TOAST':
      return { ...state, toast: { id: Date.now(), text: action.text } };
    case 'CLEAR_TOAST':
      return { ...state, toast: null };
    default:
      return state;
  }
}

function modeLabel(mode) {
  if (mode === 'shuffle') return 'Shuffle';
  if (mode === 'repeat-one') return 'Repeat one';
  return 'Sequential';
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    if (!state.isPlaying) return undefined;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const delta = Math.min(1.5, (now - last) / 1000);
      last = now;
      dispatch({ type: 'TICK', delta });
    }, 250);
    return () => window.clearInterval(timer);
  }, [state.isPlaying]);

  useEffect(() => {
    if (!state.toast) return undefined;
    const timer = window.setTimeout(() => dispatch({ type: 'CLEAR_TOAST' }), 2400);
    return () => window.clearTimeout(timer);
  }, [state.toast?.id]);

  const actions = useMemo(
    () => ({
      setTab: (tab) => dispatch({ type: 'SET_TAB', tab }),
      toggleSidebar: () => dispatch({ type: 'TOGGLE_SIDEBAR' }),
      setTheme: (theme) => dispatch({ type: 'SET_THEME', theme }),
      setAccent: (accent) => dispatch({ type: 'SET_ACCENT', accent }),
      setPrefs: (patch) => dispatch({ type: 'SET_PREFS', patch }),
      openSettings: (section) => dispatch({ type: 'OPEN_SETTINGS', section }),
      closeSettings: () => dispatch({ type: 'CLOSE_SETTINGS' }),
      setSettingsSection: (section) => dispatch({ type: 'SET_SETTINGS_SECTION', section }),
      playTrack: (id) => dispatch({ type: 'PLAY_TRACK', id }),
      togglePlay: () => dispatch({ type: 'TOGGLE_PLAY' }),
      next: () => dispatch({ type: 'NEXT' }),
      prev: () => dispatch({ type: 'PREV' }),
      seek: (position) => dispatch({ type: 'SEEK', position }),
      setVolume: (value) => dispatch({ type: 'SET_VOLUME', value }),
      toggleMute: () => dispatch({ type: 'TOGGLE_MUTE' }),
      cycleMode: () => dispatch({ type: 'CYCLE_MODE' }),
      setMode: (mode) => dispatch({ type: 'SET_MODE', mode }),
      setQueueTab: (tab) => dispatch({ type: 'SET_QUEUE_TAB', tab }),
      addToQueue: (id) => dispatch({ type: 'ADD_TO_QUEUE', id }),
      removeFromQueue: (id) => dispatch({ type: 'REMOVE_FROM_QUEUE', id }),
      clearQueue: () => dispatch({ type: 'CLEAR_QUEUE' }),
      toggleLike: (id) => dispatch({ type: 'TOGGLE_LIKE', id }),
      setLibraryQuery: (value) => dispatch({ type: 'SET_LIBRARY_QUERY', value }),
      setLibraryFilter: (value) => dispatch({ type: 'SET_LIBRARY_FILTER', value }),
      setLibraryFolder: (value) => dispatch({ type: 'SET_LIBRARY_FOLDER', value }),
      setLibrarySort: (value) => dispatch({ type: 'SET_LIBRARY_SORT', value }),
      setLibraryView: (value) => dispatch({ type: 'SET_LIBRARY_VIEW', value }),
      setHistoryMode: (value) => dispatch({ type: 'SET_HISTORY_MODE', value }),
      setHistoryRange: (value) => dispatch({ type: 'SET_HISTORY_RANGE', value }),
      toast: (text) => dispatch({ type: 'SHOW_TOAST', text }),
    }),
    [],
  );

  const accent = ACCENTS.find((item) => item.id === state.prefs.accent) ?? ACCENTS[0];
  const value = useMemo(
    () => ({
      state,
      actions,
      accent,
      currentTrack: TRACK_BY_ID[state.currentId],
      mixTracks: DAILY_MIX_IDS.map((id) => TRACK_BY_ID[id]),
      queueTracks: state.queue.map((id) => TRACK_BY_ID[id]),
      isLiked: (id) => state.likes.includes(id),
    }),
    [state, actions, accent],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
