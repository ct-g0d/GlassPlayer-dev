  /* Module boundaries only, no Beta UI mutation. */
  const GPUIModules={
    galaxy:{status:"reserved",mount:null},
    timeline:{status:"reserved",mount:null}
  };

  const gpIndexedDB=new GPIndexedDBAdapter();
  GPDatabase.use(gpIndexedDB);
  const GP=window.GP={
    generation:7,
    version:"7.4.2",
    architecture:"Peregrine Lake",
    engines:{core:"GP Core 4.2",fusion:`GP Fusion Engine ${GP_FUSION_ENGINE_VERSION}`,motion:"GP Motion Engine 4.1",spatial:"GP Spatial Engine 1.1",spectrum:`GP Spectrum Engine ${GP_SPECTRUM_ENGINE_VERSION}`,recognition:"GP Spectrum ID 1.0",neural:`GP Neural Engine ${GP_NEURAL_ENGINE_VERSION} — Resonance Boost`},
    paths:{core:["audio.js","database.js","analyzer.js","recognition.js"],ui:["timeline.js"],storage:["indexeddb.js"]},
    core:{audio:GPAudioCore,database:GPDatabase,analyzer:GPAnalyzer},
    ui:GPUIModules,
    storage:{adapter:gpIndexedDB,indexeddb:GPIndexedDBAdapter},
    performance:{lastImport:null,libraryRenderCommits:0,spectrum:{queued:0,completed:0,cacheHits:0,failed:0}},
    future:{architecture:"Electron Lake",storageAdapter:"storage/sqlite.js",delivery:"EXE"}
  };
