const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const loadSource = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

async function settlesWithin(promise, milliseconds) {
  return Promise.race([
    promise.then(() => true),
    sleep(milliseconds).then(() => false)
  ]);
}

async function testYieldDoesNotWaitForVisibleAnimationFrame() {
  const source = `${loadSource("src/services/library-runtime.js")}\nglobalThis.__importPerformance = {yieldToInputPriority};`;
  let animationFrameRequests = 0;
  let schedulerYields = 0;
  const sandbox = {
    Array, Blob, Date, Intl, Map, Math, Promise, Set, String, TextEncoder, Uint8Array, URL, WeakMap,
    console,
    GP: {core: {}},
    GP_RECOGNITION_SCHEMA_VERSION: 1,
    document: {hidden: false, addEventListener() {}},
    navigator: {scheduling: {isInputPending: () => false}},
    performance: {now: () => 0},
    requestAnimationFrame: () => { animationFrameRequests++; },
    scheduler: {yield: async () => { schedulerYields++; }},
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, {filename: "library-runtime.js"});

  const finished = await settlesWithin(sandbox.__importPerformance.yieldToInputPriority(), 40);
  assert.equal(finished, true, "cooperative import yield must complete without a visible rAF callback");
  assert.equal(animationFrameRequests, 0, "cooperative import yield must not request a visible rAF when scheduler.yield exists");
  assert.equal(schedulerYields, 1, "cooperative import yield must prefer scheduler.yield");
}

function createNeuralSandbox() {
  let modelReads = 0;
  let modelWrites = 0;
  let recommendationWrites = 0;
  const recommendList = {
    count: 0,
    style: {},
    set innerHTML(value) { this.count = 0; },
    get innerHTML() { return ""; },
    insertAdjacentHTML() { this.count++; },
    querySelectorAll() { return Array.from({length: this.count}, () => ({})); }
  };
  const button = {style: {}, addEventListener() {}};
  const track = index => ({
    id: `track-${index}`,
    spectrumId: `spectrum-${index}`,
    artist: `Artist ${index}`,
    album: "Album",
    genre: "Pop",
    bpm: 120 + index,
    energy: 0.5,
    mfcc: Array(13).fill(index + 1)
  });
  const sandbox = {
    Array, Date, Map, Math, Promise, Set, String,
    console,
    GP: {utils: {clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))}, genreRelations: null},
    GPDatabase: {
      async getBehaviorEvents() { modelReads++; return []; },
      async saveUserModel() { modelWrites++; },
      async saveRecommendations() { recommendationWrites++; },
      async getUserModel() { return null; },
      async addBehaviorEvent() {}
    },
    audio: {paused: true, ended: false, currentTime: 0, duration: 0, playbackRate: 1},
    playlist: [track(0), track(1), track(2)],
    currentIndex: -1,
    shuffleTimeline: [],
    shuffleTimelineCursor: -1,
    trackKey: track => track.id,
    yieldToInputPriority: async () => Promise.resolve(),
    performance: {now: () => 0},
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    $: selector => selector === "#recommendList" ? recommendList : button,
    trackRowHTML: () => "",
    wireRows() {},
    bindMicroMotion() {},
    renderMiniQueue() {},
    showToast() {},
    tr: (chinese, english) => english,
    takeNextQueuedIndex: () => null,
    beginQueuedPlayback() {},
    loadTrack() {},
    playQueue: [],
    manualQueueActive: false,
    playingQueuedTrack: false,
    queueResumeIndex: null
  };
  sandbox.globalThis = sandbox;
  return {
    sandbox,
    counts: () => ({modelReads, modelWrites, recommendationWrites})
  };
}

async function testImportFinalizationCoalescesNeuralWork() {
  const source = `${loadSource("src/services/neural-runtime.js")}\nglobalThis.__importPerformance = {refreshUserModel, finalizeDailyMixForImport};`;
  const harness = createNeuralSandbox();
  vm.runInNewContext(source, harness.sandbox, {filename: "neural-runtime.js"});

  await Promise.all([
    harness.sandbox.__importPerformance.refreshUserModel(),
    harness.sandbox.__importPerformance.refreshUserModel()
  ]);
  assert.deepEqual(harness.counts(), {modelReads: 1, modelWrites: 1, recommendationWrites: 0}, "overlapping Resonance Boost refreshes must share one build and persistence pass");

  await Promise.all([
    harness.sandbox.__importPerformance.finalizeDailyMixForImport(),
    harness.sandbox.__importPerformance.finalizeDailyMixForImport()
  ]);
  assert.equal(harness.counts().recommendationWrites, 1, "overlapping import finalization must generate and persist Daily Mix once");
}

async function testRememberedFolderUsesOnlyGrantedFileSystemAccess() {
  const registrations = new Map();
  let storedRecord = null;
  let pickerCalls = 0;
  const firstFile = {name: "first.mp3"};
  const secondFile = {name: "second.flac"};
  const nestedDirectory = {kind: "directory", async *values() { yield {kind: "file", async getFile() { return secondFile; }}; }};
  const folderHandle = {
    kind: "directory",
    async queryPermission() { return "granted"; },
    async *values() {
      yield {kind: "file", async getFile() { return firstFile; }};
      yield nestedDirectory;
    }
  };
  const sandbox = {
    GPModules: {register(name, factory) { registrations.set(name, factory); }},
    Promise,
    Array,
    Date,
    Object,
    setTimeout,
    clearTimeout,
    showDirectoryPicker: async () => { pickerCalls++; return folderHandle; }
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(loadSource("src/adapters/browser/file-adapter.js"), sandbox, {filename: "file-adapter.js"});
  const adapter = registrations.get("createBrowserFileAdapter")({
    fileInput: null,
    folderInput: null,
    storage: {
      async getRecommendation() { return storedRecord; },
      async saveRecommendation(record) { storedRecord = record; }
    }
  });

  assert.equal(adapter.supportsPersistedAudioFolder(), true, "adapter must advertise remembered folders only when File System Access and the existing storage port are available");
  assert.deepEqual(Array.from(await adapter.pickAndRememberAudioFolder(), file => file.name), ["first.mp3", "second.flac"], "chosen directory contents must flow through the existing import path");
  assert.equal(pickerCalls, 1, "remembering a folder must require one explicit user picker action");
  assert.equal(storedRecord?.id, "defaultMusicFolder", "the handle must use the existing storage boundary with a stable record id");
  assert.equal(storedRecord?.folderHandle, folderHandle, "the granted directory handle must be persisted without a new schema");
  assert.deepEqual(Array.from(await adapter.restoreRememberedAudioFolder(), file => file.name), ["first.mp3", "second.flac"], "startup may restore only the persisted, already-granted handle");

  storedRecord = {id: "defaultMusicFolder", folderHandle: {...folderHandle, queryPermission: async () => "prompt"}};
  assert.equal(Array.from(await adapter.restoreRememberedAudioFolder()).length, 0, "startup must not request or silently read an ungranted folder");
}

(async () => {
  await testYieldDoesNotWaitForVisibleAnimationFrame();
  await testImportFinalizationCoalescesNeuralWork();
  await testRememberedFolderUsesOnlyGrantedFileSystemAccess();
  console.log("PASS import performance regression tests");
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
