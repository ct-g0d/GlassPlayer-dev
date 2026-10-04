  /* ================= playback engine ================= */
  let listeningKey = null;
  let lastTimeMark = 0;
  let pauseCommitTimer=0,pauseEnvelopeToken=0;
  let nativeEndPauseTimer=0,nativeEndPauseToken=0,nativeEndPausePending=false;
  function clearNativeEndPause(){nativeEndPauseToken++;nativeEndPausePending=false;if(nativeEndPauseTimer){clearTimeout(nativeEndPauseTimer);nativeEndPauseTimer=0;}}
  function deferNativeEndPause(deck){
    clearNativeEndPause();nativeEndPausePending=true;const token=nativeEndPauseToken;
    nativeEndPauseTimer=setTimeout(()=>{
      if(token!==nativeEndPauseToken||deck!==audio)return;
      nativeEndPauseTimer=0;nativeEndPausePending=false;emitListeningCheckpoint("pause");
      if(!pendingPlayToken)wantsPlayback=false;setPlaybackVisualState(false);
    },32);
  }
  let trackDetailRevision=0,trackDetailHoldUntil=0;
  let firstPlaybackQueueAlignment=true;
  function ensureTrackMediaURL(track){
    if(track?.file&&(!track.url||!String(track.url).startsWith("blob:")))track.url=URL.createObjectURL(track.file);
    return track?.url||"";
  }
  function reserveTrackDetailWindow(duration=330){trackDetailHoldUntil=Math.max(trackDetailHoldUntil,performance.now()+duration);}

  function updateNowPlayingUI(t){
    transitionNowPlayingMeta(t.title,t.artist);
    syncNowFormatTag(t);
    seekProgress = 0; drawWaveform();
    $("#curTime").textContent = "0:00"; $("#durTime").textContent = t.duration ? fmtTime(t.duration) : "0:00";
    updateArtDisplay();syncCurrentTrackPlaybackIndicator();
    const revision=++trackDetailRevision,trackIndex=currentIndex;
    /* The first two frames belong exclusively to transport, title and artwork
       motion. Queue reconciliation, colour extraction, ambient raster work and
       auxiliary panels begin only after that compositor commit. */
    const commitDetails=()=>{
      if(revision!==trackDetailRevision||currentIndex!==trackIndex)return;
      updateAmbient();if(!importRunning)renderMiniQueue({instantPosition:false});applyAdaptiveAccent();
      updateTrackInfoCard(t);if(soundPanelActive)loadWaveformFor(t);
      if("mediaSession" in navigator&&typeof MediaMetadata!=="undefined"){
        try{navigator.mediaSession.metadata=new MediaMetadata({title:t.title||t.name||"Glass Player",artist:t.artist||"",album:t.album||"",artwork:t.coverUrl?[{src:t.coverUrl}]:[]});}catch(error){}
      }
      if(typeof syncTraditionalPiP==="function")syncTraditionalPiP(true);
    };
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const remaining=trackDetailHoldUntil-performance.now();
      if(remaining>0)setTimeout(commitDetails,remaining);else commitDetails();
    }));
  }

  function loadTrack(idx, autoplay){
    if(!Number.isInteger(idx)||idx<0 || idx>=playlist.length) return;
    clearNativeEndPause();
    const doCrossfade = crossfadeEnabled && currentIndex !== -1 && autoplay !== false && isPlaying;
    if(doCrossfade){ crossfadeTo(idx); return; }
    const doClickSafeSwap=currentIndex!==-1&&autoplay!==false&&isPlaying;
    if(doClickSafeSwap){crossfadeTo(idx,.024);return;}

    flushHistory();
    if(crossfadeSwapTimer){ clearTimeout(crossfadeSwapTimer); crossfadeSwapTimer=null; }
    crossfading = false;
    decks.forEach(d => { if(d !== audio) d.pause(); });
    if(deckGains[activeIdx]){ deckGains[activeIdx].gain.cancelScheduledValues(audioCtx.currentTime); deckGains[activeIdx].gain.value = 1; }

    currentIndex = idx;
    if(autoplay===false)queueAlignOnNextPlayback=true;
    const t = playlist[idx];
    audio.src = ensureTrackMediaURL(t);
    if(audioCtx)applyDeckNormalization(activeIdx,t);
    lastTimeMark = 0;
    listeningKey = spectrumHistoryKey(t);
    beginBehaviorTrack(t,pendingSelectionSource);
    updateNowPlayingUI(t);
    if(autoplay !== false) playAudio(); else pauseAudio();
  }

  function crossfadeTo(idx,durationOverride=null){
    if(!Number.isInteger(idx)||idx<0||idx>=playlist.length)return;
    clearNativeEndPause();
    ensureAudioCtx();
    flushHistory();
    if(crossfadeSwapTimer){ clearTimeout(crossfadeSwapTimer); crossfadeSwapTimer=null; }
    const fromIdx = activeIdx, toIdx = 1-activeIdx;
    const standby = decks[toIdx];
    const t = playlist[idx];
    ensureTrackMediaURL(t);
    const now = audioCtx.currentTime, dur = Number.isFinite(durationOverride)?Math.max(.018,durationOverride):crossfadeSeconds;
    const gFrom = deckGains[fromIdx], gTo = deckGains[toIdx];
    gTo.gain.cancelScheduledValues(now);gTo.gain.setValueAtTime(0,now);
    standby.src = t.url;
    applyDeckNormalization(toIdx,t);
    standby.currentTime = 0;
    const transitionToken=++playbackIntentToken;wantsPlayback=true;pendingPlayToken=transitionToken;
    standby.play().then(()=>{
      if(pendingPlayToken===transitionToken)pendingPlayToken=0;
      if(transitionToken!==playbackIntentToken||!wantsPlayback){standby.pause();return;}
      /* The fade starts only after Edge has actually started the new decoder.
         Starting it at play() request time could finish a 24 ms ramp before
         the first FLAC PCM frame arrived, exposing that frame at full gain. */
      const fadeNow=audioCtx.currentTime;
      gFrom.gain.cancelScheduledValues(fadeNow);gFrom.gain.setValueAtTime(gFrom.gain.value,fadeNow);
      gTo.gain.cancelScheduledValues(fadeNow);gTo.gain.setValueAtTime(0,fadeNow);
      gFrom.gain.linearRampToValueAtTime(0,fadeNow+dur);gTo.gain.linearRampToValueAtTime(1,fadeNow+dur);
      crossfadeSwapTimer=setTimeout(()=>{
        oldDeck.pause();
        const settleNow=audioCtx.currentTime;gFrom.gain.cancelScheduledValues(settleNow);gFrom.gain.setValueAtTime(1,settleNow);
        crossfading=false;crossfadeSwapTimer=null;
      },dur*1000+60);
    }).catch(()=>{if(transitionToken===playbackIntentToken){pendingPlayToken=0;pauseAudio();}});

    crossfading = true;
    const oldDeck = decks[fromIdx];
    activeIdx = toIdx;
    audio = decks[activeIdx];
    currentIndex = idx;
    lastTimeMark = 0;
    listeningKey = spectrumHistoryKey(t);
    beginBehaviorTrack(t,pendingSelectionSource);
    wantsPlayback = true;
    updateNowPlayingUI(t);
    setPlaybackVisualState(true);

  }

  function maybeTriggerAutoCrossfade(){
    if(!wantsPlayback||!isPlaying||!crossfadeEnabled || crossfading || !audio.duration || sleepTimerMode === "end" || playMode === "repeatOne" || (playingQueuedTrack&&playQueue.length===0)) return;
    if(!playlist.length)return;
    const remaining = audio.duration - audio.currentTime;
    if(remaining <= crossfadeSeconds && audio.duration > crossfadeSeconds*1.5){
      let nextIdx = takeNextQueuedIndex();
      if(nextIdx!==null){beginQueuedPlayback();pendingSelectionSource="queue";}
      if(overrideQueue){
        if(nextIdx === null){
          const pos = overrideQueue.indexOf(currentIndex);
          nextIdx = (pos !== -1 && pos+1 < overrideQueue.length) ? overrideQueue[pos+1] : null;
          if(nextIdx!==null)pendingSelectionSource="recommendation";
          if(nextIdx === null) overrideQueue = null;
        }
      }
      if(nextIdx === null){pendingSelectionSource=playMode === "shuffle"?"shuffle":"sequential";nextIdx = playMode === "shuffle" ? nextShuffleIndex() : (currentIndex+1) % playlist.length;}
      recordComplete(playlist[currentIndex]);
      crossfadeTo(nextIdx);
    }
  }

  function playAt(idx,sourceOverride=null){
    const chosen=playlist[idx],query=searchInputSafe().trim(),source=sourceOverride||(query?"search_select":"manual_select");
    const eventType=sourceOverride==="queue"?"manual_select":sourceOverride?null:source;
    if(chosen&&eventType)recordBehaviorEvent(eventType,chosen,{query:query||null,surface:sourceOverride||"library"});
    if(chosen)pendingSelectionSource=source;
    if(currentIndex !== -1 && idx !== currentIndex) judgeAndRecordTransition("manual-selection");
    if(playMode === "shuffle" && idx !== currentIndex){
      if(shuffleTimelineCursor<0&&currentIndex>=0){shuffleTimeline=[currentIndex];shuffleTimelineCursor=0;}
      if(shuffleTimelineCursor<shuffleTimeline.length-1)shuffleTimeline.length=shuffleTimelineCursor+1;
      if(shuffleTimeline[shuffleTimeline.length-1]!==idx)shuffleTimeline.push(idx);
      if(shuffleTimeline.length>21)shuffleTimeline.splice(0,shuffleTimeline.length-21);
      shuffleTimelineCursor=shuffleTimeline.length-1;
    }
    if(overrideQueue && overrideQueue.indexOf(idx) === -1) overrideQueue = null;
    loadTrack(idx, true);
  }
  function setPlaybackVisualState(playing,forceRender=false){
    const next=!!playing,changed=isPlaying!==next;isPlaying=next;
    if("mediaSession" in navigator){try{navigator.mediaSession.playbackState=next?"playing":"paused";}catch(error){}}
    /* A later native pause event must not restart the 720 ms stop timeline.
       The record and reader are armed exactly once on the real state edge. */
    if(changed){syncDiscRotationTimeline(next);$("#diskReader").classList.toggle("engaged",next&&coverDisplayMode==="rotate");}
    syncPlaybackMotion120();
    updatePlayIcon();
    if(changed||forceRender)syncCurrentTrackPlaybackIndicator();
  }
  let playbackMotionFrame=0,playbackMotionLastPaint=0,playbackMotionLastSecond=-1;
  function runPlaybackMotion120(timestamp){
    playbackMotionFrame=0;
    const playerActive=!!$(".view[data-view='player']")?.classList.contains("active");
    if(!isPlaying||audio.paused||audio.ended||document.hidden||!playerActive)return;
    if(timestamp-playbackMotionLastPaint>=GP_MOTION_FRAME_MS-.35){
      playbackMotionLastPaint=timestamp;
      if(audio.duration){
        seekProgress=Math.max(0,Math.min(1,audio.currentTime/audio.duration));
        if($(".view[data-view='player']")?.classList.contains("active")){
          drawWaveform();
          const wholeSecond=Math.floor(audio.currentTime);
          if(wholeSecond!==playbackMotionLastSecond){playbackMotionLastSecond=wholeSecond;$("#curTime").textContent=fmtTime(audio.currentTime);}
        }
      }
    }
    playbackMotionFrame=requestAnimationFrame(runPlaybackMotion120);
  }
  function syncPlaybackMotion120(){
    const playerActive=!!$(".view[data-view='player']")?.classList.contains("active");
    if(isPlaying&&!document.hidden&&playerActive){if(!playbackMotionFrame)playbackMotionFrame=requestAnimationFrame(runPlaybackMotion120);}
    else{if(playbackMotionFrame)cancelAnimationFrame(playbackMotionFrame);playbackMotionFrame=0;playbackMotionLastPaint=0;}
  }
  document.addEventListener("visibilitychange",syncPlaybackMotion120);
  function playAudio(){
    clearNativeEndPause();
    ensureAudioCtx();
    if(playMode!=="repeatOne"&&manualQueueActive&&!playingQueuedTrack&&playQueue.length){
      const queuedIdx=takeNextQueuedIndex();
      if(queuedIdx!==null){beginQueuedPlayback();pendingSelectionSource="queue";loadTrack(queuedIdx,true);return;}
    }
    if(currentIndex === -1){ if(playlist.length) loadTrack(0,true); return; }
    if(pauseCommitTimer){clearTimeout(pauseCommitTimer);pauseCommitTimer=0;}pauseEnvelopeToken++;
    const firstQueueAlignment=firstPlaybackQueueAlignment&&!manualQueueActive;
    if(firstQueueAlignment)positionCurrentQueueRow(false);
    const target=audio,token=++playbackIntentToken;wantsPlayback=true;pendingPlayToken=token;resetBehaviorMediaClock();
    const desiredVolume=parseFloat($("#vol").value)||0.7,now=audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);masterGain.gain.setValueAtTime(0,now);
    target.play().then(()=>{
      if(pendingPlayToken===token)pendingPlayToken=0;
      if(token!==playbackIntentToken||!wantsPlayback||target!==audio){target.pause();return;}
      const fadeNow=audioCtx.currentTime;masterGain.gain.cancelScheduledValues(fadeNow);masterGain.gain.setValueAtTime(0,fadeNow);masterGain.gain.linearRampToValueAtTime(desiredVolume,fadeNow+.02);
      setPlaybackVisualState(!target.paused&&!target.ended);
      firstPlaybackQueueAlignment=false;
      queueAlignOnNextPlayback=false;
      if(!manualQueueActive&&!firstQueueAlignment)positionCurrentQueueRow(false);
    }).catch(()=>{
      if(token!==playbackIntentToken)return;
      const failNow=audioCtx.currentTime;masterGain.gain.cancelScheduledValues(failNow);masterGain.gain.setValueAtTime(desiredVolume,failNow);
      pendingPlayToken=0;wantsPlayback=false;setPlaybackVisualState(false);
    });
  }
  function pauseAudio(){
    clearNativeEndPause();
    settleBehaviorProgress();emitListeningCheckpoint("pause");
    flushHistory();
    playbackIntentToken++;pendingPlayToken=0;wantsPlayback=false;
    if(crossfadeSwapTimer){clearTimeout(crossfadeSwapTimer);crossfadeSwapTimer=null;}
    crossfading=false;
    if(audioCtx){
      const token=++pauseEnvelopeToken,now=audioCtx.currentTime,desiredVolume=parseFloat($("#vol").value)||0.7;
      masterGain.gain.cancelScheduledValues(now);masterGain.gain.setValueAtTime(masterGain.gain.value,now);masterGain.gain.linearRampToValueAtTime(0,now+.018);
      if(pauseCommitTimer)clearTimeout(pauseCommitTimer);
      pauseCommitTimer=setTimeout(()=>{
        if(token!==pauseEnvelopeToken||wantsPlayback)return;
        decks.forEach(deck=>deck.pause());
        const settleNow=audioCtx.currentTime;masterGain.gain.cancelScheduledValues(settleNow);masterGain.gain.setValueAtTime(desiredVolume,settleNow);
        deckGains.forEach((gain,index)=>{if(!gain)return;gain.gain.cancelScheduledValues(settleNow);gain.gain.setValueAtTime(index===activeIdx?1:0,settleNow);});
        pauseCommitTimer=0;
      },24);
    }else decks.forEach(deck=>deck.pause());
    setPlaybackVisualState(false);
    if(!manualQueueActive)positionCurrentQueueRow(false);
  }
  function togglePlay(){ if(audio.ended){playAudio();return;} (wantsPlayback||!audio.paused) ? pauseAudio() : playAudio(); }
  function updatePlayIcon(){
    $("#playIcon").innerHTML = isPlaying ? '<rect x="7" y="5" width="4" height="14" rx="1.4"/><rect x="13" y="5" width="4" height="14" rx="1.4"/>' : '<path d="M9.25 5.7C8.5 5.25 8 5.62 8 6.5v11c0 .88.5 1.25 1.25.8l9.1-5.5c.78-.47.78-1.13 0-1.6z"/>';
    $("#miniEq").classList.toggle("playing", isPlaying);
    syncMiniEqMeter();
    if(typeof syncTraditionalPiP==="function")syncTraditionalPiP();
  }
  function ensureShuffleTimeline(baseIndex=currentIndex){
    if(baseIndex<0)return;
    if(shuffleTimelineCursor<0||shuffleTimeline[shuffleTimelineCursor]!==baseIndex){shuffleTimeline=[baseIndex];shuffleTimelineCursor=0;}
  }
  function nextShuffleIndex(baseIndex=currentIndex){
    ensureShuffleTimeline(baseIndex);
    if(shuffleTimelineCursor>=0&&shuffleTimelineCursor<shuffleTimeline.length-1)return shuffleTimeline[++shuffleTimelineCursor];
    const next=weightedPickIndex(baseIndex);
    shuffleTimeline.push(next);shuffleTimelineCursor=shuffleTimeline.length-1;
    if(shuffleTimeline.length>21){const removed=shuffleTimeline.length-21;shuffleTimeline.splice(0,removed);shuffleTimelineCursor-=removed;}
    shuffleHistory=shuffleTimeline.slice(0,shuffleTimelineCursor);
    return next;
  }
  function previousShuffleIndex(){
    ensureShuffleTimeline();
    if(shuffleTimelineCursor>0){shuffleTimelineCursor--;shuffleHistory=shuffleTimeline.slice(0,shuffleTimelineCursor);return shuffleTimeline[shuffleTimelineCursor];}
    return null;
  }
  function nextTrack(){
    if(playlist.length===0) return;
    reserveAmbientTransitionWindow(340);reserveTrackDetailWindow(330);
    judgeAndRecordTransition();
    const queuedIdx = takeNextQueuedIndex();
    if(queuedIdx !== null){ beginQueuedPlayback();pendingSelectionSource="queue";loadTrack(queuedIdx, true); return; }
    if(resumeAfterQueue())return;
    if(overrideQueue){
      const pos = overrideQueue.indexOf(currentIndex);
      if(pos !== -1 && pos+1 < overrideQueue.length){ pendingSelectionSource="recommendation";loadTrack(overrideQueue[pos+1], true); return; }
      overrideQueue = null;
    }
    if(playMode === "shuffle"){pendingSelectionSource="shuffle";loadTrack(nextShuffleIndex(), true); return; }
    let idx = currentIndex+1; if(idx>=playlist.length) idx=0;
    pendingSelectionSource="sequential";
    loadTrack(idx, true);
  }
  function prevTrack(){
    if(playlist.length===0) return;
    reserveAmbientTransitionWindow(340);reserveTrackDetailWindow(330);
    if(audio.currentTime>3){settleBehaviorProgress();recordBehaviorEvent("replay",playlist[currentIndex],{position:audio.currentTime,duration:audio.duration,selectionSource:behaviorRuntime.source});audio.currentTime=0;resetBehaviorMediaClock();return;}
    judgeAndRecordTransition();
    if(overrideQueue){
      const pos = overrideQueue.indexOf(currentIndex);
      if(pos > 0){ loadTrack(overrideQueue[pos-1], true); return; }
    }
    if(playMode==="shuffle"){
      const previous=previousShuffleIndex();
      if(previous!==null){pendingSelectionSource="shuffle-history";loadTrack(previous,true);return;}
    }
    let idx = currentIndex-1; if(idx<0) idx = playlist.length-1;
    loadTrack(idx, true);
  }
  function onEnded(){
    if(!wantsPlayback||!isPlaying){if(!nativeEndPausePending)return;}
    clearNativeEndPause();
    if(crossfading) return; // already advanced proactively
    if(!playlist.length){pauseAudio();return;}
    recordComplete(playlist[currentIndex]);
    if(sleepTimerMode === "end"){ pauseAudio(); clearSleepTimer(); return; }
    if(playMode === "repeatOne"){recordBehaviorEvent("replay",playlist[currentIndex],{automaticLoop:true,duration:audio.duration});audio.currentTime=0;beginBehaviorTrack(playlist[currentIndex],"repeat");resetBehaviorMediaClock();playAudio();return;}
    const queuedIdx = takeNextQueuedIndex();
    if(queuedIdx !== null){ beginQueuedPlayback();pendingSelectionSource="queue";loadTrack(queuedIdx, true); return; }
    if(resumeAfterQueue())return;
    if(overrideQueue){
      const pos = overrideQueue.indexOf(currentIndex);
      if(pos !== -1 && pos+1 < overrideQueue.length){pendingSelectionSource="recommendation";loadTrack(overrideQueue[pos+1], true); return; }
      overrideQueue = null;
    }
    if(playMode === "shuffle"){pendingSelectionSource="shuffle";loadTrack(nextShuffleIndex(), true); return; }
    let idx = currentIndex+1; if(idx>=playlist.length) idx=0;
    pendingSelectionSource="sequential";
    loadTrack(idx, true);
  }

  /* ---- merged play-mode button: sequential -> shuffle -> repeatOne ---- */
  const modeIcons = {
    sequential:'<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>',
    shuffle:'<path d="M16 3h5v5"/><path d="M4 20L21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
    repeatOne:'<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>'
  };
  const modeLabels = { sequential:["顺序播放","Sequential"], shuffle:["随机播放","Shuffle"], repeatOne:["单曲循环","Repeat One"] };
  function setMode(mode){
    const previous=playMode;playMode = mode; shuffleHistory = [];
    shuffleTimeline=currentIndex>=0&&mode==="shuffle"?[currentIndex]:[];shuffleTimelineCursor=shuffleTimeline.length-1;
    $("#modeIcon").innerHTML = modeIcons[mode];
    $("#modeLabel").textContent = tr(modeLabels[mode][0],modeLabels[mode][1]);
    $("#modeBtn").classList.toggle("active", mode !== "sequential");
    $("#repeatOneBadge").style.display = mode === "repeatOne" ? "grid" : "none";
    savePrefs();
    if(previous!==mode){
      recordBehaviorEvent("play_mode_change",playlist[currentIndex]||null,{previous,mode});if(previous==="shuffle"||mode==="shuffle")recordBehaviorEvent("shuffle_toggle",playlist[currentIndex]||null,{enabled:mode==="shuffle"});if(previous==="repeatOne"||mode==="repeatOne")recordBehaviorEvent("repeat_toggle",playlist[currentIndex]||null,{enabled:mode==="repeatOne"});
      if(manualQueueActive){
        const list=$("#miniQueueList"),shuffle=mode==="shuffle";
        list.classList.toggle("queue-shuffle-mode",shuffle);
        list.querySelectorAll(".queue-drag-handle").forEach(handle=>{handle.disabled=shuffle;handle.setAttribute("aria-hidden",String(shuffle));});
      }
    }
  }
  let modeSwitchToken=0;
  $("#modeBtn").addEventListener("click", () => {
    const icon=$("#modeIcon"),nextMode=playMode==="sequential" ? "shuffle" : playMode==="shuffle" ? "repeatOne" : "sequential",token=++modeSwitchToken;
    icon.classList.remove("gp-mode-icon-enter");restartCssMotion(icon,"gp-mode-icon-exit");
    setTimeout(()=>{if(token!==modeSwitchToken)return;setMode(nextMode);icon.classList.remove("gp-mode-icon-exit");restartCssMotion(icon,"gp-mode-icon-enter");setTimeout(()=>{if(token===modeSwitchToken)icon.classList.remove("gp-mode-icon-enter");},145);},105);
  });
  $("#playbackSpeedPop").addEventListener("click",event=>{const preset=event.target.closest("[data-rate]");if(!preset)return;event.stopPropagation();applyPlaybackRate(Number(preset.dataset.rate),{syncSlider:true,persist:true});});
  function placePlaybackSpeedPopover(){
    const pop=$("#playbackSpeedPop"),button=$("#playbackSpeedButton");if(!pop||!button)return;
    if(pop.parentElement!==document.body)document.body.appendChild(pop);
    const rect=button.getBoundingClientRect(),half=82,center=Math.max(half+10,Math.min(innerWidth-half-10,rect.left+rect.width/2));
    const height=pop.offsetHeight||33,top=Math.max(10,rect.top-height-6);
    pop.style.left=`${Math.round(center)}px`;pop.style.top=`${Math.round(top)}px`;
  }
  function setPlaybackSpeedPopover(open){
    const pop=$("#playbackSpeedPop"),button=$("#playbackSpeedButton");if(open)placePlaybackSpeedPopover();setMotionPopover(pop,open);
    button.setAttribute("aria-expanded",String(open));pop.setAttribute("aria-hidden",String(!open));
    if(open)requestAnimationFrame(()=>{placePlaybackSpeedPopover();updateGlider($(".playback-speed-presets"),false);});
  }
  $("#playbackSpeedButton").addEventListener("click",event=>{event.stopPropagation();setPlaybackSpeedPopover(!$("#playbackSpeedPop").classList.contains("show"));});
  $("#playbackSpeedPop").addEventListener("click",event=>event.stopPropagation());
  document.addEventListener("click",event=>{if(!event.target.closest(".playback-speed-wrap,#playbackSpeedPop"))setPlaybackSpeedPopover(false);});
  window.addEventListener("resize",()=>{if($("#playbackSpeedPop").classList.contains("show"))placePlaybackSpeedPopover();},{passive:true});
