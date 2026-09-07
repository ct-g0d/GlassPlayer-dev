  GPModules.register("createContracts",function createContracts(){
    const events=Object.freeze({TRACK_STARTED:"playback:track-started",TRACK_PAUSED:"playback:track-paused",TRACK_ENDED:"playback:track-ended",SEEKED:"playback:seeked",CROSSFADE_STARTED:"playback:crossfade-started",CROSSFADE_COMPLETED:"playback:crossfade-completed",IMPORT_COMPLETED:"library:import-completed",ANALYSIS_COMPLETED:"analysis:completed",ANALYSIS_FAILED:"analysis:failed",SETTINGS_CHANGED:"settings:changed",PIP_OPENED:"pip:opened",PIP_CLOSED:"pip:closed"});
    return Object.freeze({events});
  });
