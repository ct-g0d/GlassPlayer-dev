  GP.spatialPresets = (() => {
    const freezePreset=value=>{if(value&&typeof value==="object"){Object.values(value).forEach(freezePreset);Object.freeze(value);}return value;};
    const presets=freezePreset({
      none:{id:"none",name:{zh:"无空间音效",en:"No Spatial Audio"},description:{zh:"关闭全部空间处理。",en:"Disables all spatial processing."},lowSideGain:1,midWidth:1,highWidth:1,crossfeed:null,hrtf:{angle:0,wet:0},reflectionWet:0,reverb:null,chorus:null,outputTrimDb:0},
      orbit:{id:"orbit",name:{zh:"环绕音",en:"Orbit"},description:{zh:"经典 3D 环绕，声像缓慢绕头部旋转。",en:"Classic 3D surround that slowly circles around the listener."},mainGain:.72,lowSideGain:.04,midWidth:1.02,highWidth:1.05,crossfeed:null,hrtf:{angle:0,wet:.42},reflectionWet:.012,reverb:null,chorus:null,orbit:{rate:.09,depth:.88},outputTrimDb:-1.5},
      desktop:{id:"desktop",name:{zh:"桌面音响",en:"Desktop Speakers"},description:{zh:"把声音自然移到面前，适合长期听。",en:"Moves the sound naturally in front for long listening."},lowSideGain:.15,midWidth:1.01,highWidth:1.04,crossfeed:{gainDb:-22,delay:.00028,lowpass:900},hrtf:{angle:30,wet:0},reflectionWet:.015,reverb:null,chorus:null,outputTrimDb:-.5},
      studio:{id:"studio",name:{zh:"监听音箱",en:"Studio Monitors"},description:{zh:"中央更准、染色更少，适合检查人声。",en:"Tighter center and minimal colour for checking vocals."},lowSideGain:.10,midWidth:1,highWidth:1.02,crossfeed:{gainDb:-26,delay:.00022,lowpass:1000},hrtf:{angle:25,wet:0},reflectionWet:0,reverb:null,chorus:null,outputTrimDb:-.3},
      wide:{id:"wide",name:{zh:"宽阔舞台",en:"Wide Stage"},description:{zh:"主要向左右展开，房间感很轻。",en:"Expands mainly sideways with little room colour."},lowSideGain:.05,midWidth:1.05,highWidth:1.10,crossfeed:null,hrtf:{angle:35,wet:.06},reflectionWet:.015,reverb:null,chorus:null,outputTrimDb:-.8},
      front:{id:"front",name:{zh:"前置双耳",en:"Front Binaural"},description:{zh:"明显减少脑内感，把声像推向前方。",en:"Reduces in-head sound and pushes the image forward."},lowSideGain:.10,midWidth:1.01,highWidth:1.04,crossfeed:null,hrtf:{angle:28,wet:.22},reflectionWet:.02,reverb:null,chorus:null,outputTrimDb:-1},
      hall:{id:"hall",name:{zh:"现场大厅",en:"Live Hall"},description:{zh:"舞台更远，增加演出厅空间和尾音。",en:"Adds concert-hall distance, space and ambience."},lowSideGain:0,midWidth:1.03,highWidth:1.08,crossfeed:null,hrtf:{angle:35,wet:.12},reflectionWet:.045,reverb:{wet:.025,decay:.55,highpass:200,lowpass:7500},chorus:null,outputTrimDb:-1.3},
      cinema:{id:"cinema",name:{zh:"影院",en:"Cinema"},description:{zh:"更宽、更远，并增强前后深度。",en:"Creates a wider, farther stage with stronger depth."},lowSideGain:0,midWidth:1.04,highWidth:1.10,crossfeed:null,hrtf:{angle:42,wet:.20},reflectionWet:.055,reverb:{wet:.035,decay:.60,highpass:180,lowpass:7000},chorus:null,outputTrimDb:-1.6},
      dream:{id:"dream",name:{zh:"梦境",en:"Dreamscape"},description:{zh:"柔和漂浮、略带朦胧，适合氛围音乐。",en:"Soft, floating and hazy for atmospheric music."},lowSideGain:.05,midWidth:1.05,highWidth:1.12,crossfeed:null,hrtf:{angle:38,wet:.10},reflectionWet:.025,reverb:{wet:.04,decay:.75,highpass:220,lowpass:8000},chorus:{wet:.012,baseDelay:.012,depth:.001,rate:.18},outputTrimDb:-1.3}
    });
    function getPreset(id){return presets[id]||null;}
    function getAllPresets(){return Object.freeze(Object.values(presets));}
    function getDescription(id,language){const preset=getPreset(id);return preset?.description?.[language==="en"?"en":"zh"]||"";}
    return Object.freeze({getPreset,getAllPresets,getDescription});
  })();
