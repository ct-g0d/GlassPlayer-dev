  /* ================= GP Neural Engine 2.2 — Resonance Boost =================
     Preference and recommendation are deliberately separate. Until the model
     passes its evidence/confidence gate, shuffle and Daily Mix remain uniform. */
  const NEURAL_MODEL_VERSION=4;
  const NEURAL_HALF_LIFE_MS=45*86400000;
  const NEURAL_MIN_EVENTS=20;
  const NEURAL_MIN_DAYS=5;
  const NEURAL_MIN_CONFIDENCE=.70;
  const GP_DAILY_MIX_COHERENCE_EXPONENT=3.4;
  const GP_DAILY_MIX_SHORTLIST_RATIO=.45;
  let neuralGalaxyService=null;
  const neuralSessionId=`session-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  let neuralModel=null,neuralBuildTimer=0,lastNeuralBuildAt=0,pendingSelectionSource="automatic";
  let behaviorRuntime={trackId:null,startedAt:0,lastWallAt:0,lastMediaAt:0,listened:0,checkpoint:0,source:"automatic"};
  const sessionPreference={signals:[],recentTrackIds:[],exploration:{}};

  function finiteNumber(value,fallback=null){const n=Number(value);return Number.isFinite(n)?n:fallback;}
  const clamp=(...args)=>GP.utils.clamp(...args);
  function listeningPeriodForHour(value){
    const hour=((Number(value)||0)%24+24)%24;
    if(hour>=22||hour<5)return "late";
    if(hour<10)return "morning";
    if(hour<15)return "noon";
    if(hour<18)return "afternoon";
    return "evening";
  }
  function neuralTrackId(track){return track?.spectrumId||track?.audioEssenceKey||track?.contentKey||track?.id||trackKey(track);}
  function neuralArtistKey(track){return String(track?.artist||"").trim().toLocaleLowerCase()||`track:${neuralTrackId(track)}`;}
  function cleanMfcc(track){
    const raw=Array.isArray(track?.mfcc?.mean)?track.mfcc.mean:Array.isArray(track?.mfcc)?track.mfcc:[];
    return raw.slice(0,13).map(value=>finiteNumber(value,0));
  }
  function trackFeatureSnapshot(track){
    if(!track)return null;
    const rawEnergy=finiteNumber(track.energy),energy=Number.isFinite(rawEnergy)?(rawEnergy>1?rawEnergy/100:rawEnergy):null;
    return {spectrumId:neuralTrackId(track),artist:track.artist||"",album:track.album||"",genre:track.genre||track.inferredGenre||"Unknown",genreSecondary:track.genreSecondary||null,bpm:finiteNumber(track.bpm),energy,mfcc:cleanMfcc(track)};
  }
  function behaviorSignal(type,context={}){
    if(type==="search_select")return 2.8;
    if(type==="manual_select")return 2.4;
    if(type==="queue_add")return 2.6;
    if(type==="replay")return 2.5;
    if(type==="complete")return 1.35;
    if(type==="listen_duration")return clamp((finiteNumber(context.actualPlaybackSeconds,0)/180)*.65,0,.65);
    if(type==="skip"){
      const ratio=clamp(finiteNumber(context.progressRatio,0),0,1);
      if(ratio<.08)return-2.6;if(ratio<.25)return-1.65;if(ratio<.55)return-.8;if(ratio<.9)return-.2;return 0;
    }
    return 0;
  }
  function scheduleUserModelRefresh(){
    clearTimeout(neuralBuildTimer);
    const delay=Math.max(700,60000-(Date.now()-lastNeuralBuildAt));
    neuralBuildTimer=setTimeout(()=>refreshUserModel(),delay);
  }
  async function recordBehaviorEvent(type,track=null,context={}){
    const features=trackFeatureSnapshot(track);
    const event={id:`${Date.now()}-${Math.random().toString(36).slice(2,10)}`,type,timestamp:Date.now(),sessionId:neuralSessionId,spectrumId:features?.spectrumId||null,features,context:{...context},signal:behaviorSignal(type,context)};
    try{await GPDatabase.addBehaviorEvent(event);}catch(error){console.warn("Behavior event persistence failed",error);}
    if(event.signal&&features){
      sessionPreference.signals.push({timestamp:event.timestamp,signal:event.signal,features});
      if(sessionPreference.signals.length>80)sessionPreference.signals.splice(0,sessionPreference.signals.length-80);
      if(type==="complete"&&context.selectionSource==="shuffle")sessionPreference.exploration[features.genre]=(sessionPreference.exploration[features.genre]||0)+1;
    }
    if(event.signal) scheduleUserModelRefresh();return event;
  }
  function mapAdd(map,key,value){if(!key)return;map[key]=(map[key]||0)+value;}
  function weightedMeanAdd(acc,value,weight){if(!Number.isFinite(value)||weight===0)return;acc.sum+=value*weight;acc.weight+=Math.abs(weight);}
  function modelConfidence(effectiveEvents,activeDays,featureEvents,acousticEvents){
    const evidence=clamp(effectiveEvents/45,0,1),days=clamp(activeDays/10,0,1),features=featureEvents?clamp(acousticEvents/featureEvents,0,1):0;
    return clamp(evidence*.52+days*.28+features*.20,0,1);
  }
  async function buildUserPreferenceModel(){
    let events=[];try{events=await GPDatabase.getBehaviorEvents()||[];}catch(error){return neuralModel;}
    events=events.filter(event=>Date.now()-finiteNumber(event.timestamp,Date.now())<=270*86400000).sort((a,b)=>a.timestamp-b.timestamp).slice(-12000);
    const now=Date.now(),artist={},album={},genre={},timeGenre={},lastPlayed={},trackEvidence={};
    const bpm={sum:0,weight:0},energy={sum:0,weight:0},mfcc={sum:Array(13).fill(0),weight:0};
    const days=new Set(),explorationFeedback={};let effectiveEvents=0,featureEvents=0,acousticEvents=0;
    const byId=new Map(playlist.map(track=>[neuralTrackId(track),track]));
    let neuralEventsProcessed=0;
    for(const event of events){
      if(neuralEventsProcessed>0&&neuralEventsProcessed%32===0)await yieldToInputPriority();
      neuralEventsProcessed++;
      const live=byId.get(event.spectrumId),features=live?trackFeatureSnapshot(live):event.features;if(!features)continue;
      const raw=finiteNumber(event.signal,behaviorSignal(event.type,event.context||{}));if(!raw)continue;
      const age=Math.max(0,now-finiteNumber(event.timestamp,now)),decay=Math.pow(.5,age/NEURAL_HALF_LIFE_MS);
      let signal=raw*decay;
      const exploratory=["shuffle","recommendation"].includes(event.context?.selectionSource),genreKey=features.genre||"Unknown";
      explorationFeedback[genreKey]=explorationFeedback[genreKey]||{accepted:0,skipped:0};
      if(exploratory&&event.type==="complete"){
        if(explorationFeedback[genreKey].accepted<3)signal*=.28;
        explorationFeedback[genreKey].accepted++;
      }
      if(exploratory&&event.type==="skip"){
        if(explorationFeedback[genreKey].skipped<4)signal*=.18;
        explorationFeedback[genreKey].skipped++;
      }
      effectiveEvents+=Math.min(1,Math.abs(signal));featureEvents++;days.add(new Date(event.timestamp).toISOString().slice(0,10));
      mapAdd(artist,features.artist,signal);mapAdd(album,features.album,signal);mapAdd(genre,features.genre,signal);
      const slot=listeningPeriodForHour(new Date(event.timestamp).getHours());
      timeGenre[slot]=timeGenre[slot]||{};mapAdd(timeGenre[slot],features.genre,signal);
      if(signal>0){
        weightedMeanAdd(bpm,features.bpm,signal);weightedMeanAdd(energy,features.energy,signal);
        if(features.mfcc?.length){for(let i=0;i<13;i++)mfcc.sum[i]+=(features.mfcc[i]||0)*signal;mfcc.weight+=signal;acousticEvents++;}
      }
      const id=features.spectrumId;trackEvidence[id]=trackEvidence[id]||{support:0,skips:0,completes:0};trackEvidence[id].support+=signal;
      if(event.type==="skip")trackEvidence[id].skips++;if(event.type==="complete")trackEvidence[id].completes++;
      if(["complete","skip","listen_duration"].includes(event.type))lastPlayed[id]=Math.max(lastPlayed[id]||0,event.timestamp);
    }
    const confidence=modelConfidence(effectiveEvents,days.size,featureEvents,acousticEvents);
    const model={id:"default",version:NEURAL_MODEL_VERSION,updatedAt:now,confidence,effectiveEvidence:effectiveEvents,activeDays:days.size,mature:effectiveEvents>=NEURAL_MIN_EVENTS&&days.size>=NEURAL_MIN_DAYS&&confidence>=NEURAL_MIN_CONFIDENCE,preference:{artist,album,genre,bpm:bpm.weight?bpm.sum/bpm.weight:null,energy:energy.weight?energy.sum/energy.weight:null,mfcc:mfcc.weight?mfcc.sum.map(v=>v/mfcc.weight):[],timeGenre},lastPlayed,trackEvidence};
    try{await GPDatabase.saveUserModel(model);}catch(error){console.warn("User model persistence failed",error);}return model;
  }
  async function refreshUserModel(){
    clearTimeout(neuralBuildTimer);neuralBuildTimer=0;lastNeuralBuildAt=Date.now();
    await yieldToInputPriority();
    neuralModel=await buildUserPreferenceModel()||neuralModel;
    await yieldToInputPriority();
    return neuralModel;
  }
  function normalizedMapScore(map,key){
    if(!map||!key)return 0;const values=Object.values(map).map(Math.abs),max=Math.max(1,...values);return clamp((map[key]||0)/max,-1,1);
  }
  function genrePreferenceScore(map,key){return GP.genreRelations?.relatedScore(map,key)??normalizedMapScore(map,key);}
  function genreSimilarity(a,b){return GP.genreRelations?.similarity(a,b)??(a&&b&&a===b?1:0);}
  function mfccSimilarity(a,b){if(!a?.length||!b?.length)return 0;let distance=0;for(let i=0;i<Math.min(a.length,b.length);i++){const scale=Math.max(8,Math.abs(b[i]||0));distance+=Math.abs((a[i]||0)-(b[i]||0))/scale;}return Math.exp(-distance/Math.min(a.length,b.length));}
  function currentSessionScore(features){
    const now=Date.now();let total=0,weight=0;
    for(const item of sessionPreference.signals){const age=now-item.timestamp,decay=Math.exp(-age/(45*60000));if(decay<.02)continue;let sim=0;if(item.features.artist===features.artist)sim+=.3;if(item.features.album===features.album)sim+=.18;sim+=genreSimilarity(item.features.genre,features.genre)*.25;sim+=mfccSimilarity(features.mfcc,item.features.mfcc)*.27;total+=item.signal*decay*sim;weight+=decay;}
    return weight?clamp(total/weight,-1,1):0;
  }
  function recommendationScore(track,context={}){
    const model=neuralModel,features=trackFeatureSnapshot(track);if(!model?.mature||!features)return{score:1,parts:{fallback:"uniform"}};
    const p=model.preference,longTerm=normalizedMapScore(p.artist,features.artist)*.30+normalizedMapScore(p.album,features.album)*.13+genrePreferenceScore(p.genre,features.genre)*.25;
    const bpmMatch=Number.isFinite(features.bpm)&&Number.isFinite(p.bpm)?Math.exp(-Math.abs(features.bpm-p.bpm)/35):0;
    const energyMatch=Number.isFinite(features.energy)&&Number.isFinite(p.energy)?Math.exp(-Math.abs(features.energy-p.energy)/.3):0;
    const acoustic=mfccSimilarity(features.mfcc,p.mfcc);const slot=listeningPeriodForHour(new Date().getHours());
    const time=genrePreferenceScore(p.timeGenre?.[slot],features.genre)*model.confidence;
    const session=currentSessionScore(features),last=model.lastPlayed?.[features.spectrumId]||0,ageHours=(Date.now()-last)/3600000;
    const freshness=last?clamp((ageHours-8)/72,-1,.7):.7;
    const recent=sessionPreference.recentTrackIds.slice(-5).map(id=>playlist.find(t=>neuralTrackId(t)===id)).filter(Boolean);
    const diversity=recent.reduce((penalty,t)=>penalty+(t.artist===features.artist ? .15 : 0)+genreSimilarity(t.genre,features.genre)*.08,0);
    const exploration=model.trackEvidence?.[features.spectrumId]?.support?0:.12;
    const raw=longTerm+acoustic*.12+bpmMatch*.08+energyMatch*.07+time*.12+session*.34+freshness*.20+exploration-diversity;
    return{score:clamp(Math.exp(raw),.35,3.4),parts:{longTerm,acoustic,bpmMatch,energyMatch,time,session,freshness,diversity,exploration}};
  }
  function uniformPick(candidates){return candidates[Math.floor(Math.random()*candidates.length)];}
  function weightedRandom(candidates,weights){const total=weights.reduce((a,b)=>a+b,0);if(!(total>0))return uniformPick(candidates);let r=Math.random()*total;for(let i=0;i<candidates.length;i++){r-=weights[i];if(r<=0)return candidates[i];}return uniformPick(candidates);}
  function recentRecommendationIdSet({includeLastMix=false}={}){
    const limit=Math.min(16,Math.max(6,Math.ceil(playlist.length*.04))),ids=sessionPreference.recentTrackIds.slice(-limit);
    shuffleTimeline.slice(Math.max(0,shuffleTimelineCursor-limit+1),shuffleTimelineCursor+1).forEach(index=>{if(playlist[index])ids.push(neuralTrackId(playlist[index]));});
    if(includeLastMix&&Array.isArray(lastMix))lastMix.forEach(index=>{if(playlist[index])ids.push(neuralTrackId(playlist[index]));});
    return new Set(ids.filter(Boolean));
  }
  function recentRecommendationArtistSet(limit=2){
    const ids=sessionPreference.recentTrackIds.slice(-limit),artists=new Set();
    shuffleTimeline.slice(Math.max(0,shuffleTimelineCursor-limit+1),shuffleTimelineCursor+1).forEach(index=>{if(playlist[index])ids.push(neuralTrackId(playlist[index]));});
    ids.map(id=>playlist.find(track=>neuralTrackId(track)===id)).filter(Boolean).forEach(track=>artists.add(neuralArtistKey(track)));
    return artists;
  }
  function weightedPickIndex(excludeIdx,pool){
    let candidates=(pool||playlist.map((_,i)=>i)).filter(i=>i!==excludeIdx);if(!candidates.length)return excludeIdx;
    const recent=recentRecommendationIdSet(),fresh=candidates.filter(index=>!recent.has(neuralTrackId(playlist[index])));
    if(fresh.length)candidates=fresh;
    const alternateArtists=candidates.filter(index=>!recentRecommendationArtistSet().has(neuralArtistKey(playlist[index])));
    if(alternateArtists.length)candidates=alternateArtists;
    if(!neuralModel?.mature)return uniformPick(candidates);
    return weightedRandom(candidates,candidates.map(i=>recommendationScore(playlist[i],{surface:"shuffle"}).score));
  }
  function dailyGenreTokens(features){
    return [features?.genre,features?.genreSecondary].filter(Boolean).flatMap(value=>String(value).toLowerCase().split(/[\/,;&+|]+/)).map(value=>GP.genreRelations?.resolve(value)?.id||value.trim()).filter(value=>value&&value!=="unknown"&&value!=="mixed");
  }
  function dailyFeatureCompleteness(features){return (features?.spectrumId?1:0)+(features?.mfcc?.length>=8?2:0)+(dailyGenreTokens(features).length?1.5:0)+(Number.isFinite(features?.bpm)?.6:0)+(Number.isFinite(features?.energy)?.4:0);}
  function dailyFeatureSimilarity(anchor,candidate){
    if(!anchor||!candidate)return 0;
    const shared=neuralGalaxyService?.recommendationSimilarity?.(anchor,candidate);
    const sharedScore=Number.isFinite(shared?.overall)?shared.overall:.28;
    return clamp(sharedScore,0,1);
  }
  function generateDailyMix(count){
    let remaining=playlist.map((track,index)=>{const features=trackFeatureSnapshot(track);return{index,features,completeness:dailyFeatureCompleteness(features)};}).filter(item=>item.index!==currentIndex),picked=[],pickedFeatures=[],artistCounts=new Map();
    const recent=recentRecommendationIdSet({includeLastMix:true}),fresh=remaining.filter(item=>!recent.has(item.features?.spectrumId));
    if(fresh.length>=Math.min(count,remaining.length))remaining=fresh;
    if(!remaining.length)return picked;
    const currentFeatures=currentIndex>=0?trackFeatureSnapshot(playlist[currentIndex]):null;
    let anchor=currentFeatures&&dailyFeatureCompleteness(currentFeatures)>=3?currentFeatures:null;
    if(!anchor){
      const anchorPool=remaining.filter(item=>item.completeness>=2.5),pool=anchorPool.length?anchorPool:remaining;
      const anchorItem=weightedRandom(pool,pool.map(item=>Math.max(.1,item.completeness)*(neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily-anchor"}).score:1)));
      anchor=anchorItem.features;
    }
    const targetCount=Math.min(count,remaining.length);
    while(picked.length<targetCount){
      const scored=remaining.map(item=>{
        const anchorScore=dailyFeatureSimilarity(anchor,item.features);
        const clusterScore=pickedFeatures.length?pickedFeatures.reduce((sum,features)=>sum+dailyFeatureSimilarity(features,item.features),0)/pickedFeatures.length:anchorScore;
        const coherence=anchorScore*.76+clusterScore*.24,preference=neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily"}).score:1,artist=neuralArtistKey(playlist[item.index]),artistRepeat=artistCounts.get(artist)||0,diversityPenalty=Math.pow(.48,artistRepeat);
        return{item,coherence,weight:Math.pow(Math.max(.025,coherence),GP_DAILY_MIX_COHERENCE_EXPONENT)*Math.sqrt(preference)*Math.max(.65,item.completeness/4.5)*diversityPenalty};
      }).sort((a,b)=>b.coherence-a.coherence);
      const shortlist=scored.slice(0,Math.max(3,Math.ceil(scored.length*GP_DAILY_MIX_SHORTLIST_RATIO))),choice=weightedRandom(shortlist,shortlist.map(entry=>entry.weight));
      picked.push(choice.item.index);pickedFeatures.push(choice.item.features);const artist=neuralArtistKey(playlist[choice.item.index]);artistCounts.set(artist,(artistCounts.get(artist)||0)+1);remaining.splice(remaining.indexOf(choice.item),1);
    }
    recommendationPersistPromise=GPDatabase.saveRecommendations({id:"daily",generatedAt:Date.now(),modelConfidence:neuralModel?.confidence||0,mode:"feature-clustered",anchorSpectrumId:anchor?.spectrumId||null,tracks:picked.map(i=>neuralTrackId(playlist[i]))}).then(()=>true).catch(()=>false);return picked;
  }
  async function generateDailyMixForImport(count){
    const remaining=[];
    for(let index=0;index<playlist.length;index++){
      if(index!==currentIndex){const features=trackFeatureSnapshot(playlist[index]);remaining.push({index,features,completeness:dailyFeatureCompleteness(features)});}
      if(index&&index%48===0)await yieldToInputPriority();
    }
    let pool=remaining,picked=[],pickedFeatures=[],artistCounts=new Map();const recent=recentRecommendationIdSet({includeLastMix:true}),fresh=pool.filter(item=>!recent.has(item.features?.spectrumId));
    if(fresh.length>=Math.min(count,pool.length))pool=fresh;if(!pool.length)return picked;
    const currentFeatures=currentIndex>=0?trackFeatureSnapshot(playlist[currentIndex]):null;let anchor=currentFeatures&&dailyFeatureCompleteness(currentFeatures)>=3?currentFeatures:null;
    if(!anchor){const anchorPool=pool.filter(item=>item.completeness>=2.5),choices=anchorPool.length?anchorPool:pool;anchor=weightedRandom(choices,choices.map(item=>Math.max(.1,item.completeness)*(neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily-anchor"}).score:1))).features;}
    const targetCount=Math.min(count,pool.length);
    while(picked.length<targetCount){
      const scored=[];let scoreSliceStarted=performance.now();
      for(const item of pool){
        const anchorScore=dailyFeatureSimilarity(anchor,item.features),clusterScore=pickedFeatures.length?pickedFeatures.reduce((sum,features)=>sum+dailyFeatureSimilarity(features,item.features),0)/pickedFeatures.length:anchorScore,coherence=anchorScore*.76+clusterScore*.24,preference=neuralModel?.mature?recommendationScore(playlist[item.index],{surface:"daily"}).score:1;
        const artist=neuralArtistKey(playlist[item.index]),artistRepeat=artistCounts.get(artist)||0,diversityPenalty=Math.pow(.48,artistRepeat);
        scored.push({item,coherence,weight:Math.pow(Math.max(.025,coherence),GP_DAILY_MIX_COHERENCE_EXPONENT)*Math.sqrt(preference)*Math.max(.65,item.completeness/4.5)*diversityPenalty});
        if(performance.now()-scoreSliceStarted>=8){await yieldToInputPriority();scoreSliceStarted=performance.now();}
      }
      scored.sort((a,b)=>b.coherence-a.coherence);
      const shortlist=scored.slice(0,Math.max(3,Math.ceil(scored.length*GP_DAILY_MIX_SHORTLIST_RATIO))),choice=weightedRandom(shortlist,shortlist.map(entry=>entry.weight));picked.push(choice.item.index);pickedFeatures.push(choice.item.features);const artist=neuralArtistKey(playlist[choice.item.index]);artistCounts.set(artist,(artistCounts.get(artist)||0)+1);pool.splice(pool.indexOf(choice.item),1);
      await yieldToInputPriority();
    }
    recommendationPersistPromise=GPDatabase.saveRecommendations({id:"daily",generatedAt:Date.now(),modelConfidence:neuralModel?.confidence||0,mode:"feature-clustered",anchorSpectrumId:anchor?.spectrumId||null,tracks:picked.map(i=>neuralTrackId(playlist[i]))}).then(()=>true).catch(()=>false);return picked;
  }
  function settleBehaviorProgress(){
    if(!behaviorRuntime.trackId||!audio||(audio.paused&&!audio.ended))return;const now=performance.now(),media=finiteNumber(audio.currentTime,behaviorRuntime.lastMediaAt),mediaDelta=media-behaviorRuntime.lastMediaAt,wallDelta=(now-behaviorRuntime.lastWallAt)/1000,rate=Math.max(.5,finiteNumber(audio.playbackRate,1));
    if(mediaDelta>0&&mediaDelta<=Math.max(5,wallDelta*rate+1.5))behaviorRuntime.listened+=mediaDelta;behaviorRuntime.lastWallAt=now;behaviorRuntime.lastMediaAt=media;
  }
  function resetBehaviorMediaClock(){behaviorRuntime.lastWallAt=performance.now();behaviorRuntime.lastMediaAt=finiteNumber(audio.currentTime,0);}
  function beginBehaviorTrack(track,source="automatic"){
    behaviorRuntime={trackId:neuralTrackId(track),startedAt:Date.now(),lastWallAt:performance.now(),lastMediaAt:finiteNumber(audio.currentTime,0),listened:0,checkpoint:0,source,playCounted:false};sessionPreference.recentTrackIds.push(behaviorRuntime.trackId);if(sessionPreference.recentTrackIds.length>20)sessionPreference.recentTrackIds.shift();pendingSelectionSource="automatic";
  }
  function emitListeningCheckpoint(reason="periodic"){
    settleBehaviorProgress();const t=playlist[currentIndex];if(!t)return;const delta=behaviorRuntime.listened-behaviorRuntime.checkpoint;if(delta<8&&reason==="periodic")return;if(delta>0){behaviorRuntime.checkpoint=behaviorRuntime.listened;recordBehaviorEvent("listen_duration",t,{actualPlaybackSeconds:delta,totalActualPlaybackSeconds:behaviorRuntime.listened,reason,selectionSource:behaviorRuntime.source});}
  }
  function recordSkip(track,context={}){settleBehaviorProgress();const duration=finiteNumber(audio.duration,finiteNumber(track?.duration,0)),position=finiteNumber(audio.currentTime,0),ratio=duration?position/duration:0;recordBehaviorEvent("skip",track,{...context,position,duration,progressRatio:ratio,actualPlaybackSeconds:behaviorRuntime.listened,selectionSource:behaviorRuntime.source});behaviorRuntime.checkpoint=behaviorRuntime.listened;}
  function recordComplete(track,context={}){
    settleBehaviorProgress();const duration=finiteNumber(audio.duration,finiteNumber(track?.duration,0)),progressRatio=duration?behaviorRuntime.listened/duration:0;
    if(progressRatio<.75){recordSkip(track,{...context,progressRatio});return false;}
    if(behaviorRuntime.playCounted)return false;
    behaviorRuntime.playCounted=true;recordBehaviorEvent("complete",track,{...context,duration,progressRatio,actualPlaybackSeconds:behaviorRuntime.listened,selectionSource:behaviorRuntime.source});behaviorRuntime.checkpoint=behaviorRuntime.listened;incrementPlayCount();return true;
  }
  function judgeAndRecordTransition(reason="transition"){const t=playlist[currentIndex];if(!t||!audio.duration)return;settleBehaviorProgress();const ratio=behaviorRuntime.listened/audio.duration;if(ratio>=.75)recordComplete(t,{reason});else recordSkip(t,{reason,progressRatio:ratio});}
  setInterval(()=>emitListeningCheckpoint("periodic"),30000);
  setTimeout(async()=>{
    try{const cached=await GPDatabase.getUserModel("default");if(cached?.version===NEURAL_MODEL_VERSION)neuralModel=cached;if(!cached||cached.version!==NEURAL_MODEL_VERSION||Date.now()-cached.updatedAt>6*3600000)scheduleUserModelRefresh();}catch(error){scheduleUserModelRefresh();}
  },0);
  let overrideQueue = null; // array of playlist indices, used by 每日推荐 playback
  let lastMix = null,dailyMixRefreshTimer=0,recommendationPersistPromise=Promise.resolve();
  function refreshDailyMix(){
    lastMix=playlist.length>=2?generateDailyMix(10):null;
    $("#playMixBtn").style.display=lastMix?.length?"inline-flex":"none";
    renderRecommendList();
    return lastMix;
  }
  async function finalizeDailyMixForImport(){
    clearTimeout(dailyMixRefreshTimer);
    let mix=playlist.length>=2?await generateDailyMixForImport(10):null;lastMix=mix;$("#playMixBtn").style.display=mix?.length?"inline-flex":"none";renderRecommendList();
    await recommendationPersistPromise;
    await yieldToInputPriority();
    const expected=Math.min(10,Math.max(0,playlist.length-1));
    let rendered=$("#recommendList")?.querySelectorAll(".recommend-track").length||0;
    if(expected>0&&(!Array.isArray(mix)||mix.length===0||rendered!==mix.length)){
      mix=await generateDailyMixForImport(10);lastMix=mix;$("#playMixBtn").style.display=mix?.length?"inline-flex":"none";renderRecommendList();
      await recommendationPersistPromise;
      await yieldToInputPriority();
      rendered=$("#recommendList")?.querySelectorAll(".recommend-track").length||0;
    }
    if(expected>0&&(!Array.isArray(mix)||mix.length===0||rendered!==mix.length))throw new Error("Daily Mix generation did not complete");
    return mix;
  }
  function scheduleDailyMixRefresh(delay=80){clearTimeout(dailyMixRefreshTimer);dailyMixRefreshTimer=setTimeout(refreshDailyMix,delay);}
  function renderRecommendList(){
    const el = $("#recommendList");
    if(playlist.length < 2){
      el.innerHTML = `<div class="recommend-empty">${tr("歌单里至少要有 2 首歌才能生成推荐","At least 2 songs are required to generate a mix")}</div>`;
      return;
    }
    if(!lastMix){lastMix=generateDailyMix(10);$("#playMixBtn").style.display=lastMix.length?"inline-flex":"none";}
    el.innerHTML = "";
    lastMix.forEach(idx => el.insertAdjacentHTML("beforeend", trackRowHTML(playlist[idx], idx, {compact:true,rowClass:"recommend-track"})));
    wireRows(el);
  }
  bindMicroMotion($("#playMixBtn"),"gp-mix-play-motion",500);
  $("#playMixBtn").addEventListener("click", () => {
    if(!lastMix || !lastMix.length) return;
    const mixTrackIds=[...new Set(lastMix.map(index=>playlist[index]?.id).filter(Boolean))];
    if(!mixTrackIds.length)return;
    overrideQueue=null;
    playQueue.length=0;
    playQueue.push(...mixTrackIds);
    manualQueueActive=true;
    playingQueuedTrack=false;
    queueResumeIndex=null;
    mixTrackIds.forEach(trackId=>{
      const track=playlist.find(item=>item.id===trackId);
      if(track)recordBehaviorEvent("queue_add",track,{placement:"daily_mix",movedExisting:false});
    });
    renderMiniQueue();
    showToast(tr(`今日推荐已加入手动播放队列（${mixTrackIds.length} 首）`,`Daily Mix added to Manual Queue (${mixTrackIds.length} tracks)`));
    const firstMixIndex=takeNextQueuedIndex();
    if(firstMixIndex===null)return;
    beginQueuedPlayback();
    pendingSelectionSource="queue";
    loadTrack(firstMixIndex,true);
  });

