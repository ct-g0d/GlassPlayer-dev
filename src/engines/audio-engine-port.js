  GPModules.register("createAudioEngine",function createAudioEngine(runtime){
    return Object.freeze({init:runtime.init,loadTrack:runtime.loadTrack,play:runtime.play,pause:runtime.pause,seek:runtime.seek,setVolume:runtime.setVolume,setEQ:runtime.setEQ,setSpatialMode:runtime.setSpatialMode,setSpatialEnabled:runtime.setSpatialEnabled,startCrossfade:runtime.startCrossfade,stop:runtime.stop,destroy:runtime.destroy,getRuntimeSnapshot:runtime.getRuntimeSnapshot});
  });
