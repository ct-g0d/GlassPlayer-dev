  /* ================= track info card + loudness meter ================= */
  const INFERRED_GENRE_ZH={Pop:"流行",Rock:"摇滚",Metal:"金属",Electronic:"电子", "Hip-Hop":"嘻哈", "R&B/Soul":"R&B / 灵魂乐",Jazz:"爵士",Classical:"古典",Ambient:"氛围", "Folk/Country":"民谣 / 乡村",Soundtrack:"原声配乐",Reggae:"雷鬼",Blues:"蓝调",Mixed:"混合风格"};
  const MFCC_TONE_LABELS={bright:["明亮","Bright"],deep:["厚重","Deep"],warm:["温暖","Warm"]};
  const MFCC_MOTION_LABELS={driving:["推进感","Driving"],dynamic:["动态丰富","Dynamic"],intense:["强烈","Intense"],punchy:["有冲击力","Punchy"],calm:["平稳","Calm"],smooth:["平滑","Smooth"],balanced:["均衡","Balanced"]};
  function formatTrackGenre(track){
    if(!track?.genre)return tr("未知","Unknown");
    if(track.genreSource!=="spectrum-inference")return track.genre;
    const localize=genre=>uiLanguage==="zh"?(INFERRED_GENRE_ZH[genre]||genre):genre;
    return track.genreSecondary?`${localize(track.genre)} / ${localize(track.genreSecondary)}`:localize(track.genre);
  }
  function formatMfccSummary(track){
    if(!track?.mfccSummary)return "--";
    const tone=MFCC_TONE_LABELS[track.mfccSummary.tone]||[track.mfccSummary.tone,track.mfccSummary.tone];
    const motion=MFCC_MOTION_LABELS[track.mfccSummary.motion||track.mood]||[track.mfccSummary.motion||track.mood||"",track.mfccSummary.motion||track.mood||""];
    const index=uiLanguage==="zh"?0:1;return `${tone[index]} · ${motion[index]}`;
  }
  function updateTrackInfoCard(t){
    if(!t){
      ["infoFormat","infoDuration","infoBitrate","infoSampleRate","infoChannels","infoGenre","infoEnergy","infoBpm","infoMfcc"].forEach(id => $("#"+id).textContent = "--");
      $("#loudnessFill").style.width = "0%";
      return;
    }
    const ext = t.format||audioFormatFromName(t.name);
    $("#infoFormat").textContent = ext || tr("未知","Unknown");
    $("#infoDuration").textContent = t.duration ? fmtTime(t.duration) : "--";
    const bitrate = Number.isFinite(t.bitrateKbps)?t.bitrateKbps:estimateTrackBitrate(t.fileSize||t.file?.size,t.duration);
    $("#infoBitrate").textContent = bitrate ? bitrate + " kbps" : tr("计算中…","Calculating…");
    const spectrumPending=t.spectrumStatus==="queued"||t.spectrumStatus==="analyzing";
    $("#infoSampleRate").textContent = t.sampleRate ? Math.round(t.sampleRate/1000*10)/10 + " kHz" : spectrumPending?tr("分析中…","Analyzing…"):"--";
    $("#infoChannels").textContent = t.channels ? (t.channels===1?tr("单声道","Mono"):t.channels===2?tr("立体声","Stereo"):t.channels+tr(" 声道"," channels")) : spectrumPending?tr("分析中…","Analyzing…"):"--";
    $("#infoGenre").textContent = formatTrackGenre(t);
    $("#infoEnergy").textContent=Number.isFinite(t.energy)?`${Math.round(t.energy)} / 100`:spectrumPending?tr("分析中…","Analyzing…"):t.spectrumStatus==="complete"?tr("未检测到","Not detected"):"--";
    $("#infoBpm").textContent=Number.isFinite(t.bpm)?`${Math.round(t.bpm)} BPM`:spectrumPending?tr("分析中…","Analyzing…"):t.spectrumStatus==="complete"?tr("未检测到","Not detected"):"--";
    $("#infoMfcc").textContent=Array.isArray(t.mfcc?.mean)?formatMfccSummary(t):spectrumPending?tr("分析中…","Analyzing…"):t.spectrumStatus==="complete"?tr("未检测到","Not detected"):"--";
    updateLoudnessMeter(t);
  }
  function updateLoudnessMeter(t){
    const fill = $("#loudnessFill");
    if(Number.isFinite(t?.energy)){fill.style.width=Math.max(0,Math.min(100,Math.round(t.energy)))+"%";return;}
    if(!t || !t.peaks || !t.peaks.length){ fill.style.width = "0%"; return; }
    const avg = t.peaks.reduce((a,b)=>a+b,0) / t.peaks.length;
    fill.style.width = Math.min(100, Math.round(avg*150)) + "%";
  }

