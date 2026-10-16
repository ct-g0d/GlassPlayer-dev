  /* ================= settings ================= */
  let settingsCategory="appearance";
  function activateSettingsCategory(category){
    const valid=new Set(["appearance","playback","audio","library","data","advanced","about"]);
    settingsCategory=valid.has(category)?category:"appearance";
    $$("[data-settings-category]").forEach(button=>{
      const active=button.dataset.settingsCategory===settingsCategory;
      button.classList.toggle("active",active);button.setAttribute("aria-current",active?"page":"false");
    });
    $$('[data-settings-pane]').forEach(pane=>pane.classList.toggle("active",pane.dataset.settingsPane===settingsCategory));
    soundPanelActive=settingsCategory==="audio";
    requestAnimationFrame(()=>{
      refreshScrollEdgeFrames();
      if(soundPanelActive&&playlist[currentIndex]){ensureAudioCtx();loadWaveformFor(playlist[currentIndex]);}
      if(soundPanelActive){syncEQGeometry();syncSpatialModeGeometry();}
      if(settingsCategory==="about")renderAboutRuntimeInfo();
      if(settingsCategory==="advanced")syncTypographyPreviewLayout();
    });
  }
  $$("[data-settings-category]").forEach(button=>button.addEventListener("click",()=>activateSettingsCategory(button.dataset.settingsCategory)));
  activateSettingsCategory(settingsCategory);
  let rescanModalMode="closed";
  function openRescanConfirmation(){
    rescanModalMode="confirm";
    $("#rescanModal").classList.remove("is-scanning");$("#rescanLibraryBtn").classList.remove("is-scanning");
    $("#rescanModalTitle").textContent=tr("重新扫描歌曲库？","Rescan Music Library?");
    $("#rescanModalMessage").textContent=tr(`将重新读取当前导入的 ${playlist.length} 首歌曲，并用文件里的最新 Genre、Title、Artist、Album、日期、时长和封面更新缓存。Spectrum ID、MFCC、Energy、BPM 与收听历史不会改变。`,`The ${playlist.length} currently imported songs will be reread for current Genre, Title, Artist, Album, date, duration and artwork. Spectrum ID, MFCC, Energy, BPM and listening history will not change.`);
    $("#rescanProgress").classList.remove("show");$("#rescanProgressFill").style.width="0%";
    $("#rescanCancelBtn").style.display="";$("#rescanCancelBtn").disabled=false;$("#rescanCancelBtn").textContent=tr("取消","Cancel");
    $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("开始扫描","Start Scan");
    $("#rescanModal").classList.add("show");requestAnimationFrame(()=>$("#rescanConfirmBtn").focus());
  }
  function closeRescanModal(force=false){
    if(metadataRescanRunning||importRunning)return;
    const completedImport=rescanModalMode==="importDone"||rescanModalMode==="importError";
    if(completedImport&&!force)return;
    $("#rescanModal").classList.remove("show","is-scanning");$("#rescanLibraryBtn").classList.remove("is-scanning");rescanModalMode="closed";
    if(completedImport){requestAnimationFrame(()=>requestAnimationFrame(()=>positionCurrentQueueRow(true)));releaseImportBackgroundWork();}
  }
  async function runMetadataRescanFromModal(){
    if(rescanModalMode==="importDone"||rescanModalMode==="importError"){closeRescanModal(true);return;}
    if(rescanModalMode==="done"||rescanModalMode==="error"){closeRescanModal();return;}
    if(rescanModalMode!=="confirm"||metadataRescanRunning)return;
    rescanModalMode="running";$("#rescanLibraryBtn").disabled=true;$("#rescanLibraryBtn").classList.add("is-scanning");$("#rescanModal").classList.add("is-scanning");$("#rescanCancelBtn").style.display="none";$("#rescanConfirmBtn").disabled=true;
    $("#rescanModalTitle").textContent=tr("正在重新扫描","Rescanning Library");$("#rescanConfirmBtn").textContent=tr("扫描中…","Scanning…");
    $("#rescanProgress").classList.add("show");$("#rescanProgressFill").style.width="0%";
    try{
      const stats=await rescanImportedLibrary((completed,total)=>{
        $("#rescanProgressFill").style.width=`${total?completed/total*100:0}%`;
        $("#rescanModalMessage").textContent=tr(`正在读取 ${completed} / ${total} 首歌曲的现存数据…`,`Reading current file data: ${completed} / ${total} songs…`);
      });
      rescanModalMode="done";$("#rescanProgressFill").style.width="100%";
      $("#rescanModalTitle").textContent=tr("重新扫描完成","Rescan Complete");
      $("#rescanModalMessage").textContent=tr(`已扫描 ${stats.scanned} 首，更新 ${stats.changed} 首，读取到真实 Genre ${stats.genreFound} 首${stats.failed?`，失败 ${stats.failed} 首`:""}。所有 Spectrum 分析与收听历史均已保留。`,`Scanned ${stats.scanned} songs, updated ${stats.changed}, and found file Genre on ${stats.genreFound}${stats.failed?`; ${stats.failed} failed`:""}. All Spectrum analysis and listening history were preserved.`);
      $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("完成","Done");
      showToast(tr("音乐库现存数据已刷新","Current library metadata refreshed"));
    }catch(error){
      rescanModalMode="error";$("#rescanModalTitle").textContent=tr("重新扫描未完成","Rescan Incomplete");
      $("#rescanModalMessage").textContent=tr("扫描过程中出现错误；已经成功写入的歌曲不会回退，声学分析与历史未受影响。","An error interrupted the scan. Completed metadata updates remain saved; acoustic analysis and history were not affected.");
      $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("关闭","Close");
    }finally{$("#rescanLibraryBtn").disabled=false;$("#rescanLibraryBtn").classList.remove("is-scanning");$("#rescanModal").classList.remove("is-scanning");}
  }
  $("#rescanLibraryBtn").addEventListener("click",()=>{if(metadataRescanRunning)return;if(!playlist.length){showToast(tr("请先导入歌曲","Import songs first"));return;}openRescanConfirmation();});
  $("#rescanCancelBtn").addEventListener("click",closeRescanModal);$("#rescanConfirmBtn").addEventListener("click",runMetadataRescanFromModal);
  $("#rescanModal").addEventListener("click",event=>{if(event.target===$("#rescanModal"))closeRescanModal();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&rescanModalMode!=="closed")closeRescanModal();});

  const defaultFolderButton=$("#defaultFolderBtn"),defaultFolderHint=$("#defaultFolderHint");
  defaultFolderButton?.addEventListener("click",async()=>{
    const chooseDefaultFolder=window.GP?.commands?.chooseDefaultMusicFolder;
    if(typeof chooseDefaultFolder!=="function"){
      if(defaultFolderHint)defaultFolderHint.textContent=tr("当前浏览器不支持自动记住文件夹；请每次使用添加文件夹。","This browser cannot remember folders automatically; use Add Folder each time.");
      return;
    }
    defaultFolderButton.disabled=true;
    try{
      const count=Number(await chooseDefaultFolder())||0;
      if(defaultFolderHint)defaultFolderHint.textContent=count
        ?tr(`默认文件夹已选择；本次找到 ${count} 个音频文件。`,`Default folder selected; found {count} audio files this time.`).replace("{count}",String(count))
        :tr("默认文件夹中没有找到音频文件。","No audio files were found in the default folder.");
      showToast(count?tr("已保存默认文件夹，下次打开会自动导入音乐。","Default folder saved. Its music will be imported next time."):tr("默认文件夹中没有找到音频文件。","No audio files were found in the default folder."));
    }catch(error){
      if(error?.name!=="AbortError")showToast(tr("默认文件夹未保存。","The default folder was not saved."));
    }finally{defaultFolderButton.disabled=false;}
  });

  $("#languageSeg").addEventListener("click",e=>{const button=e.target.closest("button");if(!button)return;GP.i18n.setLanguage(button.dataset.lang);syncSortUI();renderRecommendList();$("#modeLabel").textContent=tr(modeLabels[playMode][0],modeLabels[playMode][1]);savePrefs();requestAnimationFrame(()=>{GLIDER_SELECTORS.filter(selector=>selector!=="#languageSeg").forEach(selector=>updateGlider($(selector),false));updateGlider($("#languageSeg"),true);updateNavGlider(false);});});
  let themeMode = "auto";
  let autoThemeTimer=0;
  function scheduledAutoTheme(date=new Date()){const hour=date.getHours();return hour>=18||hour<5?"dark":"light";}
  function scheduleAutoThemeBoundary(){
    clearTimeout(autoThemeTimer);if(themeMode!=="auto")return;
    const now=new Date(),next=new Date(now);next.setMinutes(0,0,0);
    if(now.getHours()<5)next.setHours(5);else if(now.getHours()<18)next.setHours(18);else{next.setDate(next.getDate()+1);next.setHours(5);}
    autoThemeTimer=setTimeout(()=>{if(themeMode==="auto")applyTheme();},Math.max(1000,next-now+50));
  }
  function applyTheme(){
    const accentRequestToken=++adaptiveAccentRequestToken;
    const actual = themeMode==="auto" ? scheduledAutoTheme() : themeMode;
    const previousActual=document.body.getAttribute("data-theme");
    document.body.setAttribute("data-theme", actual);
    $$("#themeSeg button").forEach(b => b.classList.toggle("active", b.dataset.v===themeMode));
    if(adaptiveColorOn){refreshAdaptiveAccentForTheme();applyAdaptiveAccent(accentRequestToken);}
    else setAccent(accentKey,{refreshAmbient:false,persist:false});
    if(previousActual!==actual)requestAnimationFrame(()=>updateAmbient());
    updateFavoriteAnswerContrast();
    updateAdaptiveTextColors();updateContextualControlColors();scheduleAutoThemeBoundary();
    requestAnimationFrame(()=>{refreshScrollEdgeFrames();GPUIRegistry.refresh(document,false);});
  }
  $("#themeSeg").addEventListener("click", (e) => {
    const b=e.target.closest("button");if(!b)return;
    const themeGroup=$("#themeSeg"),previousActive=themeGroup.querySelector("button.active");
    const themeGliderOrigin=previousActive?{
      x:previousActive.offsetLeft,y:previousActive.offsetTop,
      w:previousActive.offsetWidth,h:previousActive.offsetHeight
    }:null;
    themeMode=b.dataset.v;applyTheme();savePrefs();
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const glider=themeGroup.querySelector(":scope>.segment-glider");
      if(glider&&themeGliderOrigin){
        glider._gpMotion?.cancel();glider._gpMotion=null;
        glider.dataset.x=themeGliderOrigin.x;glider.dataset.y=themeGliderOrigin.y;
        glider.dataset.w=themeGliderOrigin.w;glider.dataset.h=themeGliderOrigin.h;
        glider.style.width=`${themeGliderOrigin.w}px`;glider.style.height=`${themeGliderOrigin.h}px`;
        glider.style.transform=`translate3d(${themeGliderOrigin.x}px,${themeGliderOrigin.y}px,0)`;
      }
      updateGlider(themeGroup,true);
    }));
  });

  $("#coverSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if(!b) return;
    coverDisplayMode = b.dataset.v;
    $$("#coverSeg button").forEach(x=>x.classList.toggle("active", x===b));
    updateArtDisplay(); savePrefs();
  });

  $("#bgSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if(!b) return;
    bgMode = b.dataset.v;
    $$("#bgSeg button").forEach(x=>x.classList.toggle("active", x===b));
    if(typeof reserveAmbientTransitionWindow==="function")reserveAmbientTransitionWindow(340);
    updateAmbient(); savePrefs();
  });

  function setAdaptiveColorEnabled(value){
    adaptiveColorOn = !!value;
    $("#adaptiveColorToggle").classList.toggle("on", adaptiveColorOn);
    syncAccentAvailability();
    if(adaptiveColorOn) applyAdaptiveAccent(); else setAccent(accentKey);
    savePrefs();
  }
  function syncCrossfadeAvailability(){
    const control=$("#crossfadeControl");if(control){control.classList.toggle("crossfade-disabled",!crossfadeEnabled);control.setAttribute("aria-disabled",String(!crossfadeEnabled));}
    $("#crossfadeSlider").disabled=!crossfadeEnabled;
  }
  function setCrossfadeEnabled(value){
    crossfadeEnabled = !!value;
    $("#crossfadeToggle").classList.toggle("on", crossfadeEnabled);
    syncCrossfadeAvailability();
    savePrefs();
  }
  function setLoudnessNormalizationEnabled(value){
    loudnessNormalizationEnabled=!!value;
    $("#loudnessNormalizeToggle").classList.toggle("on",loudnessNormalizationEnabled);
    if(audioCtx){applyCurrentTrackNormalization();syncAudioHeadroom();}
    savePrefs();
  }
  function renderSpatialInfo(){
    $("#spatialInfoList").innerHTML=GP.spatialPresets.getAllPresets().filter(preset=>preset.id!=="none").map(preset=>`<li><strong>${escapeHTML(tr(preset.name.zh,preset.name.en))}</strong> · ${escapeHTML(tr(preset.description.zh,preset.description.en))}</li>`).join("");
  }
  function renderLoudnessInfo(){
    $("#loudnessInfoList").innerHTML=tr(
      "<li><strong>自动均衡</strong> · 以当前曲库最响歌曲为参考。</li><li>只抬高较安静歌曲的播放增益，不压低较响歌曲。</li><li>不修改音频文件；响度数值仍显示原曲数据。</li>",
      "<li><strong>Auto Balance</strong> · Uses the loudest track in the current library as reference.</li><li>Raises quieter playback only; louder tracks are never turned down.</li><li>Audio files stay untouched and Loudness still shows source data.</li>"
    );
  }
  function syncSpatialModeGeometry(){
    const group=$("#spatialModeSeg");if(!group)return;
    const display=getComputedStyle(group).display;
    if(display==="grid"){group.style.width="100%";group.style.maxWidth="100%";return;}
    /* The Settings pane owns this strip. Let its glass frame end at the last
       wrapped option while retaining the existing narrow-container grid. */
    group.style.width="max-content";group.style.maxWidth="100%";
  }
  let eqGeometryFrame=0;
  function syncEQGeometry(){
    cancelAnimationFrame(eqGeometryFrame);
    eqGeometryFrame=requestAnimationFrame(()=>{
      const stage=$(".eq-curve-stage"),curve=$("#eqCurveVisual"),bands=$("#eqBands");
      if(!stage||!curve||!bands||!stage.offsetWidth)return;
      const compact=window.matchMedia("(max-width:660px)").matches;
      const stageRect=stage.getBoundingClientRect(),visualRect=curve.getBoundingClientRect();
      if(!visualRect.width||!visualRect.height)return;
      const viewBox=curve.viewBox?.baseVal,viewWidth=viewBox?.width||700,viewHeight=viewBox?.height||180;
      const scale=Math.min(visualRect.width/viewWidth,visualRect.height/viewHeight);
      const contentWidth=viewWidth*scale,contentHeight=viewHeight*scale;
      const contentLeft=visualRect.left+(visualRect.width-contentWidth)/2;
      const contentTop=visualRect.top+(visualRect.height-contentHeight)/2;
      const plotLeft=contentLeft+50*scale,plotRight=contentLeft+650*scale;
      const plotTop=contentTop+22*scale,plotBottom=contentTop+162*scale;
      bands.style.left=`${Math.round(plotLeft-stageRect.left)}px`;
      bands.style.width=`${Math.round(plotRight-plotLeft)}px`;
      bands.style.right="auto";bands.style.top=`${Math.round(plotTop-stageRect.top)}px`;
      bands.style.height=`${Math.max(31,Math.round(plotBottom-plotTop+31))}px`;bands.style.bottom="auto";
      bands.dataset.gpGeometry="aligned";
    });
  }
  function syncSpatialUI(animate=false,revealAtSelection=false){
    $("#spatialToggle").classList.toggle("on",spatialEnabled);
    $$("#spatialModeSeg button").forEach(button=>{const selected=spatialEnabled&&button.dataset.spatial===spatialMode;button.classList.toggle("active",selected);button.setAttribute("aria-pressed",String(selected));if(!spatialEnabled)button.classList.remove("gp-press-held","gp-press-release","glow-pulse");});
    const group=$("#spatialModeSeg");renderSpatialInfo();syncSpatialModeGeometry();
    const glider=group.querySelector(":scope>.segment-glider");
    if(!spatialEnabled){glider?._gpMotion?.cancel();if(glider){glider._gpMotion=null;glider.getAnimations().forEach(animation=>animation.cancel());}group.classList.remove("spatial-on");return;}
    if(revealAtSelection){group.classList.add("spatial-on");updateGlider(group,false);const revealed=group.querySelector(":scope>.segment-glider");revealed?.animate([{opacity:0},{opacity:1}],{duration:155,easing:"ease-out"});}
    else{group.classList.add("spatial-on");requestAnimationFrame(()=>updateGlider(group,animate));}
  }
  function selectSpatialMode(mode,persist=true){
    if(!GP.spatialPresets.getPreset(mode)||mode==="none")mode="desktop";const wasEnabled=spatialEnabled;spatialLastMode=mode;spatialMode=mode;spatialEnabled=true;syncSpatialUI(wasEnabled,!wasEnabled);if(spatialEngine)applySpatialParameters();syncAudioHeadroom();if(persist)savePrefs();
  }
  function setSpatialEnabled(value){const next=!!value;if(!next&&spatialEnabled)spatialLastMode=spatialMode;spatialEnabled=next;if(spatialEnabled)spatialMode=GP.spatialPresets.getPreset(spatialLastMode)&&spatialLastMode!=="none"?spatialLastMode:"desktop";syncSpatialUI(false,spatialEnabled);if(spatialEngine)applySpatialParameters();syncAudioHeadroom();savePrefs();}
  $("#spatialModeSeg").addEventListener("click",event=>{const button=event.target.closest("button[data-spatial]");if(button)selectSpatialMode(button.dataset.spatial);});
  function createSoundInfoController(buttonSelector,popSelector,render,widthLimit=310){
    const button=$(buttonSelector),pop=$(popSelector);let hoverTimer=0,hideTimer=0;
    function playMotion(){restartCssMotion(button,"info-motion");clearTimeout(button._motionTimer);button._motionTimer=setTimeout(()=>button.classList.remove("info-motion"),340);}
    function position(){const anchor=button.getBoundingClientRect(),width=Math.min(widthLimit,Math.max(220,innerWidth-24));pop.style.width=`${width}px`;const height=Math.min(pop.scrollHeight,innerHeight-24),left=Math.max(12,Math.min(innerWidth-width-12,anchor.right-width));let top=anchor.bottom+8;if(top+height>innerHeight-12)top=Math.max(12,anchor.top-height-8);pop.style.left=`${Math.round(left)}px`;pop.style.top=`${Math.round(top)}px`;}
    function show(){clearTimeout(hoverTimer);clearTimeout(hideTimer);render();if(!pop.classList.contains("gp-spatial-info-portal")){document.body.appendChild(pop);pop.classList.add("gp-spatial-info-portal");}setMotionPopover(pop,true);pop.setAttribute("aria-hidden","false");requestAnimationFrame(()=>{position();requestAnimationFrame(position);});}
    function hide(){clearTimeout(hoverTimer);clearTimeout(hideTimer);setMotionPopover(pop,false);pop.setAttribute("aria-hidden","true");}
    function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(hide,140);}
    button.addEventListener("pointerenter",()=>{playMotion();clearTimeout(hoverTimer);hoverTimer=setTimeout(show,100);});
    button.addEventListener("pointerleave",()=>{clearTimeout(hoverTimer);scheduleHide();});
    button.addEventListener("click",event=>{event.stopPropagation();if(pop.classList.contains("show"))return;playMotion();show();});
    pop.addEventListener("pointerenter",()=>clearTimeout(hideTimer));pop.addEventListener("pointerleave",scheduleHide);
    return{button,pop,position,hide};
  }
  const spatialInfoController=createSoundInfoController("#spatialInfoBtn","#spatialInfoPop",renderSpatialInfo,310);
  const loudnessInfoController=createSoundInfoController("#loudnessInfoBtn","#loudnessInfoPop",renderLoudnessInfo,290);
  document.addEventListener("click",event=>{[spatialInfoController,loudnessInfoController].forEach(controller=>{if(!controller.button.contains(event.target)&&!controller.pop.contains(event.target))controller.hide();});});
  window.addEventListener("resize",()=>{spatialInfoController.position();loudnessInfoController.position();syncTypographyPreviewLayout();syncEQGeometry();syncSpatialModeGeometry();},{passive:true});
  $("#settingsPanel")?.addEventListener("scroll",()=>{spatialInfoController.position();loudnessInfoController.position();},{passive:true});
  function bindDragToggle(button,getValue,setValue){
    if(!button)return;let startX=0,dragging=false,suppressClickUntil=0;
    button.addEventListener("pointerdown",event=>{
      if(event.button!==0)return;startX=event.clientX;dragging=false;button.setPointerCapture?.(event.pointerId);
    });
    button.addEventListener("pointermove",event=>{
      if(!button.hasPointerCapture?.(event.pointerId))return;
      if(Math.abs(event.clientX-startX)>3)dragging=true;
      if(dragging){const rect=button.getBoundingClientRect();button.classList.toggle("on",event.clientX>=rect.left+rect.width/2);}
    });
    button.addEventListener("pointerup",event=>{
      if(!button.hasPointerCapture?.(event.pointerId))return;
      button.releasePointerCapture?.(event.pointerId);
      if(dragging){const rect=button.getBoundingClientRect();setValue(event.clientX>=rect.left+rect.width/2);suppressClickUntil=performance.now()+120;}
      else button.classList.toggle("on",!!getValue());
      dragging=false;
    });
    button.addEventListener("pointercancel",()=>{dragging=false;button.classList.toggle("on",!!getValue());});
    button.addEventListener("click",event=>{if(performance.now()<suppressClickUntil){event.preventDefault();return;}setValue(!getValue());});
  }
  bindDragToggle($("#adaptiveColorToggle"),()=>adaptiveColorOn,setAdaptiveColorEnabled);
  bindDragToggle($("#crossfadeToggle"),()=>crossfadeEnabled,setCrossfadeEnabled);
  bindDragToggle($("#spatialToggle"),()=>spatialEnabled,setSpatialEnabled);
  bindDragToggle($("#loudnessNormalizeToggle"),()=>loudnessNormalizationEnabled,setLoudnessNormalizationEnabled);
  let fluidMotionEnabled=true,continuousPlayEnabled=true,keyboardControlsEnabled=true;
  bindDragToggle($("#fluidMotionToggle"),()=>fluidMotionEnabled,value=>{
    fluidMotionEnabled=!!value;
    $("#fluidMotionToggle")?.classList.toggle("on",fluidMotionEnabled);
    savePrefs();
  });
  bindDragToggle($("#continuousPlayToggle"),()=>continuousPlayEnabled,value=>{
    continuousPlayEnabled=!!value;
    $("#continuousPlayToggle")?.classList.toggle("on",continuousPlayEnabled);
    savePrefs();
  });
  bindDragToggle($("#keyboardControlsToggle"),()=>keyboardControlsEnabled,value=>{
    keyboardControlsEnabled=!!value;
    $("#keyboardControlsToggle")?.classList.toggle("on",keyboardControlsEnabled);
    savePrefs();
  });
  $("#resetPrefsBtn")?.addEventListener("click",()=>{
    themeMode="auto";
    coverDisplayMode="rotate";
    bgMode="glow";
    adaptiveColorOn=true;
    crossfadeEnabled=false;
    crossfadeSeconds=3;
    spatialEnabled=false;
    loudnessNormalizationEnabled=false;
    fluidMotionEnabled=true;
    continuousPlayEnabled=true;
    keyboardControlsEnabled=true;
    setAccent("navy");
    applyTheme();
    $("#crossfadeToggle")?.classList.toggle("on",crossfadeEnabled);
    $("#spatialToggle")?.classList.toggle("on",spatialEnabled);
    $("#loudnessNormalizeToggle")?.classList.toggle("on",loudnessNormalizationEnabled);
    $("#fluidMotionToggle")?.classList.toggle("on",fluidMotionEnabled);
    $("#continuousPlayToggle")?.classList.toggle("on",continuousPlayEnabled);
    $("#keyboardControlsToggle")?.classList.toggle("on",keyboardControlsEnabled);
    $("#fontSizeSlider").value=1;
    document.documentElement.style.setProperty("--font-scale","1");
    $("#fontWeightSlider").value=450;
    applyFontWeight(450);
    savePrefs();
    showToast(tr("已恢复默认设置","Settings restored to defaults"));
  });
  function formatCrossfadeValue(value){return `${Number(value).toFixed(1)}s`;}
  $("#crossfadeSlider").addEventListener("input", () => {
    crossfadeSeconds = parseFloat($("#crossfadeSlider").value);
    $("#crossfadeValue").textContent = formatCrossfadeValue(crossfadeSeconds);
    savePrefs();
  });

  const swatchWrap = $("#accentSwatches");
  function syncAccentAvailability(){
    const group=$("#accentColorGroup");if(!group)return;
    group.classList.toggle("accent-disabled",adaptiveColorOn);group.setAttribute("aria-disabled",String(adaptiveColorOn));
    $$("#accentSwatches .swatch").forEach(button=>{button.disabled=adaptiveColorOn;button.setAttribute("aria-disabled",String(adaptiveColorOn));});
  }
  Object.keys(accentPalettes).forEach(key => {
    const b = document.createElement("button");
    b.className = "swatch ripple-target"; b.dataset.k = key;
    b.style.setProperty("--swatch-fill",key === "mono" ? "linear-gradient(135deg, #000000 0 50%, #8e8e93 50% 100%)" : `linear-gradient(135deg, ${accentPalettes[key][0]}, ${accentPalettes[key][1]})`);
    b.addEventListener("click", () => {if(!adaptiveColorOn)setAccent(key);});
    swatchWrap.appendChild(b);
  });

  const GP_FONT_LANGUAGE_STACKS=Object.freeze({
    zh:'"PingFang SC", "PingFang TC", "PingFang HK", "Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI", Arial, sans-serif',
    en:'"Segoe UI", Arial, "SF Pro Text", sans-serif',
    ru:'"Segoe UI", Arial, "SF Pro Text", sans-serif'
  });
  const GP_FONT_SERIF_STACKS=Object.freeze({
    zh:'"Songti SC", "Songti TC", "Noto Serif SC", "Source Han Serif SC", "SimSun", "STSong", "Times New Roman", serif',
    en:'Georgia, "Times New Roman", "Songti SC", "SimSun", serif',
    ru:'Georgia, "Times New Roman", serif'
  });
  const GP_FONT_MONO_STACKS=Object.freeze({
    zh:'Consolas, "Courier New", "PingFang SC", "Microsoft YaHei", monospace',
    en:'Consolas, "Courier New", monospace',
    ru:'Consolas, "Courier New", monospace'
  });
  const GP_APPLE_FONT_ROLES=Object.freeze({
    zh:Object.freeze({base:'"SF Pro", "SF Pro Text", "PingFang SC", "PingFang TC", "PingFang HK", "Segoe UI", Arial, sans-serif',display:'"SF Pro Display", "SF Pro", "PingFang SC", "PingFang TC", "PingFang HK", "Segoe UI", Arial, sans-serif',text:'"SF Pro Text", "SF Pro", "PingFang SC", "PingFang TC", "PingFang HK", "Segoe UI", Arial, sans-serif',mono:'"SF Mono", "SF Pro", "PingFang SC", "PingFang TC", "Segoe UI", Consolas, monospace'}),
    en:Object.freeze({base:'"SF Pro", "SF Pro Text", "Segoe UI", Arial, sans-serif',display:'"SF Pro Display", "SF Pro", "Segoe UI", Arial, sans-serif',text:'"SF Pro Text", "SF Pro", "Segoe UI", Arial, sans-serif',mono:'"SF Mono", "SF Pro", "Segoe UI", Consolas, monospace'}),
    ru:Object.freeze({base:'"SF Pro", "SF Pro Text", "Segoe UI", Arial, sans-serif',display:'"SF Pro Display", "SF Pro", "Segoe UI", Arial, sans-serif',text:'"SF Pro Text", "SF Pro", "Segoe UI", Arial, sans-serif',mono:'"SF Mono", "SF Pro", "Segoe UI", Consolas, monospace'})
  });
  function fontLanguage(){return uiLanguage==="ru"?"ru":uiLanguage==="en"?"en":"zh";}
  function appendFontLanguageFallback(value,language){
    const raw=String(value||"").trim();
    const isMono=/\bmonospace\s*$/i.test(raw);
    const isSerif=!isMono && /(?:^|[,\s])serif\s*$/i.test(raw);
    const base=raw.replace(/,\s*(?:sans-serif|serif|monospace)\s*$/i,"").trim();
    if(isSerif){
      return `${base}, ${(GP_FONT_SERIF_STACKS[language]||GP_FONT_SERIF_STACKS.zh)}`;
    }
    if(isMono){
      return `${base}, ${(GP_FONT_MONO_STACKS[language]||GP_FONT_MONO_STACKS.zh)}`;
    }
    return `${base}, ${(GP_FONT_LANGUAGE_STACKS[language]||GP_FONT_LANGUAGE_STACKS.zh)}`;

  }
  function syncTypographyLanguage(){
    const select=$("#fontSelect"),selected=select?.options?.[select.selectedIndex];if(!select||!selected)return;
    const language=fontLanguage(),isApple=selected.dataset.fontProfile==="apple",root=document.documentElement;
    root.dataset.fontLanguage=language;
    let effectiveStack=appendFontLanguageFallback(selected.value,language);
    if(isApple){
      const roles=GP_APPLE_FONT_ROLES[language];root.dataset.fontProfile="apple";
      Object.entries(roles).forEach(([role,stack])=>root.style.setProperty(`--gp-font-${role}`,stack));
      effectiveStack=roles.text;
    }else{
      root.removeAttribute("data-font-profile");
      ["base","display","text","mono"].forEach(role=>root.style.removeProperty(`--gp-font-${role}`));
    }
    root.style.setProperty("--font-family",effectiveStack);
    const preview=$("#fontPreview");if(preview){preview.style.fontFamily=effectiveStack;preview.lang=document.documentElement.lang||language;}
    if(typeof realignTypographyGliders==="function")realignTypographyGliders();
  }
  function applyFontFamily(){syncTypographyLanguage();}
  function primaryStackFamily(stack){
    const match=String(stack||"").match(/^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/);
    return (match?.[1]||match?.[2]||match?.[3]||"").trim();
  }
  function verifyFontAvailable(stack){
    // 7.4.0: a missing family used to fail silently (CJK kept PingFang while
    // the Apple profile fell back to Segoe UI). Tell the user instead.
    try{
      const family=primaryStackFamily(stack),generic=family.toLowerCase();
      if(!family||generic==="sans-serif"||generic==="serif"||generic==="monospace")return;
      if(document.fonts?.check&&!document.fonts.check(`16px "${family.replace(/"/g,"")}"`))showToast(tr(`系统未安装「${family}」，已使用回退字体`,`“${family}” is not installed; using a fallback font`));
    }catch(error){}
  }
  function syncFontPicker(){
    const select = $("#fontSelect");
    const selected = select.options[select.selectedIndex];
    $("#fontPickerLabel").textContent = selected ? selected.textContent : "选择字体";
    $$("#fontPickerPop .font-picker-option").forEach(button => {
      button.classList.toggle("active", button.dataset.fontValue === select.value);
    });
  }
  function syncTypographyPreviewLayout(){
    const preview=$("#fontPreview"),group=preview?.closest(".setting-group");if(!preview||!group)return;
    const label=group.querySelector(":scope > .setting-label"),picker=group.querySelector(":scope > .font-picker");
    const compact=window.matchMedia("(max-width:900px)").matches;
    preview.style.gridColumn=compact?"1":"1 / -1";preview.style.gridRow="1";preview.style.justifySelf="center";
    preview.style.width="min(100%, 340px)";preview.style.maxWidth="340px";preview.style.marginTop="0";preview.style.textAlign="center";
    if(label){label.style.gridColumn="1";label.style.gridRow=compact?"2":"2 / span 2";}
    if(picker){picker.style.gridColumn=compact?"1":"2";picker.style.gridRow=compact?"3":"2 / span 2";picker.style.justifySelf=compact?"start":"end";}
    group.dataset.typographyLayout="preview-first";
  }
  let aboutRuntimeInfoNode=null;
  function renderAboutRuntimeInfo(){
    const pane=$('[data-settings-pane="about"]'),card=pane?.querySelector(".build-card");if(!pane||!card)return;
    if(!aboutRuntimeInfoNode){aboutRuntimeInfoNode=document.createElement("div");aboutRuntimeInfoNode.className="about-runtime-info";card.after(aboutRuntimeInfoNode);}
    const runtime=window.GP||{},engines=runtime.engines||{};
    const engineList=["core","bionic","fusion","motion","spatial","spectrum","neural"].map(key=>engines[key]).filter(Boolean).join(" · ");
    const rows=[
      [tr("运行身份","Runtime identity"),`Glass Player Gen ${runtime.generation||7} · Kinetic Glass · ${runtime.version||"7.6.2"}`],
      [tr("架构","Architecture"),runtime.architecture||"Peregrine Lake"],
      [tr("引擎","Engines"),engineList||"GP Core 4.3 — Kinetic Runtime · GP Bionic Engine 1.0 — Intelligence Core · GP Fusion Engine 4.2 — Playlist Flow · GP Motion Engine 4.2 — Kinetic Motion · GP Spatial Engine 1.1 — Room · GP Spectrum Engine 2.3 — Signal · GP Neural Engine 2.2 — Listening DNA"],
      [tr("数据安全","Cache safety"),tr("本地单一运行时；设置不新增状态，音频分析与听歌历史继续使用现有缓存边界。","One local runtime; Settings adds no state, and audio analysis and listening history keep their existing cache boundaries.")]
    ];
    aboutRuntimeInfoNode.innerHTML=rows.map(([label,value])=>`<div class="setting-row settings-note-row"><div class="setting-copy"><div class="setting-label">${escapeHTML(label)}</div><div class="setting-hint">${escapeHTML(value)}</div></div></div>`).join("");
    aboutRuntimeInfoNode.querySelectorAll(".setting-hint").forEach(node=>node.style.setProperty("display","block","important"));
  }
  function closeFontPicker(){
    setMotionPopover($("#fontPickerPop"),false);
    $("#fontPickerBtn").classList.remove("open");
    $("#fontPickerBtn").setAttribute("aria-expanded", "false");
  }
  function positionFontPickerPortal(){
    const button=$("#fontPickerBtn"),pop=$("#fontPickerPop");
    if(!button||!pop||!pop.classList.contains("gp-font-portal"))return;
    const rect=button.getBoundingClientRect(),margin=10,gap=8;
    pop.style.setProperty("--font-pop-width",`${rect.width}px`);
    const popHeight=Math.min(pop.scrollHeight||260,Math.min(380,window.innerHeight*.7));
    let top=rect.top-popHeight-gap;
    if(top<margin)top=Math.min(window.innerHeight-popHeight-margin,rect.bottom+gap);
    const left=Math.max(margin,Math.min(window.innerWidth-rect.width-margin,rect.left));
    pop.style.left=`${left}px`;pop.style.top=`${Math.max(margin,top)}px`;
  }
  function refreshFontAvailability(){
    // 7.4.0: mark options whose first family is not installed so a silent
    // fallback is never mistaken for a broken switch.
    $$("#fontPickerPop .font-picker-option").forEach(button=>{
      let available=true;
      try{
        const family=primaryStackFamily(button.dataset.fontValue);
        if(family&&document.fonts?.check)available=document.fonts.check(`16px "${family.replace(/"/g,"")}"`);
      }catch(error){available=true;}
      button.dataset.available=available?"1":"0";
      if(available)button.removeAttribute("title");
      else button.title=tr("系统未安装此字体，会使用回退字体","This font is not installed; a fallback will be used");
    });
  }
  function buildFontPicker(){
    const select = $("#fontSelect");
    const pop = $("#fontPickerPop");
    pop.innerHTML = "";
    Array.from(select.children).forEach(group => {
      if(group.tagName !== "OPTGROUP") return;
      const heading = document.createElement("div");
      heading.className = "font-picker-group";
      heading.textContent = group.label;
      pop.appendChild(heading);
      Array.from(group.children).forEach(option => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "font-picker-option ripple-target";
        button.dataset.fontValue = option.value;
        button.dataset.fontProfile = option.dataset.fontProfile || "single";
        button.textContent = option.textContent;
        if(option.dataset.fontProfile !== "apple")button.style.fontFamily = option.value;
        button.addEventListener("click", e => {
          e.stopPropagation();
          select.value = option.value;
          select.dispatchEvent(new Event("change", {bubbles:true}));
          closeFontPicker();
        });
        pop.appendChild(button);
      });
    });
    $("#fontPickerBtn").addEventListener("click", e => {
      e.stopPropagation();
      const show = !pop.classList.contains("show");
      if(show&&!pop.classList.contains("gp-font-portal")){
        document.body.appendChild(pop);pop.classList.add("gp-font-portal");
      }
      setMotionPopover(pop,show);
      if(show)requestAnimationFrame(positionFontPickerPortal);
      $("#fontPickerBtn").classList.toggle("open", show);
      $("#fontPickerBtn").setAttribute("aria-expanded", String(show));
    });
    document.addEventListener("click", e => { if(!e.target.closest("#fontPicker")&&!e.target.closest("#fontPickerPop")) closeFontPicker(); });
    window.addEventListener("resize",()=>{if(pop.classList.contains("show"))requestAnimationFrame(positionFontPickerPortal);},{passive:true});
    syncFontPicker();refreshFontAvailability();
    if(document.fonts?.ready)document.fonts.ready.then(()=>refreshFontAvailability());
  }
  let typographyGliderFrame=0;
  function realignTypographyGliders(){
    cancelAnimationFrame(typographyGliderFrame);
    typographyGliderFrame=requestAnimationFrame(()=>requestAnimationFrame(()=>{initializeSelectionGliders();fitActiveView();}));
  }
  $("#fontSelect").addEventListener("change", () => {
    applyFontFamily();
    verifyFontAvailable(document.documentElement.style.getPropertyValue("--font-family"));
    syncFontPicker();
    savePrefs();
    scheduleViewportFit();
    realignTypographyGliders();
  });
  $("#fontSizeSlider").addEventListener("input", () => { document.documentElement.style.setProperty("--font-scale", $("#fontSizeSlider").value); savePrefs(); scheduleViewportFit(); realignTypographyGliders(); });
  function fontWeightLabel(weight){
    const value=Number(weight)||450;
    if(value<=350)return tr("细","Light");
    if(value<=450)return tr("常规","Regular");
    if(value<=550)return tr("中等","Medium");
    if(value<=650)return tr("半粗","Semibold");
    if(value<=750)return tr("粗","Bold");
    return tr("特粗","Heavy");
  }
  function applyFontWeight(weight){
    weight=Math.max(300,Math.min(800,Number(weight)||450));
    document.documentElement.style.setProperty("--font-weight",weight);
    /* Use the font's real variable/declared weight. Artificial strokes create
       double-sampled edges at fractional Edge zoom levels. */
    document.documentElement.style.setProperty("--font-stroke","0px");
    $("#fontWeightValue").textContent=fontWeightLabel(weight);
  }
  $("#fontWeightSlider").addEventListener("input", () => {
    applyFontWeight($("#fontWeightSlider").value);
    savePrefs();
    realignTypographyGliders();
  });

  function savePrefs(){
    try{
      GPBrowserStorage.setLocal("glassPlayerPrefs", JSON.stringify({
        themeMode, accentKey, coverDisplayMode, bgMode, uiLanguage,
        font: $("#fontSelect").value, fontScale: $("#fontSizeSlider").value, fontWeight: $("#fontWeightSlider").value,
        volume: currentVolume(), playMode, playbackRate,
        crossfadeEnabled, crossfadeSeconds, adaptiveColorOn, spatialEnabled, spatialMode, spatialLastMode, loudnessNormalizationEnabled,
        fluidMotionEnabled, continuousPlayEnabled, keyboardControlsEnabled,
        eqPresetKey, eqGains, customEQGains
      }));
    }catch(e){}
    if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);
  }
  function loadPrefs(){
    let p; try{ p = JSON.parse(GPBrowserStorage.getLocal("glassPlayerPrefs")); }catch(e){}
    if(!p) p = {};
    uiLanguage = p.uiLanguage === "en" ? "en" : p.uiLanguage === "ru" ? "ru" : "zh";
    themeMode = ["auto","light","dark"].includes(p.themeMode) ? p.themeMode : "auto";
    coverDisplayMode = ["rotate","static"].includes(p.coverDisplayMode) ? p.coverDisplayMode : "rotate";
    bgMode = ["glow","color","blur"].includes(p.bgMode) ? p.bgMode : "glow";
    $$("#coverSeg button").forEach(b => b.classList.toggle("active", b.dataset.v===coverDisplayMode));
    $$("#bgSeg button").forEach(b => b.classList.toggle("active", b.dataset.v===bgMode));
    const fontOptions=Array.from($("#fontSelect").options);
    if(p.font&&fontOptions.some(option=>option.value===p.font))$("#fontSelect").value=p.font;
    else $("#fontSelect").selectedIndex=0;
    applyFontFamily();
    $("#fontSizeSlider").value = p.fontScale || 1;
    document.documentElement.style.setProperty("--font-scale", $("#fontSizeSlider").value);
    $("#fontWeightSlider").value=p.fontWeight||450;
    applyFontWeight($("#fontWeightSlider").value);
    const savedVolume = p.volume !== undefined ? p.volume : 0.7;
    $("#vol").value = savedVolume; $("#vol").style.setProperty("--vol-pct",(savedVolume*100)+"%");
    if(masterGain) masterGain.gain.value = savedVolume; // if audio ctx already exists, apply immediately
    const storedPlaybackRate=Number(p.playbackRate),validPlaybackRates=[.5,.75,1,1.5,2];
    const restoredPlaybackRate=validPlaybackRates.find(rate=>Math.abs(rate-storedPlaybackRate)<.005)??1;
    applyPlaybackRate(restoredPlaybackRate,{syncSlider:true,persist:false});
    crossfadeEnabled = !!p.crossfadeEnabled;
    $("#crossfadeToggle").classList.toggle("on", crossfadeEnabled);
    syncCrossfadeAvailability();
    crossfadeSeconds = Math.max(.5,Math.min(3,Number(p.crossfadeSeconds)||3));
    $("#crossfadeSlider").value = crossfadeSeconds;
    $("#crossfadeValue").textContent = formatCrossfadeValue(crossfadeSeconds);
    spatialMode=GP.spatialPresets.getPreset(p.spatialMode)&&p.spatialMode!=="none"?p.spatialMode:"desktop";
    spatialLastMode=GP.spatialPresets.getPreset(p.spatialLastMode)&&p.spatialLastMode!=="none"?p.spatialLastMode:spatialMode;
    spatialEnabled=!!p.spatialEnabled;
    syncSpatialUI(false);
    loudnessNormalizationEnabled=!!p.loudnessNormalizationEnabled;
    $("#loudnessNormalizeToggle").classList.toggle("on",loudnessNormalizationEnabled);
    fluidMotionEnabled = p.fluidMotionEnabled !== undefined ? !!p.fluidMotionEnabled : true;
    continuousPlayEnabled = p.continuousPlayEnabled !== undefined ? !!p.continuousPlayEnabled : true;
    keyboardControlsEnabled = p.keyboardControlsEnabled !== undefined ? !!p.keyboardControlsEnabled : true;
    $("#fluidMotionToggle")?.classList.toggle("on", fluidMotionEnabled);
    $("#continuousPlayToggle")?.classList.toggle("on", continuousPlayEnabled);
    $("#keyboardControlsToggle")?.classList.toggle("on", keyboardControlsEnabled);
    adaptiveColorOn = !!p.adaptiveColorOn;
    $("#adaptiveColorToggle").classList.toggle("on", adaptiveColorOn);
    syncAccentAvailability();
    const validSavedGains=values=>Array.isArray(values)&&values.length===7&&values.every(value=>Number.isFinite(Number(value)));
    customEQGains=validSavedGains(p.customEQGains)?p.customEQGains.map(Number):p.eqPresetKey==="custom"&&validSavedGains(p.eqGains)?p.eqGains.map(Number):eqPresets.flat.slice();
    eqPresetKey=p.eqPresetKey==="custom"||eqPresets[p.eqPresetKey]?p.eqPresetKey:"flat";
    eqGains=(eqPresetKey==="custom"?customEQGains:eqPresets[eqPresetKey]).slice();
    buildEQUI();
    syncEQGeometry();syncSpatialModeGeometry();syncTypographyPreviewLayout();
    setEQPresetLabel(eqPresetKey);
    setMode(["sequential","shuffle","repeatOne"].includes(p.playMode)?p.playMode:"sequential");
    setAccent(p.accentKey || "navy");
    applyTheme(); updateVolIcon();
  }
