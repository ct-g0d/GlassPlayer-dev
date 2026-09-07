/* ================= Music Galaxy Canvas View =================
   One view-owned Canvas lifecycle consumes frozen track snapshots and the
   pure Galaxy service. Layout, persistence, playback and routing stay with
   their existing owners. */
GPModules.register("createGalaxyView", function createGalaxyView({galaxy,getTracks}) {
  const GALAXY_HOVER_SPEED_LIMIT = 900; // CSS px/s
  const GALAXY_HOVER_DWELL_MS = 90;
  const GALAXY_SPATIAL_CELL = 32;
  const GALAXY_POINTER_SETTLE_MS = 48;
  const GALAXY_LAYOUT_DURATION_MS = 360;
  const GALAXY_MIN_SCALE = .82;
  const GALAXY_MAX_SCALE = 3.4;
  const GALAXY_ZOOM_SENSITIVITY = .0012;
  const GALAXY_LABEL_GRID_CELL = 96;
  const GALAXY_DENSE_POINT_START = 48;
  const GALAXY_DENSE_POINT_RANGE = 160;

  let mounted=false,view=null,shell=null,canvas=null,tooltip=null,status=null,context=null;
  let resizeObserver=null,themeObserver=null,frameHandle=0;
  let cssWidth=0,cssHeight=0,pixelRatio=1;
  let atmosphereLayer=null,atmosphereSignature="",pointSprites=null,pointSpriteSignature="";
  let lastTrackSignature="",lastViewportSignature="",lastTracks=[],lastVectors=[],layout=null;
  let targetPoints=[],visiblePoints=[],clusters=[],animationFrom=new Map(),animationStart=null;
  let pointByKey=new Map(),trackByKey=new Map(),spatialHash=new Map();
  let hoverKey=null,pinnedKey=null,dwellKey=null,dwellStart=0,tooltipKey=null;
  let clickPending=false,escapePending=false;
  let viewportScale=1,viewportOffsetX=0,viewportOffsetY=0;
  let dragPointerId=null,dragStartX=0,dragStartY=0,dragOriginOffsetX=0,dragOriginOffsetY=0,dragMoved=false,suppressClick=false;
  const pointer={inside:false,x:0,y:0,time:0,speed:0};

  function hashText(value){
    let hash=2166136261;
    for(const character of String(value||"")){hash^=character.charCodeAt(0);hash=Math.imul(hash,16777619);}
    return hash>>>0;
  }

  function seededRandom(seed){
    let state=seed>>>0;
    return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  }

  function parseRgb(style,name,fallback){
    const value=style.getPropertyValue(name).trim(),hex=value.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
    if(hex){
      const expanded=hex[1].length===3?[...hex[1]].map(character=>character+character).join(""):hex[1];
      return [0,2,4].map(offset=>parseInt(expanded.slice(offset,offset+2),16));
    }
    const values=value.match(/[\d.]+/g)?.slice(0,3).map(Number);
    return values?.length===3&&values.every(Number.isFinite)?values:fallback;
  }

  function rgba(rgb,alpha){return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;}
  function reducedMotion(){return matchMedia("(prefers-reduced-motion: reduce)").matches;}

  function clampViewportTransform(){
    viewportScale=Math.max(GALAXY_MIN_SCALE,Math.min(GALAXY_MAX_SCALE,Number.isFinite(viewportScale)?viewportScale:1));
    const maxOffsetX=Math.max(0,(viewportScale-1)*cssWidth*.5),maxOffsetY=Math.max(0,(viewportScale-1)*cssHeight*.5);
    viewportOffsetX=Math.max(-maxOffsetX,Math.min(maxOffsetX,Number.isFinite(viewportOffsetX)?viewportOffsetX:0));
    viewportOffsetY=Math.max(-maxOffsetY,Math.min(maxOffsetY,Number.isFinite(viewportOffsetY)?viewportOffsetY:0));
  }

  function viewportPoint(point){
    const centerX=cssWidth*.5,centerY=cssHeight*.5;
    return {...point,x:centerX+(point.x-centerX)*viewportScale+viewportOffsetX,y:centerY+(point.y-centerY)*viewportScale+viewportOffsetY};
  }

  function measureCanvas(){
    if(!shell||!canvas||!context)return false;
    const bounds=shell.getBoundingClientRect();
    const width=bounds.width||shell.clientWidth||0,height=bounds.height||shell.clientHeight||0;
    if(width<2||height<2)return false;
    const nextRatio=Math.min(Number(window.devicePixelRatio)||1,2);
    const backingWidth=Math.max(1,Math.round(width*nextRatio));
    const backingHeight=Math.max(1,Math.round(height*nextRatio));
    const changed=Math.abs(width-cssWidth)>.25||Math.abs(height-cssHeight)>.25||nextRatio!==pixelRatio||canvas.width!==backingWidth||canvas.height!==backingHeight;
    cssWidth=width;cssHeight=height;pixelRatio=nextRatio;
    if(changed){
      canvas.width=backingWidth;canvas.height=backingHeight;
      context.setTransform(backingWidth/width,0,0,backingHeight/height,0,0);
      atmosphereSignature="";pointSpriteSignature="";
    }
    clampViewportTransform();
    rebuildSpatialHash();
    return true;
  }

  function releaseLayers(){
    if(atmosphereLayer){atmosphereLayer.width=0;atmosphereLayer.height=0;}
    pointSprites?.forEach(sprite=>{sprite.canvas.width=0;sprite.canvas.height=0;});
    atmosphereLayer=null;pointSprites=null;atmosphereSignature="";pointSpriteSignature="";
  }

  function createPointSprite(size,innerAlpha,outerAlpha,rgb){
    const sprite=document.createElement("canvas"),backing=Math.max(2,Math.round(size*pixelRatio));
    sprite.width=backing;sprite.height=backing;
    const spriteContext=sprite.getContext("2d"),scale=backing/size,center=size/2;
    spriteContext.setTransform(scale,0,0,scale,0,0);
    const gradient=spriteContext.createRadialGradient(center,center,0,center,center,center);
    gradient.addColorStop(0,rgba([255,255,255],innerAlpha));
    gradient.addColorStop(.16,rgba(rgb,Math.min(1,innerAlpha*.92)));
    gradient.addColorStop(.48,rgba(rgb,outerAlpha));
    gradient.addColorStop(1,rgba(rgb,0));
    spriteContext.fillStyle=gradient;spriteContext.fillRect(0,0,size,size);
    return {canvas:sprite,size};
  }

  function ensurePointSprites(style){
    const accent=parseRgb(style,"--accent-rgb",[92,150,220]);
    const signature=`${pixelRatio}|${accent.join(",")}`;
    if(pointSprites&&signature===pointSpriteSignature)return;
    pointSprites?.forEach(sprite=>{sprite.canvas.width=0;sprite.canvas.height=0;});
    pointSprites=[
      createPointSprite(18,.72,.12,accent),
      createPointSprite(28,.94,.18,accent),
      createPointSprite(40,1,.26,accent)
    ];
    pointSpriteSignature=signature;
  }

  function ensureAtmosphere(style){
    const accent=parseRgb(style,"--accent-rgb",[80,132,190]);
    const textColor=parseRgb(style,"--text-primary",[238,244,252]);
    const dark=document.body.getAttribute("data-theme")==="dark";
    const layoutKey=layout?.signature||"galaxy-empty";
    const signature=`${cssWidth.toFixed(2)}|${cssHeight.toFixed(2)}|${pixelRatio}|${dark}|${accent.join(",")}|${textColor.join(",")}|${layoutKey}`;
    if(atmosphereLayer&&signature===atmosphereSignature)return;

    const layer=document.createElement("canvas"),backingWidth=Math.max(1,Math.round(cssWidth*pixelRatio)),backingHeight=Math.max(1,Math.round(cssHeight*pixelRatio));
    layer.width=backingWidth;layer.height=backingHeight;
    const layerContext=layer.getContext("2d"),scaleX=backingWidth/cssWidth,scaleY=backingHeight/cssHeight;
    layerContext.setTransform(scaleX,0,0,scaleY,0,0);
    const random=seededRandom(hashText(signature));

    const vignette=layerContext.createRadialGradient(cssWidth*.52,cssHeight*.48,0,cssWidth*.52,cssHeight*.48,Math.max(cssWidth,cssHeight)*.72);
    vignette.addColorStop(0,rgba(accent,dark?.075:.05));
    vignette.addColorStop(.55,rgba([15,28,52],dark?.055:.035));
    vignette.addColorStop(1,rgba([2,8,20],0));
    layerContext.fillStyle=vignette;layerContext.fillRect(0,0,cssWidth,cssHeight);

    const band=layerContext.createLinearGradient(0,cssHeight,cssWidth,0);
    band.addColorStop(0,rgba(accent,0));band.addColorStop(.28,rgba(accent,dark?.055:.035));band.addColorStop(.62,rgba([176,205,236],dark?.07:.045));band.addColorStop(1,rgba(accent,0));
    layerContext.lineCap="round";layerContext.strokeStyle=band;
    for(let pass=0;pass<3;pass++){
      layerContext.globalAlpha=.72-pass*.17;
      layerContext.lineWidth=Math.min(cssWidth,cssHeight)*(.30-pass*.065);
      layerContext.beginPath();
      layerContext.moveTo(-cssWidth*.08,cssHeight*(.78-pass*.025));
      layerContext.bezierCurveTo(cssWidth*.26,cssHeight*(.56+pass*.018),cssWidth*.68,cssHeight*(.43-pass*.025),cssWidth*1.08,cssHeight*.20);
      layerContext.stroke();
    }

    layerContext.globalAlpha=1;
    const hazeCount=Math.max(4,Math.min(9,Math.round((layout?.clusters?.length||4)*1.2)));
    for(let index=0;index<hazeCount;index++){
      const x=cssWidth*(.12+random()*.76),y=cssHeight*(.16+random()*.68),radius=Math.min(cssWidth,cssHeight)*(.08+random()*.12);
      const haze=layerContext.createRadialGradient(x,y,0,x,y,radius);
      haze.addColorStop(0,rgba(accent,dark?.052:.032));haze.addColorStop(.45,rgba(accent,dark?.022:.014));haze.addColorStop(1,rgba(accent,0));
      layerContext.fillStyle=haze;layerContext.fillRect(x-radius,y-radius,radius*2,radius*2);
    }

    const starCount=Math.max(220,Math.min(1600,Math.round(cssWidth*cssHeight/1050)));
    for(let index=0;index<starCount;index++){
      const x=random()*cssWidth,y=random()*cssHeight,radius=.28+random()*.72,alpha=(dark?.08:.06)+random()*(dark?.22:.14);
      layerContext.fillStyle=rgba(index%7===0?accent:textColor,alpha);
      layerContext.fillRect(x,y,radius,radius);
    }

    if(atmosphereLayer){atmosphereLayer.width=0;atmosphereLayer.height=0;}
    atmosphereLayer=layer;atmosphereSignature=signature;
  }

  function rebuildSpatialHash(){
    spatialHash=new Map();pointByKey=new Map();
    visiblePoints.forEach(point=>{
      const screenPoint={...viewportPoint(point),radius:point.radius*viewportScale};
      pointByKey.set(point.key,screenPoint);
      const cellX=Math.floor(screenPoint.x/GALAXY_SPATIAL_CELL),cellY=Math.floor(screenPoint.y/GALAXY_SPATIAL_CELL),cellKey=`${cellX}:${cellY}`;
      const bucket=spatialHash.get(cellKey)||[];bucket.push(screenPoint);spatialHash.set(cellKey,bucket);
    });
  }

  function querySpatialPoint(x,y){
    const cellX=Math.floor(x/GALAXY_SPATIAL_CELL),cellY=Math.floor(y/GALAXY_SPATIAL_CELL);
    let nearest=null,nearestDistance=Infinity;
    for(let offsetY=-1;offsetY<=1;offsetY++)for(let offsetX=-1;offsetX<=1;offsetX++){
      const bucket=spatialHash.get(`${cellX+offsetX}:${cellY+offsetY}`)||[];
      bucket.forEach(point=>{
        const distance=Math.hypot(point.x-x,point.y-y),hitRadius=Math.max(10,point.radius+6);
        if(distance<=hitRadius&&distance<nearestDistance){nearest=point;nearestDistance=distance;}
      });
    }
    return nearest;
  }

  function truncateCanvasLabel(value,maxWidth){
    const label=String(value||"").replace(/\s*·.*$/," ").replace(/\s+/g," ").trim()||tr("混合","Mixed");
    if(!context||context.measureText(label).width<=maxWidth)return label;
    const ellipsis="…";
    let output="";
    for(const character of Array.from(label)){
      if(context.measureText(`${output}${character}${ellipsis}`).width>maxWidth)break;
      output+=character;
    }
    return output?`${output}${ellipsis}`:ellipsis;
  }

  function buildLabelAnchors(maxWidth){
    if(!context||!clusters.length)return [];
    const candidates=clusters.map(cluster=>{
      const point=viewportPoint(cluster),label=truncateCanvasLabel(cluster.label,maxWidth),width=Math.min(maxWidth,Math.max(32,context.measureText(label).width));
      return {id:cluster.id,count:cluster.count,x:Math.max(8,Math.min(cssWidth-8,point.x)),y:Math.max(18,Math.min(cssHeight-10,point.y-22)),width,label};
    }).sort((left,right)=>right.count-left.count||left.id-right.id);
    const occupied=new Set(),anchors=[];
    candidates.forEach(candidate=>{
      const minColumn=Math.floor((candidate.x-candidate.width*.5-10)/GALAXY_LABEL_GRID_CELL),maxColumn=Math.floor((candidate.x+candidate.width*.5+10)/GALAXY_LABEL_GRID_CELL);
      const minRow=Math.floor((candidate.y-12)/GALAXY_LABEL_GRID_CELL),maxRow=Math.floor((candidate.y+6)/GALAXY_LABEL_GRID_CELL);
      let blocked=false;
      for(let row=minRow;row<=maxRow&&!blocked;row++)for(let column=minColumn;column<=maxColumn;column++)if(occupied.has(`${column}:${row}`)){blocked=true;break;}
      if(blocked)return;
      for(let row=minRow;row<=maxRow;row++)for(let column=minColumn;column<=maxColumn;column++)occupied.add(`${column}:${row}`);
      anchors.push(candidate);
    });
    return anchors;
  }

  function resetViewport(){
    viewportScale=1;viewportOffsetX=0;viewportOffsetY=0;clampViewportTransform();rebuildSpatialHash();tooltipKey=null;updateTooltip();scheduleFrame();
  }

  function localizedTemplate(zh,en,replacements){
    let value=tr(zh,en);
    Object.entries(replacements).forEach(([key,replacement])=>{value=value.replace(`{${key}}`,String(replacement));});
    return value;
  }

  function updateStatus(){
    if(!status)return;
    if(!lastTracks.length){
      status.textContent=tr("导入歌曲后即可探索音乐银河","Import music to explore your Music Galaxy");
      status.style.removeProperty("inset");status.style.removeProperty("transform");status.style.removeProperty("text-align");
      return;
    }
    const countText=localizedTemplate("已展示 {count} 个歌曲点","Showing {count} song points",{count:visiblePoints.length});
    const covered=lastVectors.filter(vector=>vector.mfccComplete||Number.isFinite(vector.bpm)||vector.genre!=="Unknown").length;
    const coverageText=localizedTemplate("已展示 {shown} / {total} 首可分析歌曲","Showing {shown} of {total} analyzable songs",{shown:covered,total:lastTracks.length});
    status.textContent=layout?.coverage<.995?`${countText} · ${coverageText}`:countText;
    status.style.inset="auto 14px 12px auto";status.style.transform="none";status.style.textAlign="right";
  }

  function clearTooltip(){
    if(!tooltip)return;
    tooltip.hidden=true;tooltip.textContent="";tooltip.style.removeProperty("left");tooltip.style.removeProperty("top");tooltipKey=null;
  }

  function updateTooltip(){
    if(!tooltip||!shell)return;
    const key=pinnedKey||hoverKey,point=key?pointByKey.get(key):null,track=key?trackByKey.get(key):null;
    if(!point||!track){clearTooltip();return;}
    const content=String(track.title||tr("未知","Unknown"));
    if(tooltipKey!==key||tooltip.textContent!==content){
      tooltip.textContent=content;
      tooltip.hidden=false;tooltipKey=key;
    }
    tooltip.hidden=false;
    const maxLeft=Math.max(8,cssWidth-(tooltip.offsetWidth||260)-8),maxTop=Math.max(8,cssHeight-(tooltip.offsetHeight||48)-8);
    tooltip.style.left=`${Math.max(8,Math.min(maxLeft,point.x+12))}px`;
    tooltip.style.top=`${Math.max(8,Math.min(maxTop,point.y+12))}px`;
  }

  function updateAnimatedPoints(now){
    if(animationStart===null)return false;
    const progress=Math.min(1,Math.max(0,(now-animationStart)/GALAXY_LAYOUT_DURATION_MS));
    const eased=1-Math.pow(1-progress,3);
    visiblePoints=targetPoints.map(point=>{
      const origin=animationFrom.get(point.key)||point;
      return {...point,x:origin.x+(point.x-origin.x)*eased,y:origin.y+(point.y-origin.y)*eased};
    });
    rebuildSpatialHash();
    if(progress>=1){animationStart=null;animationFrom=new Map();return false;}
    return true;
  }

  function processInteraction(now){
    if(escapePending){escapePending=false;pinnedKey=null;hoverKey=null;dwellKey=null;dwellStart=0;clickPending=false;updateTooltip();return false;}
    if(!pointer.inside){hoverKey=null;dwellKey=null;dwellStart=0;clickPending=false;updateTooltip();return false;}
    const pointerAge=Math.max(0,now-pointer.time),speed=pointerAge>GALAXY_POINTER_SETTLE_MS?0:pointer.speed;
    const candidate=querySpatialPoint(pointer.x,pointer.y);
    if(clickPending){
      clickPending=false;
      if(!candidate)pinnedKey=null;
      else if(speed<=GALAXY_HOVER_SPEED_LIMIT)pinnedKey=candidate.key;
    }
    if(speed>GALAXY_HOVER_SPEED_LIMIT){
      hoverKey=null;dwellKey=null;dwellStart=0;updateTooltip();
      return pointerAge<=GALAXY_POINTER_SETTLE_MS;
    }
    if(!candidate){hoverKey=null;dwellKey=null;dwellStart=0;updateTooltip();return false;}
    if(dwellKey!==candidate.key){dwellKey=candidate.key;dwellStart=now;hoverKey=null;updateTooltip();return true;}
    if(now-dwellStart<GALAXY_HOVER_DWELL_MS){updateTooltip();return true;}
    hoverKey=candidate.key;updateTooltip();return false;
  }

  function draw(){
    if(!context||!cssWidth||!cssHeight)return;
    const style=getComputedStyle(view);
    ensureAtmosphere(style);ensurePointSprites(style);
    context.clearRect(0,0,cssWidth,cssHeight);
    if(atmosphereLayer)context.drawImage(atmosphereLayer,0,0,atmosphereLayer.width,atmosphereLayer.height,0,0,cssWidth,cssHeight);

    const pointCount=visiblePoints.length,density=Math.max(0,Math.min(1,(pointCount-GALAXY_DENSE_POINT_START)/GALAXY_DENSE_POINT_RANGE));
    const unselectedScale=.86-density*.20,unselectedAlpha=.66-density*.34,renderScale=Math.pow(viewportScale,.72);
    context.save();context.globalCompositeOperation=pointCount>GALAXY_DENSE_POINT_START?"source-over":"lighter";
    visiblePoints.forEach(point=>{
      const screenPoint=viewportPoint(point);
      const selected=point.key===pinnedKey||point.key===hoverKey;
      const sprite=pointSprites[selected?2:point.opacity<.7?0:1];
      const size=sprite.size*(.58+point.radius/10+(selected?.16:0))*renderScale*(selected?1:unselectedScale);
      context.globalAlpha=selected?Math.max(.55,Math.min(1,point.opacity)):Math.max(.18,Math.min(.72,point.opacity*unselectedAlpha));
      context.drawImage(sprite.canvas,screenPoint.x-size/2,screenPoint.y-size/2,size,size);
      context.fillStyle=`hsla(${(205+point.colorFamily*29)%360},72%,${selected?78:68}%,${selected?.92:.64})`;
      context.beginPath();context.arc(screenPoint.x,screenPoint.y,Math.max(.55,point.radius*viewportScale*(selected?.48:.28)),0,Math.PI*2);context.fill();
    });
    context.restore();context.globalCompositeOperation="source-over";

    if(clusters.length){
      const fontFamily=style.fontFamily||"system-ui";
      const labelColor=parseRgb(style,"--text-primary",[224,236,250]),labelGlow=parseRgb(style,"--accent-rgb",[120,170,230]);
      context.save();context.textAlign="center";context.textBaseline="bottom";context.font=`600 11px ${fontFamily}`;
      const labelAnchors=buildLabelAnchors(Math.min(180,Math.max(88,cssWidth*.18)));
      labelAnchors.forEach(anchor=>{
        context.shadowColor=rgba(labelGlow,.20);context.shadowBlur=5;context.fillStyle=rgba(labelColor,.18);context.fillText(anchor.label,anchor.x,anchor.y);
        context.shadowBlur=0;context.fillStyle=rgba(labelColor,.62);context.fillText(anchor.label,anchor.x,anchor.y);
      });
      context.restore();
    }
  }

  function renderFrame(now){
    frameHandle=0;
    const animating=updateAnimatedPoints(now),interacting=processInteraction(now);
    draw();updateTooltip();
    if(animating||interacting)scheduleFrame();
  }

  function scheduleFrame(){
    if(!mounted||frameHandle)return;
    frameHandle=requestAnimationFrame(renderFrame);
  }

  function stableTrackData(){
    const sourceTracks=getTracks?.(),tracks=Array.isArray(sourceTracks)?sourceTracks:[];
    const entries=tracks.map(track=>({track,vector:galaxy.featureVector(track)})).sort((left,right)=>left.vector.stableKey.localeCompare(right.vector.stableKey));
    trackByKey=new Map(entries.map(entry=>[entry.vector.stableKey,entry.track]));
    const signature=hashText(entries.map(entry=>`${entry.vector.stableKey}|${entry.vector.bpm}|${entry.vector.bpmConfidence}|${entry.vector.genre}|${entry.vector.genreSecondary||""}|${entry.vector.mfccComplete?1:0}|${entry.vector.coverage}|${entry.vector.confidence}|${entry.vector.mfcc.join(",")}`).join("\u001f")).toString(16);
    return {tracks:entries.map(entry=>entry.track),vectors:entries.map(entry=>entry.vector),signature};
  }

  function refresh(){
    if(!mounted||!measureCanvas())return false;
    if(animationStart!==null)updateAnimatedPoints(performance.now());
    const snapshot=stableTrackData(),viewportSignature=`${cssWidth.toFixed(2)}x${cssHeight.toFixed(2)}`;
    lastTracks=snapshot.tracks;lastVectors=snapshot.vectors;
    if(snapshot.signature===lastTrackSignature&&viewportSignature===lastViewportSignature){updateStatus();updateTooltip();scheduleFrame();return false;}

    const previous=new Map(visiblePoints.map(point=>[point.key,point]));
    layout=galaxy.buildLayout(lastTracks,{width:cssWidth,height:cssHeight});
    targetPoints=layout.points.map(point=>({...point}));clusters=layout.clusters.map(cluster=>({...cluster}));
    animationFrom=new Map(targetPoints.map(point=>[point.key,previous.get(point.key)||point]));
    const changed=targetPoints.some(point=>{const origin=animationFrom.get(point.key);return Math.abs(origin.x-point.x)>.25||Math.abs(origin.y-point.y)>.25;});
    visiblePoints=targetPoints.map(point=>{const origin=animationFrom.get(point.key);return {...point,x:origin.x,y:origin.y};});
    animationStart=changed&&!reducedMotion()?performance.now():null;
    if(animationStart===null){visiblePoints=targetPoints.map(point=>({...point}));animationFrom=new Map();}
    if(pinnedKey&&!targetPoints.some(point=>point.key===pinnedKey))pinnedKey=null;
    if(hoverKey&&!targetPoints.some(point=>point.key===hoverKey))hoverKey=null;
    lastTrackSignature=snapshot.signature;lastViewportSignature=viewportSignature;
    rebuildSpatialHash();updateStatus();updateTooltip();scheduleFrame();return true;
  }

  function setPointerFromEvent(event){
    const bounds=canvas.getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top,time=performance.now();
    const elapsed=Math.max(1,time-pointer.time),distance=Math.hypot(x-pointer.x,y-pointer.y);
    pointer.speed=pointer.time?distance/elapsed*1000:0;pointer.x=x;pointer.y=y;pointer.time=time;pointer.inside=true;
  }

  function onPointerDown(event){
    if(event.button!==0)return;
    setPointerFromEvent(event);canvas.focus?.({preventScroll:true});dragPointerId=event.pointerId;dragStartX=pointer.x;dragStartY=pointer.y;dragOriginOffsetX=viewportOffsetX;dragOriginOffsetY=viewportOffsetY;dragMoved=false;canvas.setPointerCapture?.(event.pointerId);scheduleFrame();
  }
  function onPointerMove(event){
    setPointerFromEvent(event);
    if(dragPointerId===event.pointerId){
      const deltaX=pointer.x-dragStartX,deltaY=pointer.y-dragStartY;
      if(!dragMoved&&Math.hypot(deltaX,deltaY)>4){dragMoved=true;suppressClick=true;}
      if(dragMoved){viewportOffsetX=dragOriginOffsetX+deltaX;viewportOffsetY=dragOriginOffsetY+deltaY;clampViewportTransform();rebuildSpatialHash();updateTooltip();}
    }
    scheduleFrame();
  }
  function onPointerUp(event){
    if(dragPointerId!==event.pointerId)return;
    if(canvas.hasPointerCapture?.(event.pointerId))canvas.releasePointerCapture?.(event.pointerId);
    dragPointerId=null;pointer.speed=0;pointer.time=performance.now();scheduleFrame();
  }
  function onPointerCancel(event){onPointerUp(event);suppressClick=false;}
  function onPointerLeave(){
    if(dragPointerId!==null)return;
    pointer.inside=false;pointer.speed=0;pointer.time=performance.now();scheduleFrame();
  }
  function onClick(event){
    if(suppressClick){suppressClick=false;clickPending=false;return;}
    setPointerFromEvent(event);clickPending=true;scheduleFrame();
  }
  function onDoubleClick(event){event.preventDefault();resetViewport();}
  function onWheel(event){
    const bounds=canvas.getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top;
    const delta=event.deltaMode===1?event.deltaY*16:event.deltaMode===2?event.deltaY*cssHeight:event.deltaY;
    const nextScale=Math.max(GALAXY_MIN_SCALE,Math.min(GALAXY_MAX_SCALE,viewportScale*Math.exp(-delta*GALAXY_ZOOM_SENSITIVITY)));
    pointer.inside=true;pointer.x=x;pointer.y=y;pointer.speed=0;pointer.time=performance.now();
    if(nextScale!==viewportScale){
      const centerX=cssWidth*.5,centerY=cssHeight*.5,worldX=(x-centerX-viewportOffsetX)/viewportScale+centerX,worldY=(y-centerY-viewportOffsetY)/viewportScale+centerY;
      viewportScale=nextScale;viewportOffsetX=x-centerX-(worldX-centerX)*viewportScale;viewportOffsetY=y-centerY-(worldY-centerY)*viewportScale;clampViewportTransform();rebuildSpatialHash();updateTooltip();scheduleFrame();
    }
    event.preventDefault();
  }
  function onKeyDown(event){
    const key=String(event.key||"").toLowerCase();
    if(key==="0"||key==="r"||event.key==="Home"){event.preventDefault();resetViewport();return;}
    if(event.key!=="Escape")return;escapePending=true;scheduleFrame();
  }
  function onResize(){refresh();}
  function onThemeMutation(){tooltipKey=null;updateStatus();updateTooltip();scheduleFrame();}

  function mount(root=document){
    if(mounted)return controller;
    const resolvedView=root?.matches?.(".galaxy-view")?root:root?.querySelector?.(".galaxy-view");
    const resolvedCanvas=resolvedView?.querySelector("#galaxyCanvas"),resolvedTooltip=resolvedView?.querySelector("#galaxyTooltip"),resolvedStatus=resolvedView?.querySelector("#galaxyStatus");
    if(!resolvedView||!resolvedCanvas||!resolvedTooltip||!resolvedStatus)return controller;
    const resolvedContext=resolvedCanvas.getContext("2d",{alpha:true});if(!resolvedContext)return controller;
    view=resolvedView;canvas=resolvedCanvas;tooltip=resolvedTooltip;status=resolvedStatus;shell=canvas.closest(".galaxy-canvas-shell");context=resolvedContext;mounted=true;
    canvas.style.touchAction="none";
    window.addEventListener("resize",onResize,{passive:true});
    canvas.addEventListener("pointerdown",onPointerDown);canvas.addEventListener("pointermove",onPointerMove,{passive:true});canvas.addEventListener("pointerup",onPointerUp,{passive:true});canvas.addEventListener("pointercancel",onPointerCancel,{passive:true});canvas.addEventListener("pointerleave",onPointerLeave,{passive:true});canvas.addEventListener("wheel",onWheel,{passive:false});canvas.addEventListener("dblclick",onDoubleClick);canvas.addEventListener("click",onClick);canvas.addEventListener("keydown",onKeyDown);
    if(typeof ResizeObserver==="function"){resizeObserver=new ResizeObserver(onResize);resizeObserver.observe(shell);}
    if(typeof MutationObserver==="function"){
      themeObserver=new MutationObserver(onThemeMutation);
      themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:["lang","style"]});
      themeObserver.observe(document.body,{attributes:true,attributeFilter:["data-theme"]});
    }
    refresh();return controller;
  }

  function destroy(){
    if(!mounted)return;
    window.removeEventListener("resize",onResize);
    if(dragPointerId!==null&&canvas.hasPointerCapture?.(dragPointerId))canvas.releasePointerCapture?.(dragPointerId);
    canvas.removeEventListener("pointerdown",onPointerDown);canvas.removeEventListener("pointermove",onPointerMove);canvas.removeEventListener("pointerup",onPointerUp);canvas.removeEventListener("pointercancel",onPointerCancel);canvas.removeEventListener("pointerleave",onPointerLeave);canvas.removeEventListener("wheel",onWheel);canvas.removeEventListener("dblclick",onDoubleClick);canvas.removeEventListener("click",onClick);canvas.removeEventListener("keydown",onKeyDown);canvas.style.removeProperty("touch-action");
    resizeObserver?.disconnect();themeObserver?.disconnect();resizeObserver=null;themeObserver=null;
    if(frameHandle)cancelAnimationFrame(frameHandle);frameHandle=0;clearTooltip();releaseLayers();
    status.style.removeProperty("inset");status.style.removeProperty("transform");status.style.removeProperty("text-align");
    mounted=false;view=null;shell=null;canvas=null;tooltip=null;status=null;context=null;
    cssWidth=0;cssHeight=0;lastTrackSignature="";lastViewportSignature="";lastTracks=[];lastVectors=[];layout=null;targetPoints=[];visiblePoints=[];clusters=[];animationFrom=new Map();animationStart=null;
    pointByKey=new Map();trackByKey=new Map();spatialHash=new Map();hoverKey=null;pinnedKey=null;dwellKey=null;dwellStart=0;tooltipKey=null;clickPending=false;escapePending=false;viewportScale=1;viewportOffsetX=0;viewportOffsetY=0;dragPointerId=null;dragStartX=0;dragStartY=0;dragOriginOffsetX=0;dragOriginOffsetY=0;dragMoved=false;suppressClick=false;
    pointer.inside=false;pointer.x=0;pointer.y=0;pointer.time=0;pointer.speed=0;
  }

  function isMounted(){return mounted;}
  const controller=Object.freeze({mount,refresh,destroy,isMounted});
  return controller;
});
