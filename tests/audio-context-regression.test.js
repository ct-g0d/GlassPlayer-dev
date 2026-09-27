const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const audioSource = fs.readFileSync(path.join(root, "src/engines/audio-engine.js"), "utf8");
const sourceEnd = audioSource.indexOf("\n  let miniEqFrame");
assert.notEqual(sourceEnd, -1, "audio context source boundary is present");

const metrics = {constructors:0,connections:0,gainWrites:0,resumes:0,decodes:0,context:null};
class FakeNode {
  constructor(){
    this.gain={get value(){return 1;},set value(value){void value;metrics.gainWrites++;}};
  }
  connect(){metrics.connections++;}
}
class FakeAudioContext {
  constructor(){metrics.constructors++;this.state="suspended";this.destination={};this.currentTime=0;this.sampleRate=48000;metrics.context=this;}
  createGain(){return new FakeNode();}
  createAnalyser(){return new FakeNode();}
  createMediaElementSource(){return new FakeNode();}
  decodeAudioData(arrayBuffer){metrics.decodes++;return Promise.resolve({arrayBuffer});}
  resume(){metrics.resumes++;this.state="running";return Promise.resolve();}
}

const sandbox = {
  window:{AudioContext:FakeAudioContext},
  decks:[{},{}],
  activeIdx:0,
  $:()=>({value:"0.7"}),
  buildEQFilters:()=>[new FakeNode(),new FakeNode()],
  ensureSpatialEngine:()=>({input:new FakeNode(),output:new FakeNode()}),
  installAudioDiagnostics:()=>{},
  applyCurrentTrackNormalization:()=>{},
  syncAudioHeadroom:()=>{},
  metrics
};
vm.runInNewContext(`let audioCtx=null,mixBus=null,eqHeadroomGain=null,finalOutputTrimGain=null,masterGain=null,outputLimiterBypass=null,analyser=null,deckNormalizationGains=[],deckGains=[];\n${audioSource.slice(audioSource.indexOf("  function ensureAudioCtx("),sourceEnd)}\nglobalThis.ensureAudioCtx=ensureAudioCtx;globalThis.decodeAudioBuffer=decodeAudioBuffer;`,sandbox,{filename:"audio-engine.js"});

async function run(){
  assert.equal(sandbox.ensureAudioCtx(),undefined,"public initialization keeps its void return");
  assert.equal(metrics.constructors,1,"initial graph creates one AudioContext");
  const firstConnections=metrics.connections,firstGainWrites=metrics.gainWrites;
  assert.equal(metrics.context.state,"suspended","fake context starts suspended");
  await sandbox.decodeAudioBuffer(new ArrayBuffer(1));
  assert.equal(metrics.constructors,1,"decode reuses the initialized AudioContext");
  assert.equal(metrics.resumes,0,"decode does not resume a suspended context");
  await sandbox.decodeAudioBuffer(new ArrayBuffer(1));
  assert.equal(metrics.constructors,1,"repeated decode keeps one AudioContext");
  assert.equal(metrics.connections,firstConnections,"repeated decode does not reconnect the graph");
  assert.equal(metrics.gainWrites,firstGainWrites,"repeated decode does not rewrite graph gains");
  assert.equal(metrics.decodes,2,"both decode requests reach the shared context");
  sandbox.ensureAudioCtx();
  assert.equal(metrics.resumes,1,"normal initialization still resumes suspended playback context");
  assert.equal(metrics.context.state,"running","playback context resumes normally");
}

run().then(()=>console.log("PASS audio context regression test"));
