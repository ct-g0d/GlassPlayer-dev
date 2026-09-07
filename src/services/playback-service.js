  GPModules.register("createPlaybackService",function createPlaybackService({runtime,bus,events}){
    function play(){const result=runtime.play();bus.emit(events.TRACK_STARTED,runtime.snapshot());return result;}
    function pause(){const result=runtime.pause();bus.emit(events.TRACK_PAUSED,runtime.snapshot());return result;}
    return Object.freeze({play,pause,toggle:runtime.toggle,playTrack:runtime.playTrack,next:runtime.next,previous:runtime.previous,seek:runtime.seek,setVolume:runtime.setVolume,getSnapshot:runtime.snapshot});
  });
