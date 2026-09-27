const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = relative => fs.readFileSync(path.join(root, relative), "utf8");

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.notEqual(from, -1, `missing source section: ${start}`);
  assert.notEqual(to, -1, `missing source section end: ${end}`);
  return text.slice(from, to);
}

function queueHarness(playMode, random = () => 0) {
  const runtime = source("src/services/queue-runtime.js");
  const code = [
    `const playlist=[{id:8},{id:1},{id:0},{id:2},{id:9}];`,
    `let playQueue=[9,1],manualQueueActive=false,playingQueuedTrack=false,queueResumeIndex=null;`,
    `let currentIndex=0,pendingSelectionSource=null;const playModeValue=${JSON.stringify(playMode)};let playMode=playModeValue;`,
    `const loaded=[];function collectionTrackIndices(){return [1,2,3];}function collectionDisplayName(){return "Test";}`,
    `function tr(chinese,english){return english;}function showToast(){}function beginQueuedPlayback(){playingQueuedTrack=true;}`,
    `function loadTrack(index,autoplay){loaded.push({index,autoplay});currentIndex=index;}function renderMiniQueue(){}`,
    `Math.random=${random.toString()};`,
    section(runtime, "  function playCollectionNow(){", "\n  function setLibraryCollectionMode"),
    section(runtime, "  function takeNextQueuedIndex(){", "\n  function beginQueuedPlayback"),
    `globalThis.runCollection=playCollectionNow;globalThis.takeNext=takeNextQueuedIndex;globalThis.state=()=>({playQueue,manualQueueActive,playingQueuedTrack,pendingSelectionSource,currentIndex,loaded});`
  ].join("\n");
  const sandbox = {Math: Object.create(Math)};
  vm.runInNewContext(code, sandbox, {filename: "queue-runtime.js"});
  return sandbox;
}

function testCollectionConsumesSelectedTrackAndKeepsQueueMode() {
  const sequential = queueHarness("sequential");
  sequential.runCollection();
  const state = sequential.state();
  assert.deepEqual(Array.from(state.loaded, item => item.index), [1], "the selected first collection song starts immediately");
  assert.deepEqual(Array.from(state.playQueue), [9, 0, 2], "preexisting queue order is kept, selected track is consumed, and track id zero is retained");
  assert.deepEqual([sequential.takeNext(), sequential.takeNext(), sequential.takeNext()], [4, 2, 3], "sequential mode drains existing songs then remaining collection songs once");

  const shuffled = queueHarness("shuffle", () => 0.999);
  shuffled.runCollection();
  assert.deepEqual(Array.from(shuffled.state().playQueue), [9, 0, 2], "shuffle queue keeps existing songs and excludes the already playing first song");
  assert.deepEqual([shuffled.takeNext(), shuffled.takeNext()], [3, 2], "shuffle mode still chooses from the remaining queue randomly");
}

function testLegacyUndatedSecondsStayInAllTimeTotals() {
  const history = source("src/services/history-service.js");
  const code = [
    section(history, "  function sumSongInRange(", "\n  function sumPlayCountInRange"),
    section(history, "  function dayKeyInRange(", "\n  function sumPlayCountRange")
  ].join("\n");
  const sandbox = {};
  vm.runInNewContext(`${code}\nglobalThis.allTime=sumSongInRange;globalThis.songRange=sumSongRange;`, sandbox, {filename: "history-service.js"});

  const entry = {daily: {"2020-01-01": 30}, legacyUndatedSeconds: 90, totalSeconds: 120};
  assert.equal(sandbox.allTime(entry, Infinity, new Date("2020-01-01T12:00:00")), 120, "all-time total includes dated and legacy undated seconds");
  assert.equal(sandbox.songRange(entry, null), 120, "null range includes legacy undated seconds");
  assert.equal(sandbox.songRange({totalSeconds: 90}, null), 90, "unmigrated legacy totals remain visible");
  assert.equal(sandbox.songRange(entry), 120, "omitted range also means all time");
  assert.equal(sandbox.songRange(entry, {start: new Date("2020-01-01T00:00:00"), end: new Date("2020-01-02T00:00:00")}), 30, "finite calendar ranges remain limited to dated seconds");
}

testCollectionConsumesSelectedTrackAndKeepsQueueMode();
testLegacyUndatedSecondsStayInAllTimeTotals();
console.log("PASS service regression tests");
