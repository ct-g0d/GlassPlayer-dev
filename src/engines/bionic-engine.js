  /* ================= GP Bionic Engine 1.0 — Intelligence Core =================
     Consolidates track identity recognition, acoustic signal spectrum analysis,
     listening DNA neural modeling, and fusion queue/playlist flow. */
  const GPAnalyzer={
    schemaVersion:GP_FEATURE_SCHEMA_VERSION,
    database:GPDatabase,
    async readCached(contentKey){
      if(!contentKey)return null;
      const record=await this.database.getTrackFeatures(contentKey);
      return record&&record.schemaVersion===this.schemaVersion&&record.spectrumVersion===GP_SPECTRUM_ALGORITHM_VERSION&&record.spectrumStatus==="complete"?record:null;
    },
    createFeatureRecord(track,features){
      const data=features||{};
      return {
        contentKey:track.contentKey,
        spectrumId:track.spectrumId||track.audioEssenceKey||track.contentKey,
        audioEssenceKey:track.audioEssenceKey||track.spectrumId||track.contentKey,
        recognitionSchemaVersion:GP_RECOGNITION_SCHEMA_VERSION,
        metadata:{name:track.name||"",title:track.title||"",artist:track.artist||"",duration:Number(track.duration)||0,genre:track.genre||null,genreSource:track.genreSource||null},
        mfcc:data.mfcc&&Array.isArray(data.mfcc.mean)?{
          mean:data.mfcc.mean.slice(0,13),stdev:Array.isArray(data.mfcc.stdev)?data.mfcc.stdev.slice(0,13):[],frames:Number(data.mfcc.frames)||0,
          sampleRate:Number(data.mfcc.sampleRate)||22050,frameSize:Number(data.mfcc.frameSize)||1024,nMels:Number(data.mfcc.nMels)||40,nMfcc:Number(data.mfcc.nMfcc)||13,
          spectralCentroid:Number.isFinite(data.mfcc.spectralCentroid)?data.mfcc.spectralCentroid:null,
          spectralFlatness:Number.isFinite(data.mfcc.spectralFlatness)?data.mfcc.spectralFlatness:null,
          spectralRolloff:Number.isFinite(data.mfcc.spectralRolloff)?data.mfcc.spectralRolloff:null,
          spectralBandwidth:Number.isFinite(data.mfcc.spectralBandwidth)?data.mfcc.spectralBandwidth:null,
          zeroCrossingRate:Number.isFinite(data.mfcc.zeroCrossingRate)?data.mfcc.zeroCrossingRate:null,
          bassRatio:Number.isFinite(data.mfcc.bassRatio)?data.mfcc.bassRatio:null,midRatio:Number.isFinite(data.mfcc.midRatio)?data.mfcc.midRatio:null,
          highRatio:Number.isFinite(data.mfcc.highRatio)?data.mfcc.highRatio:null,spectralFlux:Number.isFinite(data.mfcc.spectralFlux)?data.mfcc.spectralFlux:null,
          crestFactor:Number.isFinite(data.mfcc.crestFactor)?data.mfcc.crestFactor:null,dynamicRangeDb:Number.isFinite(data.mfcc.dynamicRangeDb)?data.mfcc.dynamicRangeDb:null,
          mfccDelta:Number.isFinite(data.mfcc.mfccDelta)?data.mfcc.mfccDelta:null
        }:null,
        mfccSummary:data.mfccSummary||null,
        mood:data.mood||null,
        inferredGenre:data.inferredGenre||null,
        genreSecondary:data.genreSecondary||null,
        genreScores:Array.isArray(data.genreScores)?data.genreScores.slice(0,3):null,
        genreConfidence:Number.isFinite(data.genreConfidence)?data.genreConfidence:null,
        genreSource:data.genreSource||null,
        energy:Number.isFinite(data.energy)?data.energy:null,
        energyDb:Number.isFinite(data.energyDb)?data.energyDb:null,
        loudnessDb:Number.isFinite(data.loudnessDb)?data.loudnessDb:null,
        normalizationGainDb:Number.isFinite(data.normalizationGainDb)?data.normalizationGainDb:(Number.isFinite(data.loudnessDb)?Math.max(-7,Math.min(7,-18-data.loudnessDb)):null),
        normalizationVersion:1,
        bpm:Number.isFinite(data.bpm)?data.bpm:null,
        bpmConfidence:Number.isFinite(data.bpmConfidence)?data.bpmConfidence:null,
        sampleRate:Number.isFinite(data.sampleRate)?data.sampleRate:null,
        channels:Number.isFinite(data.channels)?data.channels:null,
        peaks:Array.isArray(data.peaks)?data.peaks.slice(0,160):null,
        spectrumVersion:data.spectrumVersion||null,
        spectrumStatus:data.spectrumStatus||null,
        schemaVersion:this.schemaVersion,
        analyzedAt:Date.now()
      };
    },
    save(track,features){
      if(!track||!track.contentKey)return Promise.reject(new Error("Track contentKey is required"));
      return this.database.saveTrackFeatures(this.createFeatureRecord(track,features));
    },
    async saveSpectrum(track,features){
      if(!track||!track.contentKey)throw new Error("Track contentKey is required");
      const existing=await this.database.getTrackFeatures(track.contentKey).catch(()=>null);
      return this.database.saveTrackFeatures(this.createFeatureRecord(track,Object.assign({},existing||{},features||{},{spectrumVersion:GP_SPECTRUM_ALGORITHM_VERSION,spectrumStatus:"complete"})));
    },
    analyze(track){
      return analyzeTrackSpectrum(track);
    }
  };

  /* /src/core/audio.js — compatibility bridge; the proven 3.5.3 runtime stays authoritative. */
  const GPAudioCore={
    runtime:null,
    bindRuntime(runtime){this.runtime=Object.freeze(Object.assign({},runtime));return this;},
    getState(){return this.runtime&&this.runtime.getState?this.runtime.getState():null;},
    play(){return this.runtime&&this.runtime.play?this.runtime.play():undefined;},
    pause(){return this.runtime&&this.runtime.pause?this.runtime.pause():undefined;},
    toggle(){return this.runtime&&this.runtime.toggle?this.runtime.toggle():undefined;},
    loadTrack(index,autoplay){return this.runtime&&this.runtime.loadTrack?this.runtime.loadTrack(index,autoplay):undefined;},
    next(){return this.runtime&&this.runtime.next?this.runtime.next():undefined;},
    previous(){return this.runtime&&this.runtime.previous?this.runtime.previous():undefined;}
  };

  /* Module boundaries only, no Beta UI mutation. */
  const GPUIModules={
    galaxy:{status:"reserved",mount:null},
    timeline:{status:"reserved",mount:null}
  };

  const gpIndexedDB=new GPIndexedDBAdapter();
  GPDatabase.use(gpIndexedDB);
  const GP=window.GP={
    generation:7,
    version:"7.6.3",
    architecture:"Peregrine Lake",
    engines:{core:"GP Core 4.3 — Kinetic Runtime",bionic:"GP Bionic Engine 1.0 — Intelligence Core",fusion:`GP Fusion Engine ${GP_FUSION_ENGINE_VERSION} — Playlist Flow`,motion:"GP Motion Engine 4.2 — Kinetic Motion",spatial:"GP Spatial Engine 1.1 — Room",spectrum:`GP Spectrum Engine ${GP_SPECTRUM_ENGINE_VERSION} — Signal`,recognition:"GP Bionic ID 1.0",neural:`GP Neural Engine ${GP_NEURAL_ENGINE_VERSION} — Listening DNA`},
    paths:{core:["audio.js","database.js","analyzer.js","recognition.js"],ui:["timeline.js"],storage:["indexeddb.js"]},
    core:{audio:GPAudioCore,database:GPDatabase,analyzer:GPAnalyzer},
    ui:GPUIModules,
    storage:{adapter:gpIndexedDB,indexeddb:GPIndexedDBAdapter},
    performance:{lastImport:null,libraryRenderCommits:0,spectrum:{queued:0,completed:0,cacheHits:0,failed:0}},
    future:{architecture:"Electron Lake",storageAdapter:"storage/sqlite.js",delivery:"EXE"}
  };
