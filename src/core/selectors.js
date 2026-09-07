  GPModules.register("createSelectors",function createSelectors(){
    return Object.freeze({library:s=>s.library,playback:s=>s.playback,queue:s=>s.queue,settings:s=>s.settings,analysis:s=>s.analysis,ui:s=>s.ui,currentTrack:s=>s.library.tracks.find(track=>track.id===s.library.currentTrackId)||null});
  });
