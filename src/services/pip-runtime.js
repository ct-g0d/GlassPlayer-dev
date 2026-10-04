  /* ================= sleep timer ================= */
  let sleepTimerHandle = null, sleepTimerMode = null, sleepTimerDeadline=0, sleepCountdownHandle=null; // null | 'minutes' | 'end'
  function updateSleepCountdown(){
    if(sleepTimerMode!=="minutes"||!sleepTimerDeadline)return;
    const remaining=Math.max(0,Math.ceil((sleepTimerDeadline-Date.now())/1000)),minutes=Math.floor(remaining/60),seconds=remaining%60;
    $("#sleepBtnText").textContent=`${minutes}:${String(seconds).padStart(2,"0")}`;
  }
  function scheduleSleepCountdown(){updateSleepCountdown();if(sleepTimerMode==="minutes")sleepCountdownHandle=setTimeout(scheduleSleepCountdown,1000-(Date.now()%1000)+12);}
  function selectSleepOption(mode){$$("#sleepPop button").forEach(button=>button.classList.toggle("active",button.dataset.m===String(mode)));}
  function clearSleepTimer(){
    if(sleepTimerHandle){ clearTimeout(sleepTimerHandle); sleepTimerHandle = null; }
    if(sleepCountdownHandle){clearTimeout(sleepCountdownHandle);sleepCountdownHandle=null;}sleepTimerDeadline=0;
    sleepTimerMode = null;
    $("#sleepBtn").classList.remove("on","counting");
    $("#sleepBtnText").textContent = tr("睡眠定时","Snooze");
    $$("#sleepPop button").forEach(b => b.classList.remove("active"));
  }
  function setSleepMinutes(mins){
    clearSleepTimer();
    sleepTimerMode = "minutes";
    sleepTimerDeadline=Date.now()+mins*60000;
    sleepTimerHandle = setTimeout(() => { pauseAudio(); clearSleepTimer(); }, mins*60000);
    scheduleSleepCountdown();
    $("#sleepBtn").classList.add("on","counting");
    selectSleepOption(mins);
  }
  function setSleepAtEnd(){
    clearSleepTimer();
    sleepTimerMode = "end";
    $("#sleepBtn").classList.add("on");
    $("#sleepBtn").classList.remove("counting");
    $("#sleepBtnText").textContent = tr("播完暂停","Stop After Song");
    selectSleepOption("end");
  }
  const gpPopoverTimers=new WeakMap();
  const gpPopoverTriggerIds={sleepPop:"sleepBtn",playbackSpeedPop:"playbackSpeedButton",eqPresetPop:"eqPresetButton",sortPop:"sortBtn",fontPickerPop:"fontPickerBtn",spatialInfoPop:"spatialInfoBtn",loudnessInfoPop:"loudnessInfoBtn"};
  function syncMotionPopoverState(pop,open){
    pop.setAttribute("aria-hidden",String(!open));
    const triggerId=gpPopoverTriggerIds[pop.id],trigger=triggerId?$("#"+triggerId):null;
    trigger?.setAttribute("aria-expanded",String(open));
    if(pop.id==="eqPresetPop")eqPopoverOpen=open;
    if(pop.id==="fontPickerPop")trigger?.classList.toggle("open",open);
  }
  function closeMotionPopover(pop,animate=true){
    if(!pop)return;clearTimeout(gpPopoverTimers.get(pop));pop.classList.remove("show");
    if(!animate){pop.classList.remove("gp-popover-exit");pop.style.removeProperty("will-change");syncMotionPopoverState(pop,false);return;}
    if(!pop.classList.contains("gp-popover-exit"))pop.classList.add("gp-popover-exit");
    syncMotionPopoverState(pop,false);
    const timer=setTimeout(()=>{pop.style.willChange="opacity, transform";pop.classList.remove("gp-popover-exit");requestAnimationFrame(()=>pop.style.removeProperty("will-change"));},88);
    gpPopoverTimers.set(pop,timer);
  }
  function closeAllMotionPopovers(){ $$(".gp-motion-popover.show,.gp-motion-popover.gp-popover-exit").forEach(pop=>closeMotionPopover(pop,false)); }
  function dismissMotionPopoversForExternalScroll(event){
    const target=event?.target;
    $$(".gp-motion-popover.show").forEach(pop=>{
      const scrolledInside=target===pop||(target instanceof Element&&pop.contains(target));
      if(!scrolledInside)closeMotionPopover(pop,true);
    });
  }
  document.addEventListener("scroll",dismissMotionPopoversForExternalScroll,{capture:true,passive:true});
  window.addEventListener("scroll",dismissMotionPopoversForExternalScroll,{passive:true});
  function setMotionPopover(pop,open){
    if(!pop)return;
    clearTimeout(gpPopoverTimers.get(pop));
    if(open){
      $$(".gp-motion-popover.show,.gp-motion-popover.gp-popover-exit").forEach(other=>{if(other!==pop)closeMotionPopover(other,false);});
      pop.classList.remove("gp-popover-exit");restartCssMotion(pop,"show");
      syncMotionPopoverState(pop,true);
      return;
    }
    if(!pop.classList.contains("show")&&!pop.classList.contains("gp-popover-exit")){syncMotionPopoverState(pop,false);return;}
    closeMotionPopover(pop,true);
  }
  function setSleepPopover(open){setMotionPopover($("#sleepPop"),open);}
  $("#sleepBtn").addEventListener("click", (e) => { e.stopPropagation(); setSleepPopover(!$("#sleepPop").classList.contains("show")); });
  document.addEventListener("click", (e) => { if(!e.target.closest(".sleep-wrap")) setSleepPopover(false); });
  $("#sleepPop").addEventListener("click", (e) => {
    const btn = e.target.closest("button"); if(!btn) return;
    const m = btn.dataset.m;
    if(m === "off") clearSleepTimer();
    else if(m === "end") setSleepAtEnd();
    else setSleepMinutes(parseInt(m,10));
    setSleepPopover(false);
  });
  bindMicroMotion($("#sleepBtn"),"gp-snooze-motion",400);

  function showPipSupportModal(message,detail=""){
    $("#pipSupportTitle").textContent=tr("无法打开悬浮播放器","Unable to open floating player");
    $("#pipSupportMessage").textContent=message;
    $("#pipSupportDetail").textContent=detail;
    $("#pipSupportClose").textContent=tr("知道了","OK");
    $("#pipSupportModal").classList.add("show");$("#pipSupportModal").setAttribute("aria-hidden","false");requestAnimationFrame(()=>$("#pipSupportClose").focus());
  }
  function closePipSupportModal(){$("#pipSupportModal").classList.remove("show");$("#pipSupportModal").setAttribute("aria-hidden","true");$("#pipLaunchBtn").focus();}
  $("#pipSupportClose").addEventListener("click",closePipSupportModal);
  $("#pipSupportModal").addEventListener("click",event=>{if(event.target===$("#pipSupportModal"))closePipSupportModal();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&$("#pipSupportModal").classList.contains("show")){event.preventDefault();closePipSupportModal();}});
  /* ================= 6.0.4 Traditional Video Picture-in-Picture =================
     A high-resolution canvas is exposed as a muted video stream. Edge owns the
     borderless always-on-top shell and native transport overlay; GP remains the
     only audio runtime. This deliberately replaces the address-bearing Document
     PiP path without duplicating Audio, Web Audio or Spectrum analysis. */
  let gpVideoPipCanvas=null,gpVideoPipContext=null,gpVideoPipVideo=null,gpVideoPipTrack=null;
  let gpVideoPipCover=null,gpVideoPipCoverSource="",gpVideoPipPalette=null,gpVideoPipTargetPlayback=false,gpVideoPipOpening=false,gpVideoPipFramePulse=false,gpVideoPipThemeObserver=null,gpVideoPipRefreshFrame=0,gpVideoPipWindow=null,gpVideoPipResizeHandler=null,gpVideoPipPulseTimer=0,gpVideoPipLastRender=0;
  let gpVideoPipBackgroundCanvas=null,gpVideoPipBackgroundContext=null,gpVideoPipBackgroundKey="",gpVideoPipMotionFrame=0,gpVideoPipLastMotionFrame=0,gpVideoPipMarqueeKey="",gpVideoPipMarqueeStart=0;
  const GP_VIDEO_PIP_DESIGN_WIDTH=1280,GP_VIDEO_PIP_DESIGN_HEIGHT=720,GP_VIDEO_PIP_WIDTH=1920,GP_VIDEO_PIP_HEIGHT=1080,GP_VIDEO_PIP_BACKGROUND_BLUR=58;
  function configureTraditionalPiPCanvas(){if(!gpVideoPipCanvas)return;if(gpVideoPipCanvas.width!==GP_VIDEO_PIP_WIDTH||gpVideoPipCanvas.height!==GP_VIDEO_PIP_HEIGHT){gpVideoPipCanvas.width=GP_VIDEO_PIP_WIDTH;gpVideoPipCanvas.height=GP_VIDEO_PIP_HEIGHT;gpVideoPipContext=gpVideoPipCanvas.getContext("2d",{alpha:false,desynchronized:true});}if(!gpVideoPipBackgroundCanvas){gpVideoPipBackgroundCanvas=document.createElement("canvas");gpVideoPipBackgroundCanvas.width=GP_VIDEO_PIP_WIDTH;gpVideoPipBackgroundCanvas.height=GP_VIDEO_PIP_HEIGHT;gpVideoPipBackgroundContext=gpVideoPipBackgroundCanvas.getContext("2d",{alpha:false,desynchronized:true});}}
  function scheduleTraditionalPiPRefresh(forceTheme=false){if(!gpVideoPipCanvas)return;cancelAnimationFrame(gpVideoPipRefreshFrame);gpVideoPipRefreshFrame=requestAnimationFrame(()=>{gpVideoPipRefreshFrame=0;syncTraditionalPiP(forceTheme);});}
  function pulseTraditionalPiPFrame(){
    const video=gpVideoPipVideo;if(!video||document.pictureInPictureElement!==video||isPlaying||gpVideoPipFramePulse)return;
    gpVideoPipFramePulse=true;clearTimeout(gpVideoPipPulseTimer);video.play().then(()=>{try{gpVideoPipTrack?.requestFrame?.();}catch(error){}gpVideoPipPulseTimer=setTimeout(()=>{if(document.pictureInPictureElement===video&&!isPlaying&&!video.paused)video.pause();gpVideoPipFramePulse=false;},72);}).catch(()=>{gpVideoPipFramePulse=false;});
  }
  function gpPipCss(name,fallback){return getComputedStyle(document.body).getPropertyValue(name).trim()||fallback;}
  function gpPipLoadCover(source){
    if(source===gpVideoPipCoverSource)return;gpVideoPipCoverSource=source;gpVideoPipCover=null;gpVideoPipPalette=null;if(!source)return;
    const image=new Image();image.decoding="async";image.onload=()=>{if(gpVideoPipCoverSource===source){gpVideoPipCover=image;renderTraditionalPiPFrame(true);gpVideoPipLastRender=performance.now();pulseTraditionalPiPFrame();}};image.onerror=()=>{if(gpVideoPipCoverSource===source)gpVideoPipCover=null;};image.src=source;
    getDominantColors(source,3).then(colors=>{if(gpVideoPipCoverSource===source&&colors?.length){gpVideoPipPalette=colors.map(color=>color.slice(0,3));renderTraditionalPiPFrame(true);gpVideoPipLastRender=performance.now();pulseTraditionalPiPFrame();}});
  }
  function renderTraditionalPiPFrame(forceStatic=false){
    if(!gpVideoPipCanvas||!gpVideoPipContext)return;configureTraditionalPiPCanvas();const ctx=gpVideoPipContext,bgCtx=gpVideoPipBackgroundContext,canvas=gpVideoPipCanvas;
    const width=GP_VIDEO_PIP_DESIGN_WIDTH,height=GP_VIDEO_PIP_DESIGN_HEIGHT,track=playlist[currentIndex]||null,dark=activeTheme()==="dark",pipWidth=gpVideoPipWindow?.width||640,pipLayout=GP.pipRenderer.calculateLayout(width,height,canvas.width,pipWidth),{scale,compactness}=pipLayout;
    const bg=gpPipCss("--bg-base",dark?"#111318":"#f1f3f5"),accent=gpPipCss("--accent","#7197c9"),accentRgb=gpPipCss("--accent-rgb","113,151,201"),text=gpPipCss("--text-primary",dark?"#f5f7fa":"#16191d"),secondary=gpPipCss("--text-secondary",dark?"rgba(245,247,250,.72)":"rgba(22,25,29,.66)"),font=gpPipCss("--font-family","system-ui"),weight=gpPipCss("--font-weight","600"),fontScale=Math.max(.85,Math.min(1.35,Number.parseFloat(gpPipCss("--font-scale","1"))||1));
    const paletteSignature=(gpVideoPipPalette||[]).flat().join(","),backgroundKey=[bgMode,dark,bg,accentRgb,gpVideoPipCoverSource,gpVideoPipCover?.complete?1:0,paletteSignature].join("|");
    if(backgroundKey!==gpVideoPipBackgroundKey){
      gpVideoPipBackgroundKey=backgroundKey;bgCtx.setTransform(scale,0,0,scale,0,0);bgCtx.imageSmoothingEnabled=true;bgCtx.imageSmoothingQuality="high";bgCtx.clearRect(0,0,width,height);bgCtx.fillStyle=bg;bgCtx.fillRect(0,0,width,height);
      if(bgMode==="blur"&&gpVideoPipCover?.complete&&gpVideoPipCover.naturalWidth){bgCtx.save();bgCtx.filter=`blur(${GP_VIDEO_PIP_BACKGROUND_BLUR}px) saturate(${dark?1.25:1.38}) brightness(${dark ? 0.48 : 1.02})`;bgCtx.globalAlpha=dark ? 0.88 : 0.72;bgCtx.drawImage(gpVideoPipCover,-96,-96,width+192,height+192);bgCtx.restore();bgCtx.fillStyle=dark?"rgba(4,6,9,.46)":"rgba(255,255,255,.10)";bgCtx.fillRect(0,0,width,height);}
      else{const fallback=currentAccentRgb(),palette=bgMode==="color"&&gpVideoPipPalette?.length?gpVideoPipPalette:[fallback,mixRgb(fallback,dark?[255,255,255]:[0,0,0],.2),mixRgb(fallback,dark?[0,0,0]:[255,255,255],.28)],points=bgMode==="color"?[[.08,.05,.78,.58],[.92,.18,.66,.5],[.48,1,.72,.46]]:[[.14,.12,.58,.34],[.86,.24,.5,.23],[.48,.94,.62,.2]];points.forEach((point,index)=>{const color=palette[index%palette.length],gradient=bgCtx.createRadialGradient(width*point[0],height*point[1],0,width*point[0],height*point[1],width*point[2]);gradient.addColorStop(0,`rgba(${color.join(",")},${dark?point[3]*.72:point[3]})`);gradient.addColorStop(1,"rgba(0,0,0,0)");bgCtx.fillStyle=gradient;bgCtx.fillRect(0,0,width,height);});bgCtx.fillStyle=dark?"rgba(3,5,8,.24)":"rgba(255,255,255,.08)";bgCtx.fillRect(0,0,width,height);}
    }
    ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(gpVideoPipBackgroundCanvas,0,0);ctx.setTransform(scale,0,0,scale,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    const {coverSize,coverX,coverY,contentX,contentWidth,titleSize,artistSize,titleY,artistY}=pipLayout;
    if(gpVideoPipCover?.complete&&gpVideoPipCover.naturalWidth)GP.pipRenderer.drawCover(ctx,gpVideoPipCover,coverX,coverY,coverSize,34);else{GP.pipRenderer.roundedRect(ctx,coverX,coverY,coverSize,coverSize,34);ctx.fillStyle=`rgba(${accentRgb},.11)`;ctx.fill();}
    const title=track?.title||tr("未选择歌曲","No Song Selected"),now=performance.now();ctx.save();ctx.fillStyle=text;ctx.font=`${weight} ${titleSize*fontScale}px ${font}`;ctx.textBaseline="alphabetic";const titleWidth=ctx.measureText(title).width,marqueeKey=[track?.id,title,contentWidth,font,weight,fontScale.toFixed(2)].join("|");if(marqueeKey!==gpVideoPipMarqueeKey){gpVideoPipMarqueeKey=marqueeKey;gpVideoPipMarqueeStart=now+1100;}ctx.beginPath();ctx.rect(contentX,titleY-titleSize*1.25,contentWidth,titleSize*1.55);ctx.clip();if(titleWidth<=contentWidth)ctx.fillText(title,contentX,titleY);else if(now<gpVideoPipMarqueeStart)ctx.fillText(title,contentX,titleY);else{const gap=100,travel=titleWidth+gap,offset=((now-gpVideoPipMarqueeStart)*.075)%travel;ctx.fillText(title,contentX-offset,titleY);ctx.fillText(title,contentX-offset+travel,titleY);}ctx.restore();
    ctx.save();ctx.fillStyle=secondary;ctx.font=`${Math.min(600,Number(weight)||500)} ${artistSize*fontScale}px ${font}`;ctx.fillText(GP.pipRenderer.fitText(ctx,track?.artist||tr("导入音乐后开始播放","Import music to begin"),contentWidth),contentX,artistY);
    const duration=Number(audio.duration)||Number(track?.duration)||0,current=Math.min(duration,Number(audio.currentTime)||0),ratio=duration?Math.max(0,Math.min(1,current/duration)):0,barX=contentX,barY=407+14*compactness,barW=width-barX-70;
    GP.pipRenderer.roundedRect(ctx,barX,barY,barW,8,4);ctx.fillStyle=dark?"rgba(255,255,255,.18)":"rgba(20,28,38,.15)";ctx.fill();if(ratio>0){GP.pipRenderer.roundedRect(ctx,barX,barY,Math.max(8,barW*ratio),8,4);ctx.fillStyle=accent;ctx.fill();}ctx.fillStyle=secondary;ctx.font=`500 ${21*fontScale}px ${font}`;ctx.fillText(fmtTime(current),barX,barY+43);const end=fmtTime(duration),endWidth=ctx.measureText(end).width;ctx.fillText(end,barX+barW-endWidth,barY+43);ctx.fillStyle=text;ctx.font=`${weight} ${(25+5*compactness)*fontScale}px ${font}`;ctx.fillText(isPlaying?tr("正在播放","Now Playing"):tr("已暂停","Paused"),barX,526+10*compactness);if(compactness<.72){ctx.fillStyle=secondary;ctx.font=`500 ${20*fontScale}px ${font}`;ctx.fillText(tr("使用画中画控制播放","Use Picture-in-Picture controls"),barX,567);}ctx.restore();
    try{gpVideoPipTrack?.requestFrame?.();}catch(error){}
  }
  function stopTraditionalPiPMotion(){
    if(gpVideoPipMotionFrame){cancelAnimationFrame(gpVideoPipMotionFrame);gpVideoPipMotionFrame=0;}
    gpVideoPipLastMotionFrame=0;
  }
  function startTraditionalPiPMotion(){
    if(gpVideoPipMotionFrame||document.pictureInPictureElement!==gpVideoPipVideo||!isPlaying||gpVideoPipVideo.paused)return;
    gpVideoPipLastMotionFrame=0;gpVideoPipMotionFrame=requestAnimationFrame(runTraditionalPiPMotion);
  }
  function runTraditionalPiPMotion(timestamp){
    gpVideoPipMotionFrame=0;
    if(document.pictureInPictureElement!==gpVideoPipVideo||!isPlaying||gpVideoPipVideo.paused)return;
    if(timestamp-gpVideoPipLastMotionFrame>=GP_PIP_FRAME_MS-.35){gpVideoPipLastMotionFrame=timestamp;renderTraditionalPiPFrame(false);}
    gpVideoPipMotionFrame=requestAnimationFrame(runTraditionalPiPMotion);
  }
  function ensureTraditionalPiPVideo(){
    if(gpVideoPipVideo)return gpVideoPipVideo;
    gpVideoPipCanvas=document.createElement("canvas");gpVideoPipCanvas.hidden=true;gpVideoPipCanvas.setAttribute("aria-hidden","true");configureTraditionalPiPCanvas();
    const stream=gpVideoPipCanvas.captureStream(GP_PIP_TARGET_FPS);gpVideoPipTrack=stream.getVideoTracks()[0];gpVideoPipVideo=document.createElement("video");gpVideoPipVideo.hidden=true;gpVideoPipVideo.muted=true;gpVideoPipVideo.playsInline=true;gpVideoPipVideo.disablePictureInPicture=false;gpVideoPipVideo.srcObject=stream;gpVideoPipVideo.setAttribute("aria-hidden","true");document.body.append(gpVideoPipCanvas,gpVideoPipVideo);
    gpVideoPipVideo.addEventListener("play",()=>{if(gpVideoPipOpening||gpVideoPipFramePulse)return;if(!gpVideoPipTargetPlayback){gpVideoPipTargetPlayback=true;if(!isPlaying)playAudio();}startTraditionalPiPMotion();});
    gpVideoPipVideo.addEventListener("pause",()=>{stopTraditionalPiPMotion();if(gpVideoPipFramePulse)return;if(document.pictureInPictureElement===gpVideoPipVideo&&gpVideoPipTargetPlayback){gpVideoPipTargetPlayback=false;if(isPlaying)pauseAudio();}});
    gpVideoPipVideo.addEventListener("enterpictureinpicture",event=>{gpVideoPipWindow=event.pictureInPictureWindow||null;gpVideoPipResizeHandler=()=>scheduleTraditionalPiPRefresh(false);gpVideoPipWindow?.addEventListener("resize",gpVideoPipResizeHandler);$("#pipLaunchBtn").classList.add("active");gpVideoPipOpening=false;syncTraditionalPiP(true);});
    gpVideoPipVideo.addEventListener("leavepictureinpicture",cleanupTraditionalPiP,{once:true});
    gpVideoPipThemeObserver=new MutationObserver(()=>scheduleTraditionalPiPRefresh(true));[document.documentElement,document.body,$("#ambientGlow"),$("#ambientBlur"),$("#blob1"),$("#blob2"),$("#blob3")].filter(Boolean).forEach(element=>gpVideoPipThemeObserver.observe(element,{attributes:true,attributeFilter:["style","class","data-theme"]}));
    return gpVideoPipVideo;
  }
  function syncTraditionalPiP(forceTheme=false){
    if(!gpVideoPipCanvas)return;const track=playlist[currentIndex]||null,source=track?.coverUrl||track?.thumbUrl||"",shouldRender=forceTheme||!isPlaying;gpPipLoadCover(source);if(shouldRender){renderTraditionalPiPFrame(forceTheme);gpVideoPipLastRender=performance.now();}
    if(document.pictureInPictureElement===gpVideoPipVideo){gpVideoPipTargetPlayback=!!isPlaying;if(isPlaying&&gpVideoPipVideo.paused)gpVideoPipVideo.play().catch(()=>{});else if(isPlaying)startTraditionalPiPMotion();else{stopTraditionalPiPMotion();if(!gpVideoPipVideo.paused&&!gpVideoPipFramePulse)gpVideoPipVideo.pause();else if(gpVideoPipVideo.paused&&shouldRender)pulseTraditionalPiPFrame();}}
  }
  function cleanupTraditionalPiP(){
    gpVideoPipOpening=false;gpVideoPipTargetPlayback=false;gpVideoPipFramePulse=false;gpVideoPipLastRender=0;clearTimeout(gpVideoPipPulseTimer);gpVideoPipPulseTimer=0;cancelAnimationFrame(gpVideoPipRefreshFrame);gpVideoPipRefreshFrame=0;cancelAnimationFrame(gpVideoPipMotionFrame);gpVideoPipMotionFrame=0;gpVideoPipLastMotionFrame=0;gpVideoPipThemeObserver?.disconnect();gpVideoPipThemeObserver=null;if(gpVideoPipWindow&&gpVideoPipResizeHandler)gpVideoPipWindow.removeEventListener("resize",gpVideoPipResizeHandler);gpVideoPipWindow=null;gpVideoPipResizeHandler=null;try{gpVideoPipTrack?.stop();}catch(error){}if(gpVideoPipVideo){gpVideoPipVideo.srcObject=null;gpVideoPipVideo.remove();}gpVideoPipCanvas?.remove();gpVideoPipCanvas=null;gpVideoPipContext=null;gpVideoPipVideo=null;gpVideoPipTrack=null;gpVideoPipCover=null;gpVideoPipCoverSource="";gpVideoPipPalette=null;gpVideoPipBackgroundCanvas=null;gpVideoPipBackgroundContext=null;gpVideoPipBackgroundKey="";gpVideoPipMarqueeKey="";gpVideoPipMarqueeStart=0;$("#pipLaunchBtn").classList.remove("active");
  }
  async function toggleTraditionalPiP(){
    if(document.pictureInPictureElement){await document.exitPictureInPicture().catch(()=>{});return;}
    if(!document.pictureInPictureEnabled||!("requestPictureInPicture" in HTMLVideoElement.prototype)||!("captureStream" in HTMLCanvasElement.prototype)){
      showPipSupportModal(tr("当前 Edge 或页面环境不支持传统视频画中画。","Traditional video Picture-in-Picture is not available in this Edge or page context."),`pictureInPictureEnabled=${!!document.pictureInPictureEnabled} · protocol=${location.protocol}`);return;
    }
    try{
      const video=ensureTraditionalPiPVideo(),track=playlist[currentIndex]||null;gpPipLoadCover(track?.coverUrl||track?.thumbUrl||"");renderTraditionalPiPFrame();gpVideoPipOpening=true;gpVideoPipTargetPlayback=!!isPlaying;await video.play();if(video.readyState<1)await new Promise(resolve=>{const done=()=>resolve();video.addEventListener("loadedmetadata",done,{once:true});setTimeout(done,500);});await video.requestPictureInPicture();gpVideoPipOpening=false;syncTraditionalPiP(true);
    }catch(error){cleanupTraditionalPiP();showPipSupportModal(tr("Edge 拒绝或无法创建视频画中画。请从 GP 的按钮再次尝试。","Edge denied or could not create video Picture-in-Picture. Please try again from the GP button."),`${error?.name||"Error"}: ${error?.message||"Unknown failure"}`);}
  }
  $("#pipLaunchBtn").addEventListener("click",toggleTraditionalPiP);bindMicroMotion($("#pipLaunchBtn"),"gp-pip-motion",500);
  window.addEventListener("resize",()=>{if(gpVideoPipCanvas)scheduleTraditionalPiPRefresh(false);},{passive:true});

  /* ================= audio events (bound to both decks) ================= */
  decks.forEach(d => {
    d.addEventListener("play",()=>{if(d===audio&&wantsPlayback){resetBehaviorMediaClock();setPlaybackVisualState(true);syncTraditionalPiP();}});
    d.addEventListener("playing",()=>{if(d===audio&&wantsPlayback){resetBehaviorMediaClock();setPlaybackVisualState(true);syncTraditionalPiP();}});
    d.addEventListener("pause",()=>{
      if(d!==audio)return;
      // A native pause may arrive at the terminal media time before `ended`.
      // Keep the intent across that ordering window; ordinary pauses still
      // clear it immediately below.
      if(d.ended||crossfading){setPlaybackVisualState(false);syncTraditionalPiP();return;}
      const atNaturalEnd=Number.isFinite(d.duration)&&d.duration>0&&Number.isFinite(d.currentTime)&&d.currentTime>=d.duration-.05&&wantsPlayback&&isPlaying;
      if(atNaturalEnd){deferNativeEndPause(d);setPlaybackVisualState(false);syncTraditionalPiP();return;}
      emitListeningCheckpoint("pause");
      setPlaybackVisualState(false);syncTraditionalPiP();
      if(!pendingPlayToken)wantsPlayback=false;
    });
    d.addEventListener("error",()=>{
      if(d!==audio||d.ended)return;
      pendingPlayToken=0;wantsPlayback=false;setPlaybackVisualState(false);syncTraditionalPiP();
    });
    d.addEventListener("timeupdate", () => {
      if(d !== audio || !audio.duration) return;
      settleBehaviorProgress();
      seekProgress = audio.currentTime/audio.duration;
      drawWaveform();
      if(typeof syncTraditionalPiP==="function")syncTraditionalPiP();
      $("#curTime").textContent = fmtTime(audio.currentTime);
      if(audio.currentTime - lastTimeMark > 4) flushHistory();
      maybeTriggerAutoCrossfade();
    });
    d.addEventListener("loadedmetadata", () => { if(d === audio) $("#durTime").textContent = fmtTime(audio.duration); });
    d.addEventListener("ended", () => { if(d === audio) onEnded(); });
  });

  $("#vol").addEventListener("input", () => {
    ensureAudioCtx();
    const v = parseFloat($("#vol").value);
    smoothAudioParam(masterGain.gain,v,.025);
    $("#vol").style.setProperty("--vol-pct", (v*100)+"%");
    updateVolIcon();
  });
  $("#vol").addEventListener("change",savePrefs);
  function currentVolume(){ return masterGain ? masterGain.gain.value : (parseFloat($("#vol").value)||0.7); }
  function updateVolIcon(){
    const v = currentVolume();
    $("#volIcon").innerHTML = v===0 ? '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M23 9l-6 6M17 9l6 6"/>'
      : v<0.5 ? '<path d="M11 5L6 9H2v6h4l5 4z"/>'
      : '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/>';
  }
  let lastVol = 0.7;
  $("#volIcon").addEventListener("click", () => {
    ensureAudioCtx();
    const v = currentVolume();
    const next=v>0?0:(lastVol||0.7);if(v>0)lastVol=v;
    const volumeRange=$("#vol");
    if(typeof volumeRange._gpAnimateRangeTo==="function")volumeRange._gpAnimateRangeTo(next,true);
    else{smoothAudioParam(masterGain.gain,next,.025);volumeRange.value=next;volumeRange.style.setProperty("--vol-pct",(next*100)+"%");updateVolIcon();}
  });

  $("#playBtn").addEventListener("click", togglePlay);
  $("#nextBtn").addEventListener("click", nextTrack);
  $("#prevBtn").addEventListener("click", prevTrack);
  bindImmediateMotion($("#nextBtn"),"gp-skip-motion",300);
  bindImmediateMotion($("#prevBtn"),"gp-skip-motion",300);

  /* 5.5.2: browsers do not expose Fn as a modifier. Fn+F11 therefore arrives
     as ordinary F11 and cannot be distinguished from a raw function key.
     Keep F9/F11 browser-owned; retain the requested F10 toggle and true media events. */
  const functionKeyPlayback={F10:togglePlay,MediaTrackPrevious:prevTrack,MediaPlayPause:togglePlay,MediaTrackNext:nextTrack};
  const playbackKeyActivation=new Map();
  function playbackKeyName(event){return functionKeyPlayback[event.code]?event.code:(functionKeyPlayback[event.key]?event.key:null);}
  function runPlaybackKey(event){
    const key=playbackKeyName(event),action=functionKeyPlayback[key];if(!action)return;
    if(key.startsWith("Media")&&"mediaSession" in navigator)return;
    const target=event.target;
    if(target?.matches?.("input,textarea,select,[contenteditable='true']"))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(event.repeat)return;
    const now=performance.now(),last=playbackKeyActivation.get(key)||-Infinity;
    if(now-last<120)return;
    playbackKeyActivation.set(key,now);action();
  }
  /* Edge exposes the same media press through Media Session. Listening to
     both keydown and Media Session makes press/release toggle twice. Use the
     keyboard route only as a fallback when Media Session is unavailable. */
  window.addEventListener("keydown",runPlaybackKey,true);
  window.addEventListener("blur",()=>playbackKeyActivation.clear());
  document.addEventListener("visibilitychange",()=>{if(document.hidden)playbackKeyActivation.clear();});
  if("mediaSession" in navigator){
    try{
      navigator.mediaSession.setActionHandler("previoustrack",prevTrack);
      navigator.mediaSession.setActionHandler("play",()=>{if(!isPlaying)togglePlay();});
      navigator.mediaSession.setActionHandler("pause",()=>{if(isPlaying)togglePlay();});
      navigator.mediaSession.setActionHandler("nexttrack",nextTrack);
    }catch(error){}
  }
  document.addEventListener("keydown", (e) => {
    if(e.target.matches?.("input,textarea,select,[contenteditable='true']")) return;
    if(e.code === "Space"){ e.preventDefault(); togglePlay(); }
  });

