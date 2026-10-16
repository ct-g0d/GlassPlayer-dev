  GPModules.register("createBionicEngine",function createBionicEngine(runtime){
    return Object.freeze({
      recognizeAudioEssence:runtime.recognizeAudioEssence,
      detectAudioPayload:runtime.detectAudioPayload,
      extractFileMetadata:runtime.extractFileMetadata,
      extractGenre:runtime.extractGenre,
      analyze:runtime.analyze,
      readCached:runtime.readCached,
      processPending:runtime.processPending,
      recordBehavior:runtime.recordBehavior,
      generateDailyMix:runtime.generateDailyMix,
      getUserModel:runtime.getUserModel,
      resolveNextTrack:runtime.resolveNextTrack,
      resolvePreviousTrack:runtime.resolvePreviousTrack,
      getVersion:()=>runtime.version||GP_SPECTRUM_ALGORITHM_VERSION
    });
  });
  GPModules.register("createRecognitionEngine",function createRecognitionEngine(runtime){
    return Object.freeze({
      recognizeAudioEssence:runtime.recognizeAudioEssence,
      detectAudioPayload:runtime.detectAudioPayload,
      extractFileMetadata:runtime.extractFileMetadata,
      extractGenre:runtime.extractGenre
    });
  });
  GPModules.register("createSpectrumAnalyzer",function createSpectrumAnalyzer(runtime){
    return Object.freeze({
      analyze:runtime.analyze,
      readCached:runtime.readCached,
      processPending:runtime.processPending,
      getVersion:()=>runtime.version
    });
  });
