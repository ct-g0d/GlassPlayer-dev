  /* ================= equalizer (real Web Audio filter chain) ================= */
  const eqBandFreqs = [60, 150, 400, 1000, 2400, 6000, 15000];
  const eqBandLabels = ["60Hz","150Hz","400Hz","1kHz","2.4kHz","6kHz","15kHz"];
  const GP_EQ_POINTER_CURVE_EXPONENT=1.7;
  function eqGainFromPointer(y){
    const normalized=Math.max(-1,Math.min(1,(92-y)/70));
    const curved=Math.sign(normalized)*12*Math.pow(Math.abs(normalized),GP_EQ_POINTER_CURVE_EXPONENT);
    return Math.max(-12,Math.min(12,Math.round(curved*2)/2));
  }
  const eqPresets = {
    flat:  [0,0,0,0,0,0,0],
    bass:  [6,5,3,1,0,-1,-1],
    vocal: [-2,-1,1,3,3,1,-1],
    treble:[-1,-1,0,1,3,5,6],
    electronic:[6,4,0,-2,-2,3,5],
    monitor:[-3.5,-4,-2.5,0.5,2,2.5,1],
    qc35:[-2,-1,1,2,1,2,3],
    qcearbuds:[-1,-2,0,1,1,2,2],
    poly:[4,2,-1,-2,-3,1,0],
    /* Conservative B&O-style compensation: broad, warm low end and clear
       upper detail without pretending this is a measured device correction. */
    zhang1:[1.4,.8,-.4,.2,.8,1.2,.7]
  };
  const eqPresetNames={
    flat:["原始","Flat"],bass:["低音增强","Bass Boost"],vocal:["人声增强","Vocal Boost"],
    treble:["高音明亮","Bright Treble"],electronic:["电子","Electronic"],
    monitor:["显示器音响","Monitor Speakers"],qc35:["QC35","QC35"],
    qcearbuds:["QC Earbuds","QC Earbuds"],poly:["Poly Sync 40","Poly Sync 40"],
    zhang1:["ZHAN G1 · B&O","ZHAN G1 · B&O"],
    custom:["自定义","Manual"]
  };
  let eqGains = eqPresets.flat.slice();
  let customEQGains = eqPresets.flat.slice();
  let eqPresetKey = "flat";
  let eqFilters = [];
  let eqVisualAnimation=0,eqLabelTimer=0,eqPopoverOpen=false;
  function buildEQFilters(){
    eqFilters = eqBandFreqs.map((freq,i) => {
      const f = audioCtx.createBiquadFilter();
      f.frequency.value = freq;
      f.type = i===0 ? "lowshelf" : i===eqBandFreqs.length-1 ? "highshelf" : "peaking";
      if(f.type === "peaking") f.Q.value = 1.0;
      f.gain.value = eqGains[i] || 0;
      return f;
    });
    for(let i=0;i<eqFilters.length-1;i++) eqFilters[i].connect(eqFilters[i+1]);
    return eqFilters;
  }
  function eqCurvePoints(values){
    return values.map((value,index)=>({
      x:50+index*100,
      y:22+(12-Math.max(-12,Math.min(12,Number(value)||0)))/24*140
    }));
  }
  function smoothEQPath(points){
    return monotoneCurvePath(points,.62);
  }
  function renderEQCurve(values=eqGains){
    const line=$("#eqCurveLine"),area=$("#eqCurveArea"),dots=$("#eqCurveDots");if(!line||!area||!dots)return;
    const points=eqCurvePoints(values),path=smoothEQPath(points);
    line.setAttribute("d",path);area.setAttribute("d",`${path} L 650 174 L 50 174 Z`);
    if(dots.children.length!==points.length)dots.innerHTML=points.map((_,index)=>`<circle data-i="${index}" r="4.2"/>`).join("");
    [...dots.children].forEach((dot,index)=>{dot.setAttribute("cx",points[index].x);dot.setAttribute("cy",points[index].y);});
  }
  function updateEQSliders(values=eqGains){
    $$("#eqBands .eq-slider").forEach((slider,index)=>{slider.value=String(values[index]??0);slider.setAttribute("aria-valuetext",`${Number(values[index]||0).toFixed(1)} dB`);});
  }
  function buildEQUI(){
    const wrap = $("#eqBands");
    wrap.innerHTML = eqBandFreqs.map((f,i) => `
      <label class="eq-band">
        <input type="range" class="eq-slider" data-i="${i}" min="-12" max="12" step="0.5" value="${eqGains[i]}" aria-label="${eqBandLabels[i]}">
        <span class="eq-band-label">${eqBandLabels[i]}</span>
      </label>`).join("");
    wrap.querySelectorAll(".eq-slider").forEach(s => {
      s.addEventListener("input", () => {
        const i = +s.dataset.i;
        setManualEQBand(i,parseFloat(s.value));
      });
    });
    const curve=$("#eqCurveVisual");
    if(curve&&!curve.dataset.dragReady){
      curve.dataset.dragReady="1";
      let activeIndex=-1;
      const pointerInEQViewBox=event=>{
        const point=curve.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
        const matrix=curve.getScreenCTM();return matrix?point.matrixTransform(matrix.inverse()):{x:0,y:0};
      };
      const release=()=>{if(activeIndex<0)return;$("#eqCurveDots")?.querySelector(`[data-i="${activeIndex}"]`)?.classList.remove("active");activeIndex=-1;savePrefs();};
      const updateFromPointer=event=>{
        const rect=curve.getBoundingClientRect();if(!rect.width||!rect.height)return;
        const {x,y}=pointerInEQViewBox(event);
        if(activeIndex<0)activeIndex=Math.max(0,Math.min(6,Math.round((x-50)/100)));
        const gain=eqGainFromPointer(y);
        setManualEQBand(activeIndex,gain);
      };
      curve.addEventListener("pointerdown",event=>{event.preventDefault();eqVisualAnimation++;const {x}=pointerInEQViewBox(event);activeIndex=Math.max(0,Math.min(6,Math.round((x-50)/100)));curve.setPointerCapture(event.pointerId);$("#eqCurveDots")?.querySelector(`[data-i="${activeIndex}"]`)?.classList.add("active");updateFromPointer(event);});
      curve.addEventListener("pointermove",event=>{if(activeIndex>=0)updateFromPointer(event);});
      curve.addEventListener("pointerup",release);curve.addEventListener("pointercancel",release);curve.addEventListener("lostpointercapture",release);
    }
    renderEQCurve();updateEQSliders();
  }
  function setManualEQBand(index,value){
    eqGains[index]=Math.max(-12,Math.min(12,Number(value)||0));
    customEQGains=eqGains.slice();
    if(eqFilters[index])smoothAudioParam(eqFilters[index].gain,eqGains[index],.055);
    syncAudioHeadroom(false,eqGains);renderEQCurve();updateEQSliders();setEQPresetLabel("custom",true);
  }
  function eqPresetName(key){const names=eqPresetNames[key]||eqPresetNames.flat;return names[uiLanguage==="zh"?0:1];}
  function setEQPresetLabel(key,animate=false){
    eqPresetKey = key;
    $$("#eqPresetPop button[data-p]").forEach(button=>button.classList.toggle("active",button.dataset.p===key));
    const label=$("#eqPresetName");if(!label)return;
    const next=eqPresetName(key);if(label.textContent===next)return;
    clearTimeout(eqLabelTimer);
    if(!animate||matchMedia("(prefers-reduced-motion: reduce)").matches){label.textContent=next;label.classList.remove("eq-label-out","eq-label-in");return;}
    label.classList.remove("eq-label-in");label.classList.add("eq-label-out");
    eqLabelTimer=setTimeout(()=>{label.textContent=next;label.classList.remove("eq-label-out");void label.offsetWidth;label.classList.add("eq-label-in");eqLabelTimer=setTimeout(()=>label.classList.remove("eq-label-in"),190);},105);
  }
  function animateEQValues(target,duration=360){
    const start=eqGains.slice(),token=++eqVisualAnimation,startAt=performance.now(),reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
    eqGains=target.slice();
    if(reduced){updateEQSliders();renderEQCurve();return;}
    const frame=now=>{
      if(token!==eqVisualAnimation)return;
      const progress=Math.min(1,(now-startAt)/duration),eased=1-Math.pow(1-progress,3);
      const visual=start.map((value,index)=>value+(target[index]-value)*eased);
      updateEQSliders(visual);renderEQCurve(visual);
      if(progress<1)requestAnimationFrame(frame);
      else{updateEQSliders(target);renderEQCurve(target);}
    };
    requestAnimationFrame(frame);
  }
  function applyEQPreset(key){
    if(key!=="custom"&&!eqPresets[key])key="flat";
    const target=(key==="custom"?customEQGains:eqPresets[key]).slice();
    eqFilters.forEach((filter,index)=>smoothAudioParam(filter.gain,target[index],.34));
    animateEQValues(target);
    setEQPresetLabel(key,true);syncAudioHeadroom(false,target);savePrefs();closeEQPresetPopover();
  }
  function placeEQPresetPopover(){
    const pop=$("#eqPresetPop"),trigger=$("#eqPresetButton");if(!pop||!trigger)return;
    if(pop.parentElement!==document.body)document.body.appendChild(pop);
    const rect=trigger.getBoundingClientRect(),width=Math.min(310,Math.max(220,innerWidth-24));
    const left=Math.max(12,Math.min(innerWidth-width-12,rect.left));
    const estimatedHeight=pop.offsetHeight||286,below=rect.bottom+8,top=below+estimatedHeight<=innerHeight-12?below:Math.max(12,rect.top-estimatedHeight-8);
    pop.style.width=`${width}px`;pop.style.left=`${Math.round(left)}px`;pop.style.top=`${Math.round(top)}px`;
  }
  function setEQPresetPopover(open){
    const pop=$("#eqPresetPop"),trigger=$("#eqPresetButton");if(!pop||!trigger)return;
    eqPopoverOpen=Boolean(open);if(eqPopoverOpen)placeEQPresetPopover();setMotionPopover(pop,eqPopoverOpen);if(eqPopoverOpen)requestAnimationFrame(placeEQPresetPopover);
  }
  function closeEQPresetPopover(){setEQPresetPopover(false);}
  $("#eqPresetButton").addEventListener("click",event=>{event.stopPropagation();setEQPresetPopover(!eqPopoverOpen);});
  $("#eqPresetPop").addEventListener("click",event=>{const button=event.target.closest("button[data-p]");if(!button)return;event.stopPropagation();applyEQPreset(button.dataset.p);});
  document.addEventListener("pointerdown",event=>{if(eqPopoverOpen&&!event.target.closest(".eq-preset-wrap,#eqPresetPop"))closeEQPresetPopover();},{passive:true});
  window.addEventListener("resize",()=>{if(eqPopoverOpen)placeEQPresetPopover();},{passive:true});
