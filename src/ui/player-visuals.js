  /* ================= ambient wallpaper (3 modes) ================= */
  const accentPalettes = {
    navy:  ["#2C4870","#5C7FA8","#8FA8C4"],
    slate: ["#4A5560","#6B7785","#98A2AC"],
    forest:["#3A5A45","#5C8065","#8AAE8F"],
    wine:  ["#7A3B42","#9C5761","#BF8489"],
    bronze:["#8A6A3C","#AD8A55","#CBAF7C"],
    teal:  ["#2E6B6B","#4E8F8F","#7FB3B3"],
    mono:  ["#000000","#8e8e93","#ffffff"]
  };
  let accentKey = "navy";
  let adaptiveColorOn = false;
  function activeTheme(){return document.body.getAttribute("data-theme")==="dark"?"dark":"light";}
  function themeBaseRgb(theme=activeTheme()){return theme==="dark"?[0,0,0]:[238,240,244];}
  function accentSeedForTheme(key,theme=activeTheme()){
    if(key==="mono")return theme==="dark"?"#ffffff":"#000000";
    return accentPalettes[key]?.[theme==="dark"?1:0]||accentPalettes.navy[theme==="dark"?1:0];
  }
  function setAccent(key,{refreshAmbient=true,persist=true}={}){
    accentKey = accentPalettes[key]?key:"navy";
    const hexToRgbArray = hex => { const v=hex.replace("#",""); return [parseInt(v.slice(0,2),16),parseInt(v.slice(2,4),16),parseInt(v.slice(4,6),16)]; };
    const primary=accentSeedForTheme(accentKey);
    commitAccentRgb(hexToRgbArray(primary));
    $$(".swatch").forEach(s => s.classList.toggle("active", s.dataset.k===accentKey));
    if(refreshAmbient)updateAmbient();if(persist)savePrefs();
  }
  function srgbToLinear(value){value=Math.max(0,Math.min(255,value))/255;return value<=.04045?value/12.92:Math.pow((value+.055)/1.055,2.4);}
  function linearToSrgb(value){value=Math.max(0,Math.min(1,value));return Math.round(255*(value<=.0031308?12.92*value:1.055*Math.pow(value,1/2.4)-.055));}
  function rgbToOklab(r,g,b){
    r=srgbToLinear(r);g=srgbToLinear(g);b=srgbToLinear(b);
    const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
    const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
    const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
    return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,.0259040371*l+.7827717662*m-.808675766*s];
  }
  function oklabToRgb(L,a,b){
    const l=Math.pow(L+.3963377774*a+.2158037573*b,3);
    const m=Math.pow(L-.1055613458*a-.0638541728*b,3);
    const s=Math.pow(L-.0894841775*a-1.291485548*b,3);
    return [linearToSrgb(4.0767416621*l-3.3077115913*m+.2309699292*s),linearToSrgb(-1.2684380046*l+2.6097574011*m-.3413193965*s),linearToSrgb(-.0041960863*l-.7034186147*m+1.707614701*s)];
  }
  function readCurrentBackgroundRgb(){
    // Theme transitions animate the rendered body color for 500 ms. Accent
    // calculations must use the destination theme, never that transient frame.
    return themeBaseRgb();
  }
  function relativeLuminance([r,g,b]){return .2126*srgbToLinear(r)+.7152*srgbToLinear(g)+.0722*srgbToLinear(b);}
  function contrastRatio(rgbA,rgbB){const a=relativeLuminance(rgbA),b=relativeLuminance(rgbB);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
  function mixRgb(base,overlay,alpha){return base.map((value,index)=>Math.round(value*(1-alpha)+overlay[index]*alpha));}
  function rotateRgbHue(rgb,degrees){
    const [r,g,b]=rgb.map(value=>Math.max(0,Math.min(255,value))/255),max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    let hue=0,saturation=0,lightness=(max+min)/2;
    if(delta){saturation=delta/(1-Math.abs(2*lightness-1));if(max===r)hue=60*(((g-b)/delta)%6);else if(max===g)hue=60*((b-r)/delta+2);else hue=60*((r-g)/delta+4);}
    hue=(hue+degrees+360)%360;
    const chroma=(1-Math.abs(2*lightness-1))*saturation,x=chroma*(1-Math.abs((hue/60)%2-1)),m=lightness-chroma/2;
    let out=hue<60?[chroma,x,0]:hue<120?[x,chroma,0]:hue<180?[0,chroma,x]:hue<240?[0,x,chroma]:hue<300?[x,0,chroma]:[chroma,0,x];
    return out.map(value=>Math.round((value+m)*255));
  }
  function ambientBlobGradient(rgb,intensity){
    const alpha=Math.max(.08,Math.min(.72,intensity));
    return `radial-gradient(circle at 50% 50%,rgba(${rgb.join(",")},${(.62*alpha).toFixed(3)}) 0%,rgba(${rgb.join(",")},${(.4*alpha).toFixed(3)}) 30%,rgba(${rgb.join(",")},${(.14*alpha).toFixed(3)}) 58%,rgba(${rgb.join(",")},0) 82%)`;
  }
  let lastFavoriteBackdropPalette=null;
  function currentAccentRgb(){const values=getComputedStyle(document.documentElement).getPropertyValue("--accent-rgb").match(/[\d.]+/g);return values?.length>=3?values.slice(0,3).map(Number):[44,72,112];}
  function commitAccentRgb(rgb,{refreshFavorite=true}={}){
    const clean=rgb.slice(0,3).map(value=>Math.max(0,Math.min(255,Math.round(value))));
    const hex="#"+clean.map(value=>value.toString(16).padStart(2,"0")).join("");
    const contrast=contrastRatio([0,0,0],clean)>=contrastRatio([255,255,255],clean)?"#000000":"#ffffff";
    const root=document.documentElement,current=currentAccentRgb(),changed=current.some((value,index)=>Math.round(value)!==clean[index]);
    root.style.setProperty("--accent",hex);root.style.setProperty("--accent-rgb",clean.join(","));root.style.setProperty("--accent-contrast",contrast);root.style.setProperty("--turntable-accent-rgb",clean.join(","));
    if(changed)updateFavicon(hex,contrast);
    /* Accent consumers with contextual inline surfaces must be committed in the
       same frame as the root variables. Otherwise the EQ trigger can retain the
       previous cover colour until an unrelated layout refresh. */
    updateContextualControlColors();
    if(typeof GPUIRegistry!=="undefined")GPUIRegistry.refresh(document,false);
    $("#eqCurveFill")?.querySelectorAll("stop").forEach(stop=>stop.setAttribute("stop-color",hex));
    $("#playbackSpeedButton")?.style.setProperty("color",hex);
    const speedGlider=$(".playback-speed-presets");if(speedGlider&&typeof updateGlider==="function")requestAnimationFrame(()=>updateGlider(speedGlider,false));
    if(typeof renderEQCurve==="function")renderEQCurve();
    drawMiniEq();
    if(refreshFavorite)updateFavoriteAnswerContrast();
    if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);
    return clean;
  }
  function weightedPaletteTone(palette){
    const colors=(palette||[]).filter(color=>Array.isArray(color)&&color.length>=3).slice(0,3);
    if(!colors.length)return readCurrentBackgroundRgb();
    const weights=[.52,.3,.18];let total=0,tone=[0,0,0];
    colors.forEach((color,index)=>{const weight=weights[index]||.12;total+=weight;for(let channel=0;channel<3;channel++)tone[channel]+=Math.max(0,Math.min(255,color[channel]))*weight;});
    return tone.map(value=>Math.round(value/Math.max(total,.01)));
  }
  function readableAccentTint(seed,surface,minimum=4.5){
    if(contrastRatio(seed,surface)>=minimum)return seed.map(Math.round);
    let [L,a,b]=rgbToOklab(...seed),best=seed,bestContrast=contrastRatio(seed,surface);
    const towardLight=contrastRatio([245,245,245],surface)>contrastRatio([16,16,18],surface);
    for(let step=0;step<34;step++){
      L=Math.max(.18,Math.min(.88,L+(towardLight?.022:-.022)));
      const candidate=oklabToRgb(L,a,b),ratio=contrastRatio(candidate,surface);
      if(ratio>bestContrast){best=candidate;bestContrast=ratio;}
      if(ratio>=minimum)break;
    }
    return best.map(value=>Math.max(8,Math.min(247,Math.round(value))));
  }
  function paletteForCurrentSurface(palette=lastFavoriteBackdropPalette){
    const colors=(palette||[]).filter(color=>Array.isArray(color)&&color.length>=3).slice(0,3);
    if(colors.length)return colors;
    return (accentPalettes[accentKey]||accentPalettes.navy).map(hexToRgbArr);
  }
  function visualSurfaceAt(x,y,palette=lastFavoriteBackdropPalette){
    const base=themeBaseRgb(),colors=paletteForCurrentSurface(palette),theme=activeTheme();
    if(bgMode==="blur")return mixRgb(base,weightedPaletteTone(colors),theme==="dark"?.48:.62);
    const points=[[.205,.205],[.845,.405],[.405,.795]],vw=Math.max(1,innerWidth),vh=Math.max(1,innerHeight);
    let surface=base.slice();
    points.forEach((point,index)=>{const dx=x/vw-point[0],dy=y/vh-point[1],distance=Math.hypot(dx,dy),weight=Math.pow(Math.max(0,1-distance/.58),1.7),alpha=weight*(theme==="dark"?.34:.46);surface=mixRgb(surface,colors[index%colors.length],alpha);});
    return surface;
  }
  function elementSurface(element,palette=lastFavoriteBackdropPalette){const rect=element?.getBoundingClientRect?.();return rect?visualSurfaceAt(rect.left+rect.width/2,rect.top+rect.height/2,palette):themeBaseRgb();}
  function sampledAmbientSurface(element){
    const rect=element?.getBoundingClientRect?.(),canvas=activeAmbientCanvas;
    if(!rect||!canvas?.width||!canvas?.height)return elementSurface(element);
    try{
      const x=Math.max(0,Math.min(canvas.width-1,Math.round((rect.left+rect.width/2)/Math.max(1,innerWidth)*canvas.width)));
      const y=Math.max(0,Math.min(canvas.height-1,Math.round((rect.top+rect.height/2)/Math.max(1,innerHeight)*canvas.height)));
      const context=canvas.getContext("2d",{alpha:false}),radius=canvas.width>16?2:0,left=Math.max(0,x-radius),top=Math.max(0,y-radius);
      const data=context.getImageData(left,top,Math.min(canvas.width,x+radius+1)-left,Math.min(canvas.height,y+radius+1)-top).data;
      let red=0,green=0,blue=0,count=0;for(let index=0;index<data.length;index+=4){red+=data[index];green+=data[index+1];blue+=data[index+2];count++;}
      return count?[Math.round(red/count),Math.round(green/count),Math.round(blue/count)]:elementSurface(element);
    }catch(error){return elementSurface(element);}
  }
  function updateAdaptiveTextColors(palette=lastFavoriteBackdropPalette){
    const black=[12,12,14],white=[248,248,250];
    $$(".view-header h2").forEach(title=>{const surface=sampledAmbientSurface(title),useLight=contrastRatio(white,surface)>=contrastRatio(black,surface),color=useLight?"#f8f8fa":"#0c0c0e";title.style.color=color;title.style.textShadow=useLight?"0 1px 3px rgba(0,0,0,.34)":"0 1px 2px rgba(255,255,255,.28)";});
  }
  function updateContextualControlColors(palette=lastFavoriteBackdropPalette){
    const selectors="#addFilesBtn,#addFolderBtn,#sortBtn,#playMixBtn,#eqPresetButton,.export-log-btn,.release-tag";
    $$(selectors).forEach(control=>{const surface=elementSurface(control,palette),light=activeTheme()==="light",tone=mixRgb(surface,light?[255,255,255]:[255,255,255],light?.42:.1),accented=mixRgb(tone,currentAccentRgb(),light?.035:.065);control.style.setProperty("--context-control-bg",`rgba(${accented.join(",")},${light?.74:.62})`);control.style.setProperty("--context-control-border",`rgba(${currentAccentRgb().join(",")},${light?.09:.14})`);});
  }
  function updateFavoriteAnswerContrast(palette=lastFavoriteBackdropPalette){
    const colors=(palette||[]).filter(color=>Array.isArray(color)&&color.length>=3).slice(0,3);
    if(colors.length)lastFavoriteBackdropPalette=colors.map(color=>color.slice(0,3));
    const source=colors.length?colors:(lastFavoriteBackdropPalette||[readCurrentBackgroundRgb()]);
    const ambient=weightedPaletteTone(source);
    const base=readCurrentBackgroundRgb(),influence=bgMode==="blur"?.46:(bgMode==="color"?.34:.24);
    const backdrop=mixRgb(base,ambient,influence),glass=mixRgb(backdrop,[255,255,255],.64),cardTone=mixRgb(glass,currentAccentRgb(),.075);
    const answer=readableAccentTint(currentAccentRgb(),cardTone,4.5);
    document.documentElement.style.setProperty("--favorite-answer-contrast",`rgb(${answer.join(",")})`);
    updateAdaptiveTextColors(source);updateContextualControlColors(source);
  }
  function accentContrastSurfaces(backgroundRgb){
    const dark=relativeLuminance(backgroundRgb)<.35;
    return [backgroundRgb,mixRgb(backgroundRgb,dark?[56,56,60]:[255,255,255],dark?.78:.84)];
  }
  function minimumSurfaceContrast(rgb,surfaces){return Math.min(...surfaces.map(surface=>contrastRatio(rgb,surface)));}
  function harmonizeCoverPalette(colors,backgroundRgb){
    const backgroundLab=rgbToOklab(...backgroundRgb);
    let totalWeight=0,coverL=0,coverA=0,coverB=0;
    colors.slice(0,5).forEach((color,index)=>{
      const lab=rgbToOklab(...color.map(value=>Math.max(0,Math.min(255,value))));
      const chroma=Math.hypot(lab[1],lab[2]);
      const weight=(1/(1+index*.72))*(.45+.55*Math.min(1,chroma/.14));
      totalWeight+=weight;coverL+=lab[0]*weight;coverA+=lab[1]*weight;coverB+=lab[2]*weight;
    });
    if(!totalWeight)return null;
    coverL/=totalWeight;coverA/=totalWeight;coverB/=totalWeight;
    // Blend the extracted cover centre with the actual rendered background in OKLab.
    // This preserves a unique cover hue while making it belong to the current theme.
    const backgroundInfluence=.16;
    let L=coverL*(1-backgroundInfluence)+backgroundLab[0]*backgroundInfluence;
    let a=coverA*(1-backgroundInfluence)+backgroundLab[1]*backgroundInfluence;
    let b=coverB*(1-backgroundInfluence)+backgroundLab[2]*backgroundInfluence;
    const chroma=Math.hypot(a,b),chromaCap=.06;
    if(chroma>chromaCap){const scale=chromaCap/chroma;a*=scale;b*=scale;}
    const backgroundIsDark=relativeLuminance(backgroundRgb)<.35;
    const contrastSurfaces=accentContrastSurfaces(backgroundRgb);
    L=backgroundIsDark?Math.max(.58,Math.min(.74,L)):Math.max(.3,Math.min(.54,L));
    const minimumContrast=4.8,maximumContrast=7;
    let rgb=oklabToRgb(L,a,b);
    const readableContrast=value=>Math.min(minimumSurfaceContrast(value,contrastSurfaces),contrastRatio(value,mixRgb(contrastSurfaces[1],value,.12)));
    for(let step=0;step<36&&readableContrast(rgb)<minimumContrast;step++){
      L=Math.max(.25,Math.min(.82,L+(backgroundIsDark?.022:-.022)));
      rgb=oklabToRgb(L,a,b);
    }
    for(let step=0;step<14&&contrastRatio(rgb,backgroundRgb)>maximumContrast;step++){
      const nextL=Math.max(.25,Math.min(.82,L+(backgroundIsDark?-.018:.018)));
      const nextRgb=oklabToRgb(nextL,a,b);
      if(readableContrast(nextRgb)<minimumContrast)break;
      L=nextL;rgb=nextRgb;
    }
    return rgb;
  }
  let adaptiveAccentRequestToken=0;
  let adaptivePaletteCache={trackId:null,colors:null};
  const adaptivePaletteByTrack=new Map();
  function adaptivePaletteKey(track){return track&&(track.spectrumId||track.contentKey||track.id);}
  function refreshAdaptiveAccentForTheme(){
    if(!adaptiveColorOn)return;
    const track=playlist[currentIndex];
    const key=adaptivePaletteKey(track),palette=(key&&adaptivePaletteByTrack.get(key))||(track&&adaptivePaletteCache.trackId===track.id?adaptivePaletteCache.colors:null);
    if(palette?.length){const safe=harmonizeCoverPalette(palette,themeBaseRgb());if(safe)commitAccentRgb(safe);}
    else setAccent(accentKey,{refreshAmbient:false,persist:false});
  }
  async function applyAdaptiveAccent(requestToken=null){
    if(!adaptiveColorOn)return;
    if(requestToken===null)requestToken=++adaptiveAccentRequestToken;
    const themeSnapshot=document.body.getAttribute("data-theme"),t=playlist[currentIndex];
    if(!t||!t.coverUrl){setAccent(accentKey,{refreshAmbient:false,persist:false});return;}
    const colors=await getDominantColors(t.coverUrl,5);
    if(!colors?.length||playlist[currentIndex]!==t||requestToken!==adaptiveAccentRequestToken||document.body.getAttribute("data-theme")!==themeSnapshot)return;
    const canonicalColors=colors.map(color=>color.slice(0,3)),key=adaptivePaletteKey(t);
    adaptivePaletteCache={trackId:t.id,colors:canonicalColors};if(key)adaptivePaletteByTrack.set(key,canonicalColors);
    const harmonized=harmonizeCoverPalette(canonicalColors,themeBaseRgb(themeSnapshot));if(!harmonized)return;
    commitAccentRgb(harmonized,{refreshFavorite:false});updateFavoriteAnswerContrast(colors);
  }
  function updateFavicon(accent, contrast){
    accent = accent || "#0A84FF"; contrast = contrast || "#ffffff";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="16" fill="${accent}"/><rect x="9" y="13" width="3" height="7" rx="1.5" fill="${contrast}"/><rect x="14.5" y="8" width="3" height="16" rx="1.5" fill="${contrast}"/><rect x="20" y="11" width="3" height="10" rx="1.5" fill="${contrast}"/></svg>`;
    const link = document.getElementById("faviconLink");
    if(link) link.href = "data:image/svg+xml," + encodeURIComponent(svg);
  }
  function getDominantColors(imgUrl, count){
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try{
          const w=40, h=40;
          const canvas = document.createElement("canvas");
          canvas.width=w; canvas.height=h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img,0,0,w,h);
          const data = ctx.getImageData(0,0,w,h).data;
          const buckets = {};
          for(let i=0;i<data.length;i+=4){
            const r=data[i],g=data[i+1],b=data[i+2],a=data[i+3];
            if(a<128) continue;
            const key = [Math.round(r/24)*24, Math.round(g/24)*24, Math.round(b/24)*24].join(",");
            buckets[key] = (buckets[key]||0)+1;
          }
          let sorted = Object.entries(buckets).sort((a,b)=>b[1]-a[1]).map(e=>e[0].split(",").map(Number));
          if(sorted.length===0){ resolve(null); return; }
          resolve(sorted.slice(0,count));
        }catch(e){ resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = imgUrl;
    });
  }
  let coverColorMotionFrame=0;
  function stopCoverColorMotion(){
    if(coverColorMotionFrame)cancelAnimationFrame(coverColorMotionFrame);coverColorMotionFrame=0;
  }
  function startCoverColorMotion(){
    // GP Motion Engine 1.3: every ambient background remains static.
    stopCoverColorMotion();
  }
  function syncCoverColorMotion(active){
    $("#ambientGlow").classList.remove("cover-color-motion");
    stopCoverColorMotion();
  }
  let activeAmbientCanvas=$("#ambientCanvas"),standbyAmbientCanvas=$("#ambientCanvasNext"),ambientRasterCleanupTimer=0,ambientResizeTimer=0,ambientRenderHoldUntil=0;
  function reserveAmbientTransitionWindow(duration=340){ambientRenderHoldUntil=Math.max(ambientRenderHoldUntil,performance.now()+duration);}
  async function waitForAmbientTransitionWindow(myToken){
    const remaining=ambientRenderHoldUntil-performance.now();
    if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
    return myToken===ambientToken;
  }
  const ambientCoverScratch=document.createElement("canvas");
  function ambientRasterMetrics(){
    const dpr=Math.max(.5,window.devicePixelRatio||1),physicalWidth=Math.max(1,Math.round(window.innerWidth*dpr)),physicalHeight=Math.max(1,Math.round(window.innerHeight*dpr));
    const integerDivisor=1,width=physicalWidth,height=physicalHeight;
    return {width,height,dpr,scale:dpr/integerDivisor,physicalWidth,physicalHeight,integerDivisor};
  }
  function fillAmbientBase(ctx,width,height){
    const base=themeBaseRgb();ctx.globalCompositeOperation="source-over";ctx.globalAlpha=1;ctx.filter="none";ctx.fillStyle=`rgb(${base.join(",")})`;ctx.fillRect(0,0,width,height);
  }
  function commitAmbientBridge(bridge){
    if(!Array.isArray(bridge)||bridge.length<3)return;
    const clean=bridge.slice(0,3).map(value=>Math.max(0,Math.min(255,Math.round(value))));
    document.documentElement.style.setProperty("--ambient-transition-color",`rgb(${clean.join(",")})`);
  }
  function drawAmbientPalette(canvas,palette,intensity,seed){
    const metrics=ambientRasterMetrics();canvas.width=metrics.width;canvas.height=metrics.height;
    const ctx=canvas.getContext("2d",{alpha:false});fillAmbientBase(ctx,metrics.width,metrics.height);
    /* Large low-alpha radial gradients quantize into visible contour bands on
       4K dark surfaces. A cover-derived harmonic field must be visually smooth,
       so precompose one uniform RGB surface instead of retaining any gradient
       geometry for Edge to resample. */
    const count=Math.max(1,palette.length),average=palette.reduce((sum,color)=>[
      sum[0]+color[0]/count,sum[1]+color[1]/count,sum[2]+color[2]/count
    ],[0,0,0]),base=themeBaseRgb(),dark=activeTheme()==="dark";
    const visibleAverage=dark&&relativeLuminance(average)<.045?mixRgb(average,currentAccentRgb(),.34):average;
    const strength=Math.max(0,Math.min(dark?.48:.28,intensity*(dark?.62:.38)));
    const harmonic=mixRgb(base,visibleAverage,strength);
    ctx.fillStyle=`rgb(${harmonic.join(",")})`;ctx.fillRect(0,0,metrics.width,metrics.height);
    return harmonic;
  }
  function drawEmptyAmbient602(canvas,palette,seed){
    const metrics=ambientRasterMetrics();canvas.width=metrics.width;canvas.height=metrics.height;
    const sampleWidth=metrics.width,sampleHeight=metrics.height;
    const sampleCtx=canvas.getContext("2d",{alpha:false}),base=themeBaseRgb(),dark=activeTheme()==="dark";
    sampleCtx.setTransform(1,0,0,1,0,0);sampleCtx.globalCompositeOperation="source-over";sampleCtx.globalAlpha=1;
    sampleCtx.fillStyle=`rgb(${base.join(",")})`;sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    const points=[[.18,.18,.58],[.88,.41,.57],[.40,.90,.62]],opacity=dark?.63:.76;
    points.forEach((point,index)=>{
      const color=palette[index%palette.length],radius=Math.max(sampleWidth,sampleHeight)*point[2];
      const gradient=sampleCtx.createRadialGradient(sampleWidth*point[0],sampleHeight*point[1],0,sampleWidth*point[0],sampleHeight*point[1],radius);
      gradient.addColorStop(0,`rgba(${color.join(",")},${opacity})`);
      gradient.addColorStop(.54,`rgba(${color.join(",")},${opacity*.46})`);
      gradient.addColorStop(1,`rgba(${color.join(",")},0)`);
      sampleCtx.fillStyle=gradient;sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    });
    sampleCtx.fillStyle=dark?"rgba(0,0,0,.12)":"rgba(255,255,255,.035)";sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    const average=weightedPaletteTone(palette),bridge=mixRgb(base,average,dark?.22:.16);
    return bridge;
  }
  function drawAmbientCover(canvas,image){
    /* Blurred Cover is a low-frequency colour field, not a second readable
       copy of the artwork. Pre-blur a tiny sampling surface, then upscale it
       once. Page fades can no longer expose cover outlines, text, rings or
       full-resolution filter banding, and track changes avoid a 4K blur pass. */
    const metrics=ambientRasterMetrics();canvas.width=metrics.width;canvas.height=metrics.height;
    const ctx=canvas.getContext("2d",{alpha:false});fillAmbientBase(ctx,metrics.width,metrics.height);
    const sampleWidth=384,sampleHeight=Math.max(216,Math.round(sampleWidth*metrics.height/metrics.width)),scratch=ambientCoverScratch;
    if(scratch.width!==sampleWidth)scratch.width=sampleWidth;if(scratch.height!==sampleHeight)scratch.height=sampleHeight;
    const sampleCtx=scratch.getContext("2d",{alpha:false}),base=themeBaseRgb();
    sampleCtx.setTransform(1,0,0,1,0,0);sampleCtx.filter="none";sampleCtx.fillStyle=`rgb(${base.join(",")})`;sampleCtx.fillRect(0,0,sampleWidth,sampleHeight);
    const overscan=42,targetWidth=sampleWidth+overscan*2,targetHeight=sampleHeight+overscan*2,imageRatio=image.naturalWidth/image.naturalHeight,targetRatio=targetWidth/targetHeight;
    let drawWidth,drawHeight;if(imageRatio>targetRatio){drawHeight=targetHeight;drawWidth=drawHeight*imageRatio;}else{drawWidth=targetWidth;drawHeight=drawWidth/imageRatio;}
    sampleCtx.save();sampleCtx.filter=`blur(28px) saturate(${activeTheme()==="dark"?108:126}%) brightness(${activeTheme()==="dark"?.78:1.03})`;sampleCtx.drawImage(image,(sampleWidth-drawWidth)/2,(sampleHeight-drawHeight)/2,drawWidth,drawHeight);sampleCtx.restore();
    ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
    ctx.drawImage(scratch,0,0,metrics.width,metrics.height);
    ctx.fillStyle=activeTheme()==="dark"?"rgba(0,0,0,.14)":"rgba(238,240,244,.08)";ctx.fillRect(0,0,metrics.width,metrics.height);
  }
  function presentAmbientCanvas(incoming,myToken,instant=false,bridge=null){
    if(myToken!==ambientToken)return;
    clearTimeout(ambientRasterCleanupTimer);
    const outgoing=activeAmbientCanvas;
    if(instant){
      outgoing.classList.add("ambient-resize-swap");incoming.classList.add("ambient-resize-swap");
      incoming.classList.add("is-visible");incoming.classList.remove("is-blending");outgoing.classList.remove("is-visible","is-blending");
      activeAmbientCanvas=incoming;standbyAmbientCanvas=outgoing;commitAmbientBridge(bridge);updateAdaptiveTextColors();requestAnimationFrame(()=>{incoming.classList.remove("ambient-resize-swap");outgoing.classList.remove("ambient-resize-swap");refreshScrollEdgeFrames();});
      if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);return;
    }
    incoming.classList.remove("is-visible","is-blending");
    outgoing.classList.add("is-visible","is-blending");
    incoming.classList.add("is-blending");
    /* The viewport keeps the completed old raster underneath while the new
       cover-derived raster fades over it. Both are already low-frequency,
       precomposed surfaces, so this overlap cannot expose a white/theme-base
       bridge or trigger a second live blur pass. */
    void incoming.offsetWidth;
    requestAnimationFrame(()=>{
      if(myToken!==ambientToken)return;
      incoming.classList.add("is-visible");
      outgoing.classList.remove("is-visible");
      commitAmbientBridge(bridge);
    });
    ambientRasterCleanupTimer=setTimeout(()=>{
      if(myToken!==ambientToken)return;
      activeAmbientCanvas=incoming;standbyAmbientCanvas=outgoing;
      outgoing.classList.remove("is-visible","is-blending");
      incoming.classList.remove("is-blending");
      updateAdaptiveTextColors();
      requestAnimationFrame(()=>{if(myToken===ambientToken)updateAdaptiveTextColors();});
    },220);
    if(typeof scheduleTraditionalPiPRefresh==="function")scheduleTraditionalPiPRefresh(true);
  }
  function loadAmbientImage(url){return new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>resolve(null);image.src=url;});}
  const GP_AMBIENT_GLOW_INTENSITY=.64,GP_AMBIENT_COLOR_INTENSITY=.84;
  async function updateAmbient(options={}){
    const myToken = ++ambientToken;
    const track = playlist[currentIndex];
    const cover = track && track.coverUrl;
    syncCoverColorMotion(bgMode === "color" && !!cover);

    if(bgMode === "blur"){
      if(cover){
        const [image,colors]=await Promise.all([loadAmbientImage(cover),getDominantColors(cover,3)]);
        if(myToken!==ambientToken)return;
        if(colors?.length)updateFavoriteAnswerContrast(colors);
        if(image){const bridge=mixRgb(themeBaseRgb(),weightedPaletteTone(colors||[]),activeTheme()==="dark"?.42:.56);if(!await waitForAmbientTransitionWindow(myToken))return;drawAmbientCover(standbyAmbientCanvas,image);presentAmbientCanvas(standbyAmbientCanvas,myToken,options.instant===true,bridge);requestAnimationFrame(refreshScrollEdgeFrames);return;}
      }
    }

    let palette = null;
    if(bgMode === "color" && cover){
      palette = await getDominantColors(cover, 3);
      if(myToken !== ambientToken) return;
    }
    if(!palette){
      palette = accentPalettes[accentKey].map(hexToRgbArr);
      updateFavoriteAnswerContrast(palette);
    }else updateFavoriteAnswerContrast(palette);
    const seed=hashString(track?(track.artist+track.title):accentKey),intensity=bgMode==="color"?GP_AMBIENT_COLOR_INTENSITY:(track?.id?.toString?.().length?GP_AMBIENT_GLOW_INTENSITY:0);
    if(!await waitForAmbientTransitionWindow(myToken))return;
    const bridge=!track?drawEmptyAmbient602(standbyAmbientCanvas,palette,seed):drawAmbientPalette(standbyAmbientCanvas,palette,intensity,seed);
    presentAmbientCanvas(standbyAmbientCanvas,myToken,options.instant===true,bridge);
    requestAnimationFrame(refreshScrollEdgeFrames);
  }
  const scheduleAmbientRasterResize=()=>{
    clearTimeout(ambientResizeTimer);
    /* Keep the completed raster visible throughout browser zoom. Recompose
       only after the resize burst settles, then crossfade once. */
    ambientResizeTimer=setTimeout(()=>updateAmbient({instant:true}),220);
  };
  window.addEventListener("resize",scheduleAmbientRasterResize,{passive:true});

  /* ================= art / cover ================= */
  let discAngle=0,discVelocity=0,discTargetVelocity=0,discRotationFrame=0,discRotationStamp=0,discStopStarted=0,discStopVelocity=0;
  const DISC_CRUISE_VELOCITY=360/14,DISC_SETTLE_MS=720;
  function drawDiscRotation(){
    if(!$(".view[data-view='player']")?.classList.contains("active"))return;
    const rotor=$("#discRotor");if(rotor)rotor.style.transform=`rotate(${discAngle.toFixed(3)}deg) translateZ(0)`;
  }
  function runDiscRotation(now){
    if(!$(".view[data-view='player']")?.classList.contains("active")){discRotationFrame=0;discRotationStamp=0;return;}
    const dt=Math.min(.05,Math.max(0,(now-(discRotationStamp||now))/1000));discRotationStamp=now;
    if(discTargetVelocity>0){
      discStopStarted=0;discVelocity+=(discTargetVelocity-discVelocity)*(1-Math.exp(-7.5*dt));
    }else if(discStopStarted){
      const progress=Math.min(1,(now-discStopStarted)/DISC_SETTLE_MS);discVelocity=discStopVelocity*Math.pow(1-progress,2.35);
      if(progress>=1){discVelocity=0;discStopStarted=0;}
    }else discVelocity=0;
    discAngle=(discAngle+discVelocity*dt)%360;drawDiscRotation();
    if(discTargetVelocity>0||discStopStarted)discRotationFrame=requestAnimationFrame(runDiscRotation);
    else{discVelocity=0;discRotationFrame=0;discRotationStamp=0;drawDiscRotation();}
  }
  function syncDiscRotationTimeline(playing){
    if(playing){discTargetVelocity=DISC_CRUISE_VELOCITY;discStopStarted=0;}
    else{discTargetVelocity=0;discStopVelocity=Math.max(0,discVelocity);discStopStarted=discStopVelocity>.001?performance.now():0;}
    if(!discRotationFrame){discRotationStamp=performance.now();discRotationFrame=requestAnimationFrame(runDiscRotation);}
  }
  function resetDiscRotationTimeline(){
    if(discRotationFrame)cancelAnimationFrame(discRotationFrame);
    discRotationFrame=0;discRotationStamp=0;discAngle=0;discVelocity=0;discTargetVelocity=0;discStopStarted=0;discStopVelocity=0;drawDiscRotation();
  }
  let currentNowTitleText="",titleMeasureTimer=0,titleResizeTimer=0,titleMarqueeRevision=0,titleMarqueeAnimation=null,lastTitleLayoutScale=0,nowPlayingMetaRevision=0,nowPlayingMetaAnimations=[];
  function syncTitleLanguage(){
    const language=document.documentElement.lang||(uiLanguage==="ru"?"ru":uiLanguage==="en"?"en":"zh-CN");
    $$("#nowTitle,#nowArtist,.view-header h2").forEach(node=>node?.setAttribute("lang",language));
    if(typeof refreshNowTitleMarquee==="function")refreshNowTitleMarquee();
  }
  function stopNowTitleMarquee(){
    clearTimeout(titleMeasureTimer);titleMeasureTimer=0;
    if(titleMarqueeAnimation){titleMarqueeAnimation.cancel();titleMarqueeAnimation=null;}
  }
  function renderNowTitleStart(host){
    host.classList.remove("is-marquee");host.classList.add("marquee-pending");
    const span=document.createElement("span");span.className="track-title-text";span.textContent=currentNowTitleText;
    host.replaceChildren(span);return span;
  }
  function measureNowTitleMarquee(revision,attempt=0){
    if(revision!==titleMarqueeRevision)return;
    const host=$("#nowTitle");if(!host)return;
    let span=host.querySelector(":scope > .track-title-text");
    if(!span)span=renderNowTitleStart(host);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(revision!==titleMarqueeRevision||!span.isConnected)return;
      const spanRect=span.getBoundingClientRect();
      const layoutScale=Number(getComputedStyle($("#appShell")).zoom)||1;
      /* getBoundingClientRect is post-zoom while CSS transforms use pre-zoom
         CSS pixels. Mixing the two under-travelled by ~30% in compact Edge. */
      const naturalWidth=layoutScale>0?spanRect.width/layoutScale:0,available=host.clientWidth;
      if(layoutScale>0)lastTitleLayoutScale=layoutScale;
      if(available<=1||naturalWidth<=1){
        if(attempt<30)titleMeasureTimer=setTimeout(()=>measureNowTitleMarquee(revision,attempt+1),100);
        return;
      }
      if(naturalWidth<=available-28){host.classList.remove("marquee-pending");return;}
      const track=document.createElement("span");track.className="track-title-marquee-track";
      track.style.setProperty("--title-copy-width",`${naturalWidth.toFixed(3)}px`);
      const copy=span.cloneNode(true);copy.setAttribute("aria-hidden","true");track.append(span,copy);host.replaceChildren(track);
      host.classList.remove("marquee-pending");host.classList.add("is-marquee");
      const gap=parseFloat(getComputedStyle(track).columnGap)||88,distance=naturalWidth+gap;
      /* Keep perceived speed stable after responsive CSS zoom. Movement is
         linear from the first moving frame to the last moving frame. */
      const visibleDistance=distance*layoutScale,initialHold=750,endHold=650;
      const travel=Math.max(3400,visibleDistance/40*1000),total=initialHold+travel+endHold;
      const start=initialHold/total,finish=(initialHold+travel)/total;
      titleMarqueeAnimation=track.animate([
        {transform:"translate3d(0,0,0)",offset:0,easing:"linear"},
        {transform:"translate3d(0,0,0)",offset:start,easing:"linear"},
        {transform:`translate3d(${-distance.toFixed(2)}px,0,0)`,offset:finish,easing:"linear"},
        {transform:`translate3d(${-distance.toFixed(2)}px,0,0)`,offset:1,easing:"linear"}
      ],{duration:total,iterations:Infinity,easing:"linear"});
    }));
  }
  function refreshNowTitleMarquee(){
    const host=$("#nowTitle");if(!host)return;
    stopNowTitleMarquee();const revision=++titleMarqueeRevision;renderNowTitleStart(host);measureNowTitleMarquee(revision);
  }
  function refreshNowTitleMarqueeForScale(){
    const host=$("#nowTitle");if(!host||!host.clientWidth)return;
    const scale=Number(getComputedStyle($("#appShell")).zoom)||1;
    if(!lastTitleLayoutScale||Math.abs(scale-lastTitleLayoutScale)>.002)refreshNowTitleMarquee();
  }
  function setNowPlayingTitle(text){currentNowTitleText=text||"";refreshNowTitleMarquee();}
  function syncNowFormatTag(track){
    const tag=$("#nowFormatTag");if(!tag)return;
    const lossless=String(track?.format||"").toUpperCase()==="FLAC";
    tag.hidden=!lossless;
    if(lossless)tag.textContent=tr("无损","Lossless");
  }
  function transitionNowPlayingMeta(title,artist){
    const revision=++nowPlayingMetaRevision,nodes=[$("#nowTitle"),$("#nowArtist")].filter(Boolean);
    stopNowTitleMarquee();
    nowPlayingMetaAnimations.forEach(animation=>{try{animation.cancel();}catch(error){}});
    nowPlayingMetaAnimations=[];
    const commit=()=>{
      if(revision!==nowPlayingMetaRevision)return;
      setNowPlayingTitle(title);$("#nowArtist").textContent=artist||"";
      nowPlayingMetaAnimations=nodes.map(node=>node.animate([{opacity:0},{opacity:1}],{duration:145,easing:"cubic-bezier(.2,.72,.2,1)",fill:"both"}));
      const incoming=[...nowPlayingMetaAnimations];
      Promise.all(incoming.map(animation=>animation.finished.catch(()=>null))).then(()=>{incoming.forEach(animation=>{try{animation.cancel();}catch(error){}});if(revision===nowPlayingMetaRevision)nowPlayingMetaAnimations=[];});
    };
    if(!nodes.length){commit();return;}
    const outgoing=nodes.map(node=>node.animate([{opacity:1},{opacity:0}],{duration:85,easing:"ease-out",fill:"both"}));
    nowPlayingMetaAnimations=outgoing;
    Promise.all(outgoing.map(animation=>animation.finished.catch(()=>null))).then(()=>{outgoing.forEach(animation=>{try{animation.cancel();}catch(error){}});commit();});
  }
  window.addEventListener("resize",()=>{clearTimeout(titleResizeTimer);titleResizeTimer=setTimeout(refreshNowTitleMarquee,110);},{passive:true});
  document.fonts?.ready?.then(()=>requestAnimationFrame(refreshNowTitleMarquee));
  let artDisplayRevision=0,artDisplayAnimations=[],artTransitionCopies=[];
  function clearArtTransition(){
    artDisplayAnimations.forEach(animation=>{try{animation.cancel();}catch(error){}});
    artDisplayAnimations=[];artTransitionCopies.forEach(node=>node.remove());artTransitionCopies=[];
    [$("#rotorCover"),$("#staticCover")].forEach(node=>node?.style.removeProperty("opacity"));
  }
  function visibleArtworkNode(rotorCover,staticCover){
    if(staticCover&&getComputedStyle(staticCover).display!=="none"&&staticCover.getAttribute("src"))return staticCover;
    if(rotorCover&&getComputedStyle(rotorCover).display!=="none"&&rotorCover.getAttribute("src"))return rotorCover;
    return null;
  }
  function updateArtDisplay(){
    const t = playlist[currentIndex];
    const rotorCover = $("#rotorCover"), staticCover = $("#staticCover"), discIcon = $("#discIcon"), discRotor = $("#discRotor");
    const cover = t && t.coverUrl;
    const staticMode = coverDisplayMode === "static" && !!cover;
    const revision=++artDisplayRevision,previous=visibleArtworkNode(rotorCover,staticCover),previousUrl=previous?.getAttribute("src")||"";
    clearArtTransition();
    const commitDisplay=()=>{
      if(revision!==artDisplayRevision)return;
      $("#artStage").classList.toggle("static-mode",staticMode);
      if(coverDisplayMode === "static" && cover){
        discRotor.style.visibility = "hidden";
        staticCover.style.display = "block"; staticCover.src = cover;
      } else {
        discRotor.style.visibility = "visible";
        staticCover.style.display = "none";
        if(cover){ rotorCover.style.display="block"; rotorCover.src=cover; discIcon.style.display="none"; }
        else { rotorCover.style.display="none"; discIcon.style.display="flex"; }
      }
      $("#diskReader").classList.toggle("engaged",isPlaying&&!staticMode);
      return visibleArtworkNode(rotorCover,staticCover);
    };
    const beginCrossfade=()=>{
      if(revision!==artDisplayRevision)return;
      let outgoingCopy=null;
      if(previous&&previousUrl){
        outgoingCopy=previous.cloneNode(false);outgoingCopy.removeAttribute("id");
        outgoingCopy.classList.add("art-cover-transition-copy");outgoingCopy.style.display="block";outgoingCopy.style.opacity="1";
        previous.after(outgoingCopy);artTransitionCopies=[outgoingCopy];
      }
      const incoming=commitDisplay();
      if(!incoming){if(outgoingCopy){
        const fade=outgoingCopy.animate([{opacity:1},{opacity:0}],{duration:180,easing:"ease-in-out",fill:"both"});artDisplayAnimations=[fade];
        fade.finished.catch(()=>null).then(()=>{if(revision!==artDisplayRevision)return;clearArtTransition();});
      }return;}
      if(!outgoingCopy){const fade=incoming.animate([{opacity:0},{opacity:1}],{duration:180,easing:"ease-in-out",fill:"both"});artDisplayAnimations=[fade];fade.finished.catch(()=>null).then(()=>{if(revision!==artDisplayRevision)return;clearArtTransition();});return;}
      incoming.style.opacity="0";
      const incomingFade=incoming.animate([{opacity:0},{opacity:1}],{duration:190,easing:"ease-in-out",fill:"both"});
      const outgoingFade=outgoingCopy.animate([{opacity:1},{opacity:0}],{duration:190,easing:"ease-in-out",fill:"both"});
      artDisplayAnimations=[incomingFade,outgoingFade];
      Promise.all(artDisplayAnimations.map(animation=>animation.finished.catch(()=>null))).then(()=>{if(revision!==artDisplayRevision)return;clearArtTransition();});
    };
    if(!cover||cover===previousUrl){beginCrossfade();return;}
    const preload=new Image();
    preload.onload=()=>beginCrossfade();preload.onerror=()=>beginCrossfade();preload.src=cover;
  }
  function searchInputSafe(){ const el = $("#search"); return el ? el.value : ""; }
  function showToast(message){
    const lifetime=3000,toast=document.createElement("div");
    toast.className="toast-msg";toast.textContent=message;toast.style.setProperty("--toast-life",`${lifetime}ms`);
    $("#toastStack").appendChild(toast);
    setTimeout(()=>toast.classList.add("leaving"),lifetime);
    setTimeout(()=>toast.remove(),lifetime+260);
  }

