  /* ================= adding tracks (with embedded cover + genre) ================= */
  function normalizeSongIdentityPart(value){
    return String(value||"").normalize("NFKC").trim().toLocaleLowerCase().replace(/[‐‑‒–—]/g,"-").replace(/\s+/g," ").replace(/\s*(?:\(\d+\)|\[\d+\]|副本|copy)\s*$/i,"");
  }
  function songIdentity(artist,title){
    return `${normalizeSongIdentityPart(artist)}::${normalizeSongIdentityPart(title)}`;
  }
  function scheduleCooperativeYield(resolve){
    const schedulerYield=globalThis.scheduler?.yield;
    if(typeof schedulerYield==="function"){Promise.resolve(schedulerYield.call(globalThis.scheduler)).then(resolve,()=>setTimeout(resolve,0));return;}
    if(typeof setTimeout==="function"){setTimeout(resolve,0);return;}
    if(!document.hidden&&typeof requestAnimationFrame==="function"){requestAnimationFrame(resolve);return;}
    resolve();
  }
  async function yieldToInputPriority(){
    await new Promise(resolve=>scheduleCooperativeYield(resolve));
    if(navigator.scheduling?.isInputPending?.()){
      if(globalThis.scheduler?.yield)await globalThis.scheduler.yield();
      else await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  const bytesToHex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  const bytesToAscii=bytes=>String.fromCharCode(...bytes);
  async function sha256Hex(value){
    const bytes=value instanceof Uint8Array?value:new TextEncoder().encode(String(value));
    return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)));
  }
  const FILE_PROBE_CHUNK_BYTES=256*1024;
  const fileProbeChunkCache=new WeakMap();
  function getFileProbeCache(file){
    let cache=fileProbeChunkCache.get(file);
    if(!cache){cache={prefix:null,prefixPromise:null,prefixLength:0,chunks:new Map()};fileProbeChunkCache.set(file,cache);}
    return cache;
  }
  async function readFilePrefix(file,length){
    const safeLength=Math.max(0,Math.min(file.size,Math.floor(length)||0)),cache=getFileProbeCache(file);
    if(cache.prefix&&cache.prefix.length>=safeLength)return cache.prefix.slice(0,safeLength);
    if(cache.prefixPromise&&cache.prefixLength>=safeLength)return (await cache.prefixPromise).slice(0,safeLength);
    const promise=file.slice(0,safeLength).arrayBuffer().then(buffer=>new Uint8Array(buffer));
    cache.prefixPromise=promise;cache.prefixLength=safeLength;
    const bytes=await promise;
    if(cache.prefixPromise===promise){cache.prefix=bytes;cache.prefixPromise=null;cache.prefixLength=bytes.length;}
    return bytes.slice(0,safeLength);
  }
  async function readFileBytes(file,start,length){
    const safeStart=Math.max(0,Math.min(file.size,Math.floor(start)||0));
    const safeEnd=Math.max(safeStart,Math.min(file.size,safeStart+Math.max(0,Math.floor(length)||0)));
    if(safeStart===0)return readFilePrefix(file,safeEnd);
    const chunkStart=Math.floor(safeStart/FILE_PROBE_CHUNK_BYTES)*FILE_PROBE_CHUNK_BYTES;
    const chunkEnd=Math.min(file.size,chunkStart+FILE_PROBE_CHUNK_BYTES);
    if(safeEnd<=chunkEnd){
      const cache=getFileProbeCache(file);let chunkPromise=cache.chunks.get(chunkStart);
      if(!chunkPromise){chunkPromise=file.slice(chunkStart,chunkEnd).arrayBuffer().then(buffer=>new Uint8Array(buffer));cache.chunks.set(chunkStart,chunkPromise);}
      const chunk=await chunkPromise;return chunk.slice(safeStart-chunkStart,safeEnd-chunkStart);
    }
    return new Uint8Array(await file.slice(safeStart,safeEnd).arrayBuffer());
  }
  async function readFileBuffer(file,start,length){
    return (await readFileBytes(file,start,length)).slice().buffer;
  }
  function uint32be(bytes,offset=0){return ((bytes[offset]||0)*0x1000000)+((bytes[offset+1]||0)<<16)+((bytes[offset+2]||0)<<8)+(bytes[offset+3]||0);}
  function uint32le(bytes,offset=0){return ((bytes[offset]||0)|((bytes[offset+1]||0)<<8)|((bytes[offset+2]||0)<<16)|((bytes[offset+3]||0)<<24))>>>0;}
  async function detectFlacPayload(file){
    const signature=await readFileBytes(file,0,4);if(bytesToAscii(signature)!=="fLaC")return null;
    let offset=4,flacPcmMd5=null;
    for(let block=0;block<128&&offset+4<=file.size;block++){
      const header=await readFileBytes(file,offset,4);if(header.length<4)break;
      const isLast=Boolean(header[0]&0x80),type=header[0]&0x7f,size=(header[1]<<16)|(header[2]<<8)|header[3];
      if(type===0&&size>=34){const streamInfo=await readFileBytes(file,offset+4,34);if(streamInfo.length===34){const md5=streamInfo.slice(18,34);if(md5.some(Boolean))flacPcmMd5=bytesToHex(md5);}}
      offset+=4+size;if(isLast)return {start:offset,end:file.size,format:"flac",flacPcmMd5,reliable:true};
    }
    return null;
  }
  async function detectMp3Payload(file){
    let start=0,end=file.size;
    const header=await readFileBytes(file,0,10);
    if(header.length===10&&bytesToAscii(header.slice(0,3))==="ID3"){
      const tagSize=((header[6]&0x7f)<<21)|((header[7]&0x7f)<<14)|((header[8]&0x7f)<<7)|(header[9]&0x7f);
      start=Math.min(end,10+tagSize+((header[5]&0x10)?10:0));
    }
    const id3v1=await readFileBytes(file,Math.max(start,end-128),128);
    if(id3v1.length===128&&bytesToAscii(id3v1.slice(0,3))==="TAG")end-=128;
    const apeFooter=await readFileBytes(file,Math.max(start,end-32),32);
    if(apeFooter.length===32&&bytesToAscii(apeFooter.slice(0,8))==="APETAGEX"){
      const apeSize=uint32le(apeFooter,12);if(apeSize>0&&apeSize<=end-start)end-=apeSize;
    }
    return {start,end:Math.max(start,end),format:"mp3",flacPcmMd5:null,reliable:true};
  }
  async function detectWavPayload(file){
    const header=await readFileBytes(file,0,12);if(header.length<12||bytesToAscii(header.slice(0,4))!=="RIFF"||bytesToAscii(header.slice(8,12))!=="WAVE")return null;
    let offset=12;
    for(let chunk=0;chunk<4096&&offset+8<=file.size;chunk++){
      const chunkHeader=await readFileBytes(file,offset,8);const id=bytesToAscii(chunkHeader.slice(0,4)),size=uint32le(chunkHeader,4);
      if(id==="data")return {start:offset+8,end:Math.min(file.size,offset+8+size),format:"wav",flacPcmMd5:null,reliable:true};
      offset+=8+size+(size&1);
    }
    return null;
  }
  async function detectMp4Payload(file){
    let offset=0;
    for(let atom=0;atom<4096&&offset+8<=file.size;atom++){
      const header=await readFileBytes(file,offset,16);if(header.length<8)break;
      let size=uint32be(header,0),headerSize=8;const type=bytesToAscii(header.slice(4,8));
      if(size===1&&header.length>=16){const view=new DataView(header.buffer,header.byteOffset,header.byteLength);const large=view.getBigUint64(8);size=Number(large>BigInt(Number.MAX_SAFE_INTEGER)?BigInt(file.size-offset):large);headerSize=16;}
      else if(size===0)size=file.size-offset;
      if(size<headerSize)break;
      if(type==="mdat")return {start:offset+headerSize,end:Math.min(file.size,offset+size),format:"mp4",flacPcmMd5:null,reliable:true};
      offset+=size;
    }
    return null;
  }
  async function detectOggPayload(file){
    let offset=0,headersSeen=0;
    for(let page=0;page<512&&offset+27<=file.size;page++){
      const fixed=await readFileBytes(file,offset,27);if(bytesToAscii(fixed.slice(0,4))!=="OggS")break;
      const segments=fixed[26],laces=await readFileBytes(file,offset+27,segments);let payloadSize=0;laces.forEach(value=>payloadSize+=value);
      const payloadStart=offset+27+segments,pageEnd=payloadStart+payloadSize;
      const probe=await readFileBytes(file,payloadStart,Math.min(payloadSize,64));const marker=bytesToAscii(probe);
      if(marker.includes("vorbis")||marker.startsWith("OpusHead")||marker.startsWith("OpusTags"))headersSeen++;
      else if(headersSeen>=2)return {start:offset,end:file.size,format:"ogg",flacPcmMd5:null,reliable:true};
      offset=pageEnd;
    }
    return null;
  }
  async function detectWmaPayload(file){
    const limit=Math.min(file.size,4*1024*1024),bytes=await readFileBytes(file,0,limit);
    const guid=[0x36,0x26,0xb2,0x75,0x8e,0x66,0xcf,0x11,0xa6,0xd9,0x00,0xaa,0x00,0x62,0xce,0x6c];
    outer:for(let i=0;i<=bytes.length-guid.length;i++){
      if(i>0&&(i&0x3ffff)===0)await yieldToInputPriority();
      for(let j=0;j<guid.length;j++)if(bytes[i+j]!==guid[j])continue outer;
      return {start:i+50,end:file.size,format:"wma",flacPcmMd5:null,reliable:true};
    }
    return null;
  }
  async function detectAudioPayload(file){
    const name=String(file.name||"").toLowerCase();let bounds=null;
    if(name.endsWith(".flac"))bounds=await detectFlacPayload(file);
    else if(name.endsWith(".mp3"))bounds=await detectMp3Payload(file);
    else if(/\.(m4a|mp4)$/i.test(name))bounds=await detectMp4Payload(file);
    else if(/\.wav$/i.test(name))bounds=await detectWavPayload(file);
    else if(/\.(ogg|opus)$/i.test(name))bounds=await detectOggPayload(file);
    else if(/\.wma$/i.test(name))bounds=await detectWmaPayload(file);
    return bounds||{start:0,end:file.size,format:audioFormatFromName(name).toLowerCase()||"audio",flacPcmMd5:null,reliable:false};
  }
  async function recognizeAudioEssence(file){
    const bounds=await detectAudioPayload(file),sampleSize=Math.min(65536,Math.max(1,bounds.end-bounds.start));
    const payloadLength=Math.max(0,bounds.end-bounds.start),maxStart=Math.max(bounds.start,bounds.end-sampleSize);
    const starts=[bounds.start,Math.max(bounds.start,Math.min(maxStart,Math.floor(bounds.start+(payloadLength-sampleSize)/2))),maxStart];
    const samples=await Promise.all(starts.map(start=>readFileBytes(file,start,sampleSize)));
    const [anchorHead,anchorMiddle,anchorTail]=await Promise.all(samples.map(sha256Hex));
    const technicalSignature=`${bounds.format}:${payloadLength}`;
    const combined=await sha256Hex(`${technicalSignature}:${bounds.flacPcmMd5||"-"}:${anchorHead}:${anchorMiddle}:${anchorTail}`),spectrumId=`gpsid:v1:${combined}`;
    return {schemaVersion:GP_RECOGNITION_SCHEMA_VERSION,spectrumId,audioEssenceKey:spectrumId,anchorHead,anchorMiddle,anchorTail,
      flacPcmMd5:bounds.flacPcmMd5||null,technicalSignature,payloadLength,payloadStart:bounds.start,payloadEnd:bounds.end,
      format:bounds.format,reliable:bounds.reliable,matchPolicy:"exact-or-flac-md5-or-middle-plus-one",matchedBy:null,identityConfidence:bounds.reliable?"verified-new":"unreliable"};
  }
  GP.core.recognition=Object.freeze({schemaVersion:GP_RECOGNITION_SCHEMA_VERSION,recognizeAudioEssence,detectAudioPayload});
  function fileCacheIdentity(file){
    return `${file.size}:${file.lastModified||0}:${file.type||""}:${file.webkitRelativePath||file.name}`;
  }
  async function resolveTrackCacheByRecognition(recognition){
    if(!recognition?.spectrumId&&!recognition?.audioEssenceKey)return null;
    const spectrumId=recognition.spectrumId||recognition.audioEssenceKey;
    let record=await GPDatabase.getTrackCache(spectrumId).catch(()=>null);
    if(!record)record=await GPDatabase.getTrackCacheBySpectrumId(spectrumId).catch(()=>null);
    if(!record)record=await GPDatabase.getTrackCacheByEssenceKey(recognition.audioEssenceKey).catch(()=>null);
    if(record)return {record,matchedBy:"spectrumId:exact",identityConfidence:"verified"};
    if(recognition.flacPcmMd5){
      record=await GPDatabase.getTrackCacheByRecognitionIndex("flacPcmMd5",recognition.flacPcmMd5).catch(()=>null);
      if(record)return {record,matchedBy:"flacPcmMd5",identityConfidence:"verified"};
    }
    const matches=await Promise.all([
      GPDatabase.getTrackCacheByRecognitionIndex("anchorHead",recognition.anchorHead).catch(()=>null),
      GPDatabase.getTrackCacheByRecognitionIndex("anchorMiddle",recognition.anchorMiddle).catch(()=>null),
      GPDatabase.getTrackCacheByRecognitionIndex("anchorTail",recognition.anchorTail).catch(()=>null)
    ]);
    const candidates=Array.from(new Map(matches.filter(Boolean).map(candidate=>[candidate.spectrumId||candidate.audioEssenceKey||candidate.contentKey,candidate])).values());
    for(const candidate of candidates){
      const saved=candidate.recognition||{},sameStructure=saved.technicalSignature===recognition.technicalSignature&&Number(saved.payloadLength)===Number(recognition.payloadLength);
      const middle=saved.anchorMiddle===recognition.anchorMiddle,head=saved.anchorHead===recognition.anchorHead,tail=saved.anchorTail===recognition.anchorTail;
      if(sameStructure&&middle&&(head||tail))return {record:candidate,matchedBy:`anchors:middle+${head?"head":"tail"}`,identityConfidence:"conservative-recovery"};
    }
    return null;
  }
  async function migrateLegacyRecognitionCache(legacyRecord,recognition,stats){
    if(!legacyRecord||!recognition?.audioEssenceKey)return legacyRecord;
    const oldKey=legacyRecord.contentKey,newKey=recognition.spectrumId||recognition.audioEssenceKey;
    const legacyKeys=Array.from(new Set([...(legacyRecord.legacyContentKeys||[]),oldKey].filter(key=>key&&key!==newKey)));
    const migrated=Object.assign({},legacyRecord,{contentKey:newKey,spectrumId:newKey,audioEssenceKey:newKey,recognition:Object.assign({},recognition,{matchedBy:"legacy-fileIdentity",identityConfidence:"migration-verified"}),
      legacyContentKeys:legacyKeys,cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,recognitionMigratedAt:Date.now(),updatedAt:Date.now()});
    await GPDatabase.saveTrackCache(migrated);
    if(oldKey&&oldKey!==newKey){
      const oldFeatures=await GPDatabase.getTrackFeatures(oldKey).catch(()=>null);
      if(oldFeatures){await GPDatabase.saveTrackFeatures(Object.assign({},oldFeatures,{contentKey:newKey,spectrumId:newKey,audioEssenceKey:newKey,recognitionSchemaVersion:GP_RECOGNITION_SCHEMA_VERSION,migratedFromContentKey:oldKey}));}
    }
    if(stats)stats.identityMigrations=(stats.identityMigrations||0)+1;
    return migrated;
  }
  async function stampRecognitionCache(record,recognition,matchedBy){
    if(!record||!recognition)return record;
    const key=recognition.spectrumId||recognition.audioEssenceKey,legacyKeys=Array.from(new Set([...(record.legacyContentKeys||[]),record.contentKey].filter(value=>value&&value!==key)));
    const stamped=Object.assign({},record,{contentKey:key,spectrumId:key,audioEssenceKey:key,recognition:Object.assign({},recognition,{matchedBy:matchedBy||recognition.matchedBy||"spectrumId",identityConfidence:recognition.identityConfidence||record.recognition?.identityConfidence||null}),
      legacyContentKeys:legacyKeys,cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,updatedAt:Date.now()});
    await GPDatabase.saveTrackCache(stamped);
    if(record.contentKey&&record.contentKey!==key){
      const oldFeatures=await GPDatabase.getTrackFeatures(record.contentKey).catch(()=>null);
      if(oldFeatures)await GPDatabase.saveTrackFeatures(Object.assign({},oldFeatures,{contentKey:key,spectrumId:key,audioEssenceKey:key,recognitionSchemaVersion:GP_RECOGNITION_SCHEMA_VERSION,migratedFromContentKey:record.contentKey}));
    }
    return stamped;
  }
  function recognitionCacheIsCurrent(record,recognition){
    const saved=record?.recognition;if(!saved||!recognition)return false;
    return (record.spectrumId||record.audioEssenceKey||record.contentKey)===(recognition.spectrumId||recognition.audioEssenceKey)
      &&saved.anchorHead===recognition.anchorHead&&saved.anchorMiddle===recognition.anchorMiddle&&saved.anchorTail===recognition.anchorTail
      &&saved.flacPcmMd5===recognition.flacPcmMd5&&saved.technicalSignature===recognition.technicalSignature
      &&Number(saved.payloadLength)===Number(recognition.payloadLength);
  }
  async function mapWithConcurrency(items,limit,worker){
    const results=new Array(items.length);let cursor=0;
    const runners=Array.from({length:Math.min(Math.max(1,limit),items.length)},async()=>{
      while(true){
        const index=cursor++;if(index>=items.length)return;
        results[index]=await worker(items[index],index);
        // 7.3.2: yield only when input is actually pending; unconditional
        // per-item yields added hundreds of idle waits on large imports.
        if(navigator.scheduling?.isInputPending?.())await yieldToInputPriority();
        else if(index%16===15)await yieldToInputPriority();
      }
    });
    await Promise.all(runners);return results;
  }
  function probeTrackDuration(url){
    return new Promise(resolve=>{
      const probe=new Audio();let settled=false;
      const finish=value=>{
        if(settled)return;settled=true;clearTimeout(timer);
        const duration=Number.isFinite(value)?value:0;
        probe.pause();probe.removeAttribute("src");probe.load();resolve(duration);
      };
      const timer=setTimeout(()=>finish(0),10000);
      probe.preload="metadata";
      probe.addEventListener("loadedmetadata",()=>finish(probe.duration),{once:true});
      probe.addEventListener("error",()=>finish(0),{once:true});
      probe.src=url;
    });
  }
  async function coverURLToBlob(url){
    if(!url)return null;
    try{return await (await fetch(url)).blob();}
    catch(error){return null;}
    finally{URL.revokeObjectURL(url);}
  }
  async function createCoverThumbnailBlob(sourceBlob,size=192){
    if(!sourceBlob)return null;
    try{
      const bitmap=await createImageBitmap(sourceBlob);
      const side=Math.min(bitmap.width,bitmap.height);
      const sx=Math.floor((bitmap.width-side)/2),sy=Math.floor((bitmap.height-side)/2);
      const canvas=document.createElement("canvas");canvas.width=size;canvas.height=size;
      const context=canvas.getContext("2d",{alpha:false});
      context.drawImage(bitmap,sx,sy,side,side,0,0,size,size);bitmap.close?.();
      return await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",.86));
    }catch(error){return null;}
  }
  function preloadArtworkUrl(url){
    if(!url)return Promise.resolve();
    return new Promise(resolve=>{
      const image=new Image(),done=()=>resolve();
      image.onload=done;image.onerror=done;image.src=url;
      if(image.decode)image.decode().then(done).catch(()=>{});
    });
  }
  async function preloadTrackArtwork(track){
    const urls=Array.from(new Set([track?.coverUrl,track?.thumbUrl].filter(Boolean)));
    await Promise.all(urls.map(preloadArtworkUrl));
  }
  function audioFormatFromName(name){return String(name||"").split(".").pop()?.toUpperCase()||"";}
  function estimateTrackBitrate(fileSize,duration){return Number(fileSize)>0&&Number(duration)>0?Math.round(Number(fileSize)*8/1000/Number(duration)):null;}
  function applyPersistentTrackSnapshot(track,record){
    if(!track||!record)return track;
    const technical=record.technical||{},analysis=record.analysis||{};
    track.audioEssenceKey=record.audioEssenceKey||track.audioEssenceKey||track.contentKey;
    track.spectrumId=record.spectrumId||track.spectrumId||track.audioEssenceKey||track.contentKey;
    track.recognition=record.recognition||track.recognition||null;
    track.identityLinks=record.identityLinks||track.identityLinks||{spectrumId:track.spectrumId,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreIds:[]};
    track.metadataVersions=record.metadataVersions||track.metadataVersions||null;
    track.legacyContentKeys=Array.isArray(record.legacyContentKeys)?record.legacyContentKeys.slice():[];
    track.format=technical.format||audioFormatFromName(track.name);
    track.fileSize=Number.isFinite(technical.fileSize)?technical.fileSize:(track.file?.size||0);
    track.mimeType=technical.mimeType||track.file?.type||"";
    track.fileLastModified=Number.isFinite(technical.lastModified)?technical.lastModified:(track.file?.lastModified||0);
    track.relativePath=technical.relativePath||track.file?.webkitRelativePath||"";
    track.bitrateKbps=Number.isFinite(technical.bitrateKbps)?technical.bitrateKbps:estimateTrackBitrate(track.fileSize,track.duration);
    track.sampleRate=Number.isFinite(technical.sampleRate)?technical.sampleRate:track.sampleRate;
    track.channels=Number.isFinite(technical.channels)?technical.channels:track.channels;
    if(analysis&&Object.keys(analysis).length)applySpectrumRecordToTrack(track,analysis);
    return track;
  }
  function createPersistentTrackSnapshot(track,existing){
    const previous=existing||{},file=track.file||{},duration=Number(track.duration)||0;
    const sampleRate=Number.isFinite(track.sampleRate)?track.sampleRate:null;
    const channels=Number.isFinite(track.channels)?track.channels:null;
    const energy=Number.isFinite(track.energy)?track.energy:null;
    const energyDb=Number.isFinite(track.energyDb)?track.energyDb:null;
    const bpm=Number.isFinite(track.bpm)?track.bpm:null;
    const bpmConfidence=Number.isFinite(track.bpmConfidence)?track.bpmConfidence:null;
    return Object.assign({},previous,{
      contentKey:track.contentKey,cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,
      spectrumId:track.spectrumId||track.audioEssenceKey||track.contentKey,audioEssenceKey:track.audioEssenceKey||track.spectrumId||track.contentKey,
      recognition:track.recognition||previous.recognition||null,
      identityLinks:Object.assign({spectrumId:track.spectrumId||track.audioEssenceKey||track.contentKey,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreIds:[]},previous.identityLinks||{},track.identityLinks||{},
        {artistAliases:Array.from(new Set([...(previous.identityLinks?.artistAliases||[]),...(track.identityLinks?.artistAliases||[]),track.artist].filter(Boolean))),
         titleAliases:Array.from(new Set([...(previous.identityLinks?.titleAliases||[]),...(track.identityLinks?.titleAliases||[]),track.title].filter(Boolean))),
         genreIds:Array.from(new Set([...(previous.identityLinks?.genreIds||[]),...(track.identityLinks?.genreIds||[]),track.genre].filter(Boolean)))}),
      legacyContentKeys:Array.from(new Set([...(previous.legacyContentKeys||[]),...(track.legacyContentKeys||[])].filter(Boolean))),
      fileName:track.name||file.name||previous.fileName||"",fileSize:Number(file.size)||previous.fileSize||0,
      fileLastModified:Number(file.lastModified)||previous.fileLastModified||0,fileType:file.type||previous.fileType||"",
      relativePath:file.webkitRelativePath||previous.relativePath||"",fileIdentity:fileCacheIdentity(file),
      metadata:{name:track.name||file.name||"",title:track.title||"",artist:track.artist||"",album:track.album||null,date:track.date||null,duration,genre:track.genre||null,genreSource:track.genreSource||null},
      technical:{
        format:audioFormatFromName(track.name||file.name),fileSize:Number(file.size)||0,mimeType:file.type||"",
        lastModified:Number(file.lastModified)||0,relativePath:file.webkitRelativePath||"",duration,
        bitrateKbps:estimateTrackBitrate(file.size,duration),sampleRate,channels
      },
      analysis:{energy,energyDb,loudnessDb:Number.isFinite(track.loudnessDb)?track.loudnessDb:null,
        normalizationGainDb:Number.isFinite(track.normalizationGainDb)?track.normalizationGainDb:(Number.isFinite(track.loudnessDb)?Math.max(-7,Math.min(7,-18-track.loudnessDb)):null),normalizationVersion:1,bpm,bpmConfidence,sampleRate,channels,
        peaks:Array.isArray(track.peaks)?track.peaks.slice(0,160):null,mfcc:track.mfcc||null,mfccSummary:track.mfccSummary||null,mood:track.mood||null,
        inferredGenre:track.inferredGenre||null,genreSecondary:track.genreSecondary||null,genreScores:Array.isArray(track.genreScores)?track.genreScores.slice(0,3):null,
        genreConfidence:Number.isFinite(track.genreConfidence)?track.genreConfidence:null,genreSource:track.genreSource||null,
        spectrumVersion:track.spectrumVersion||null,spectrumStatus:track.spectrumStatus||null},
      informationComplete:track.spectrumStatus==="complete"&&track.spectrumVersion===GP_SPECTRUM_ALGORITHM_VERSION&&sampleRate!==null&&channels!==null,
      cachedAt:previous.cachedAt||Date.now(),updatedAt:Date.now()
    });
  }
  async function persistCompleteTrackSnapshot(track){
    if(!track?.contentKey)return;
    const existing=await GPDatabase.getTrackCache(track.contentKey).catch(()=>null);
    await GPDatabase.saveTrackCache(createPersistentTrackSnapshot(track,existing));
  }
  function applySpectrumRecordToTrack(track,record){
    if(!track||!record)return track;
    track.energy=Number.isFinite(record.energy)?record.energy:null;
    track.energyDb=Number.isFinite(record.energyDb)?record.energyDb:null;
    track.loudnessDb=Number.isFinite(record.loudnessDb)?record.loudnessDb:track.energyDb;
    track.normalizationGainDb=Number.isFinite(record.normalizationGainDb)?record.normalizationGainDb:(Number.isFinite(track.loudnessDb)?Math.max(-7,Math.min(7,-18-track.loudnessDb)):null);
    track.bpm=Number.isFinite(record.bpm)?record.bpm:null;
    track.bpmConfidence=Number.isFinite(record.bpmConfidence)?record.bpmConfidence:null;
    track.sampleRate=Number.isFinite(record.sampleRate)?record.sampleRate:track.sampleRate;
    track.channels=Number.isFinite(record.channels)?record.channels:track.channels;
    track.spectrumStatus=record.spectrumStatus||null;
    track.spectrumVersion=record.spectrumVersion||null;
    track.mfcc=record.mfcc&&Array.isArray(record.mfcc.mean)?record.mfcc:null;
    track.mfccSummary=record.mfccSummary||null;
    track.mood=record.mood||null;
    track.inferredGenre=record.inferredGenre||null;
    track.genreSecondary=record.genreSecondary||null;
    track.genreScores=Array.isArray(record.genreScores)?record.genreScores:null;
    track.genreConfidence=Number.isFinite(record.genreConfidence)?record.genreConfidence:null;
    if((!track.genre||track.genreSource==="spectrum-inference")&&record.inferredGenre){track.genre=record.inferredGenre;track.genreSource="spectrum-inference";}
    if(Array.isArray(record.peaks))track.peaks=record.peaks;
    return track;
  }
  async function restoreSpectrumRecord(track,stats,cacheRecord=null){
    try{
      if(cacheRecord)applyPersistentTrackSnapshot(track,cacheRecord);
      if(track.spectrumStatus==="complete"&&track.spectrumVersion===GP_SPECTRUM_ALGORITHM_VERSION&&Number.isFinite(track.sampleRate)&&Number.isFinite(track.channels)){
        if(stats)stats.featureCacheHits++;GP.performance.spectrum.cacheHits++;return track;
      }
      const record=await GPAnalyzer.readCached(track.contentKey);
      if(record){
        applySpectrumRecordToTrack(track,record);
        await persistCompleteTrackSnapshot(track);
        if(stats)stats.featureCacheHits++;
        GP.performance.spectrum.cacheHits++;
      }else{track.spectrumStatus=null;track.spectrumVersion=null;}
    }catch(error){if(stats)stats.storageErrors++;}
    return track;
  }
  const GP_BACKGROUND_IDLE_WINDOW=10000;
  let gpLastUserInteractionAt=performance.now();
  ["pointerdown","pointermove","keydown","wheel","touchstart"].forEach(type=>document.addEventListener(type,()=>{gpLastUserInteractionAt=performance.now();},{passive:true,capture:true}));
  function runAfterInteractionIdle(task,delay=1200,quietWindow=GP_BACKGROUND_IDLE_WINDOW){
    const check=()=>{
      const remaining=quietWindow-(performance.now()-gpLastUserInteractionAt);
      if(remaining>0){setTimeout(check,Math.min(600,Math.max(80,remaining)));return;}
      const run=()=>{if(performance.now()-gpLastUserInteractionAt<quietWindow){check();return;}task();};
      if("requestIdleCallback" in window)window.requestIdleCallback(run,{timeout:4000});else setTimeout(run,32);
    };
    setTimeout(check,delay);
  }
  const yieldSpectrumTask=()=>new Promise(resolve=>{
    const yieldWhenPlaybackAllows=()=>{
      if(importRunning){yieldToInputPriority().then(resolve);return;}
      if(isPlaying||wantsPlayback){setTimeout(yieldWhenPlaybackAllows,700);return;}
      if(performance.now()-gpLastUserInteractionAt<GP_BACKGROUND_IDLE_WINDOW){setTimeout(yieldWhenPlaybackAllows,400);return;}
      if("requestIdleCallback" in window)window.requestIdleCallback(()=>resolve(),{timeout:120});
      else setTimeout(resolve,0);
    };
    yieldWhenPlaybackAllows();
  });
  let spectrumAnalysisQueue=Promise.resolve(),spectrumResumeAfter=0;
  const spectrumQueuedKeys=new Set();
  async function buildSpectrumEnvelope(audioBuffer){
    const envelopeRate=100,sampleRate=audioBuffer.sampleRate,channels=audioBuffer.numberOfChannels;
    const startSeconds=audioBuffer.duration>210?15:0;
    const analysisSeconds=Math.max(0,Math.min(180,audioBuffer.duration-startSeconds));
    const startFrame=Math.floor(startSeconds*sampleRate),endFrame=Math.min(audioBuffer.length,Math.floor((startSeconds+analysisSeconds)*sampleRate));
    const blockFrames=Math.max(1,Math.round(sampleRate/envelopeRate));
    const blockCount=Math.max(0,Math.floor((endFrame-startFrame)/blockFrames));
    const envelope=new Float32Array(blockCount),channelData=Array.from({length:channels},(_,index)=>audioBuffer.getChannelData(index));
    let envelopeSquareSum=0;
    for(let block=0;block<blockCount;block++){
      const from=startFrame+block*blockFrames,to=Math.min(endFrame,from+blockFrames);
      const stride=Math.max(1,Math.floor((to-from)/32));let squareSum=0,count=0;
      for(let frame=from;frame<to;frame+=stride){
        for(let channel=0;channel<channels;channel++){const value=channelData[channel][frame]||0;squareSum+=value*value;count++;}
      }
      const rms=Math.sqrt(squareSum/Math.max(1,count));envelope[block]=rms;envelopeSquareSum+=rms*rms;
      if(block>0&&block%500===0)await yieldSpectrumTask();
    }
    const overallRms=Math.sqrt(envelopeSquareSum/Math.max(1,blockCount));
    const energyDb=20*Math.log10(Math.max(overallRms,1e-7));
    const energy=Math.round(Math.max(0,Math.min(100,(energyDb+42)/34*100)));
    const peaks=Array.from({length:160},(_,index)=>{
      const from=Math.floor(index*envelope.length/160),to=Math.max(from+1,Math.floor((index+1)*envelope.length/160));let peak=0;
      for(let i=from;i<to&&i<envelope.length;i++)if(envelope[i]>peak)peak=envelope[i];
      return peak;
    });
    return {envelope,envelopeRate,energy,energyDb,peaks};
  }
  async function detectBpmFromEnvelope(envelope,envelopeRate=100){
    if(!envelope||envelope.length<envelopeRate*8)return {bpm:null,confidence:0};
    const flux=new Float32Array(envelope.length-1);let fluxMean=0;
    for(let i=1;i<envelope.length;i++){const value=Math.max(0,envelope[i]-envelope[i-1]);flux[i-1]=value;fluxMean+=value;}
    fluxMean/=Math.max(1,flux.length);
    const onset=new Float32Array(flux.length);let onsetMean=0,onsetPower=0;
    for(let i=0;i<flux.length;i++){const value=Math.max(0,flux[i]-fluxMean*.85);onset[i]=value;onsetMean+=value;}
    onsetMean/=Math.max(1,onset.length);
    for(let i=0;i<onset.length;i++){onset[i]-=onsetMean;onsetPower+=onset[i]*onset[i];}
    if(onsetPower<1e-8)return {bpm:null,confidence:0};
    const correlationCache=new Map();
    const correlation=lag=>{
      lag=Math.max(1,Math.round(lag));if(correlationCache.has(lag))return correlationCache.get(lag);
      let sum=0,left=0,right=0;
      for(let i=lag;i<onset.length;i++){const a=onset[i],b=onset[i-lag];sum+=a*b;left+=a*a;right+=b*b;}
      const value=sum/Math.sqrt(Math.max(1e-12,left*right));correlationCache.set(lag,value);return value;
    };
    let bestBpm=null,bestScore=-Infinity,runnerUp=-Infinity;
    for(let bpm=60;bpm<=200;bpm++){
      const lag=envelopeRate*60/bpm;
      const score=(correlation(lag)+.34*correlation(lag*2)+.12*correlation(lag/2))*(1-Math.min(.1,Math.abs(bpm-120)*.00065));
      if(score>bestScore){runnerUp=bestScore;bestScore=score;bestBpm=bpm;}else if(score>runnerUp&&Math.abs(bpm-bestBpm)>3)runnerUp=score;
      if(bpm%16===0)await yieldSpectrumTask();
    }
    if(!Number.isFinite(bestScore)||bestScore<.035)return {bpm:null,confidence:0};
    if(bestBpm<=100){
      const baseCorrelation=correlation(envelopeRate*60/bestBpm);
      let correctedBpm=bestBpm;
      for(const factor of [2,3]){
        const candidate=bestBpm*factor;
        if(candidate>200)continue;
        const candidateCorrelation=correlation(envelopeRate*60/candidate);
        const harmonicFloor=factor===3?.55:.9;
        if(candidateCorrelation>=Math.max(.08,baseCorrelation*harmonicFloor))correctedBpm=candidate;
      }
      bestBpm=correctedBpm;
    }
    const separation=Math.max(0,bestScore-Math.max(0,runnerUp));
    const confidence=Math.round(Math.max(1,Math.min(100,(bestScore*.72+separation*.9)*100)));
    return {bpm:bestBpm,confidence};
  }
  function fftPowerSpectrum(frame){
    const size=frame.length,real=new Float64Array(size),imag=new Float64Array(size);
    for(let i=0;i<size;i++)real[i]=frame[i];
    for(let i=1,j=0;i<size;i++){
      let bit=size>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;
      if(i<j){const swap=real[i];real[i]=real[j];real[j]=swap;}
    }
    for(let length=2;length<=size;length<<=1){
      const angle=-2*Math.PI/length,wrStep=Math.cos(angle),wiStep=Math.sin(angle);
      for(let start=0;start<size;start+=length){
        let wr=1,wi=0;const half=length>>1;
        for(let offset=0;offset<half;offset++){
          const even=start+offset,odd=even+half;
          const oddReal=real[odd]*wr-imag[odd]*wi,oddImag=real[odd]*wi+imag[odd]*wr;
          real[odd]=real[even]-oddReal;imag[odd]=imag[even]-oddImag;real[even]+=oddReal;imag[even]+=oddImag;
          const nextWr=wr*wrStep-wi*wiStep;wi=wr*wiStep+wi*wrStep;wr=nextWr;
        }
      }
    }
    const power=new Float64Array(size/2+1),normalizer=1/(size*size);
    for(let i=0;i<power.length;i++)power[i]=(real[i]*real[i]+imag[i]*imag[i])*normalizer;
    return power;
  }
  function hzToMel(hz){return 2595*Math.log10(1+hz/700);}
  function melToHz(mel){return 700*(Math.pow(10,mel/2595)-1);}
  function createMelFilterBins(sampleRate,fftSize,nMels){
    const minMel=hzToMel(20),maxMel=hzToMel(Math.min(8000,sampleRate*.49)),maxBin=fftSize>>1,bins=[];
    for(let i=0;i<nMels+2;i++){
      const hz=melToHz(minMel+(maxMel-minMel)*i/(nMels+1));
      bins.push(Math.max(0,Math.min(maxBin,Math.floor((fftSize+1)*hz/sampleRate))));
    }
    return bins;
  }
  function mfccFromPower(power,melBins,nMfcc){
    const nMels=melBins.length-2,logMel=new Float64Array(nMels);
    for(let band=0;band<nMels;band++){
      const left=melBins[band],center=Math.max(left+1,melBins[band+1]),right=Math.max(center+1,melBins[band+2]);let energy=0;
      for(let bin=left;bin<center&&bin<power.length;bin++)energy+=power[bin]*(bin-left)/(center-left);
      for(let bin=center;bin<right&&bin<power.length;bin++)energy+=power[bin]*(right-bin)/(right-center);
      logMel[band]=Math.log(Math.max(1e-12,energy));
    }
    const coefficients=new Float64Array(nMfcc);
    for(let coefficient=0;coefficient<nMfcc;coefficient++){
      let sum=0;for(let band=0;band<nMels;band++)sum+=logMel[band]*Math.cos(Math.PI*coefficient*(band+.5)/nMels);
      coefficients[coefficient]=sum*Math.sqrt((coefficient===0?1:2)/nMels);
    }
    return coefficients;
  }
  async function extractMfccFeatures(audioBuffer){
    const targetRate=Math.min(22050,audioBuffer.sampleRate),frameSize=1024,nMels=40,nMfcc=13,maxFrames=120;
    const ratio=audioBuffer.sampleRate/targetRate,sourceFrameLength=Math.max(frameSize,Math.ceil(frameSize*ratio));
    const available=Math.max(0,audioBuffer.length-sourceFrameLength-2),frameCount=Math.max(1,Math.min(maxFrames,Math.floor(audioBuffer.duration*2)||1));
    const channels=Array.from({length:audioBuffer.numberOfChannels},(_,index)=>audioBuffer.getChannelData(index));
    const melBins=createMelFilterBins(targetRate,frameSize,nMels),vectors=[],frameRms=[];
    let centroidTotal=0,flatnessTotal=0,rolloffTotal=0,bandwidthTotal=0,zcrTotal=0,bassTotal=0,midTotal=0,highTotal=0,fluxTotal=0,crestTotal=0,mfccDeltaTotal=0;
    let previousNormalizedPower=null,previousVector=null;
    for(let frameIndex=0;frameIndex<frameCount;frameIndex++){
      const start=Math.floor(available*(frameIndex+.5)/frameCount),frame=new Float64Array(frameSize);let rmsSquare=0,peak=0,zcr=0,previousRaw=0;
      for(let sample=0;sample<frameSize;sample++){
        const sourcePosition=start+sample*ratio,left=Math.floor(sourcePosition),mix=sourcePosition-left;let raw=0;
        for(const channel of channels)raw+=(channel[left]||0)*(1-mix)+(channel[left+1]||0)*mix;
        raw/=Math.max(1,channels.length);if(sample&&((raw>=0)!==(previousRaw>=0)))zcr++;previousRaw=raw;peak=Math.max(peak,Math.abs(raw));rmsSquare+=raw*raw;
        frame[sample]=raw*(.5-.5*Math.cos(2*Math.PI*sample/(frameSize-1)));
      }
      const rms=Math.sqrt(rmsSquare/frameSize);if(rms<1e-5)continue;frameRms.push(rms);zcrTotal+=zcr/(frameSize-1);crestTotal+=peak/Math.max(1e-8,rms);
      const power=fftPowerSpectrum(frame),vector=mfccFromPower(power,melBins,nMfcc);vectors.push(vector);
      let weighted=0,total=0,logTotal=0,positive=0,bass=0,mid=0,high=0;
      for(let bin=1;bin<power.length;bin++){
        const value=Math.max(1e-16,power[bin]),hz=bin*targetRate/frameSize;weighted+=bin*value;total+=value;logTotal+=Math.log(value);positive++;
        if(hz<250)bass+=value;else if(hz<4000)mid+=value;else high+=value;
      }
      const centroidBin=total>0?weighted/total:0;let spread=0,cumulative=0,rolloffBin=0;
      for(let bin=1;bin<power.length;bin++){spread+=(bin-centroidBin)*(bin-centroidBin)*power[bin];cumulative+=power[bin];if(!rolloffBin&&cumulative>=total*.85)rolloffBin=bin;}
      centroidTotal+=centroidBin/(power.length-1);bandwidthTotal+=Math.sqrt(spread/Math.max(1e-16,total))/(power.length-1);rolloffTotal+=rolloffBin/(power.length-1);
      flatnessTotal+=total>0?Math.exp(logTotal/Math.max(1,positive))/(total/Math.max(1,positive)):0;
      bassTotal+=bass/Math.max(1e-16,total);midTotal+=mid/Math.max(1e-16,total);highTotal+=high/Math.max(1e-16,total);
      const normalizedPower=Float64Array.from(power,value=>value/Math.max(1e-16,total));
      if(previousNormalizedPower){let flux=0;for(let bin=1;bin<normalizedPower.length;bin++)flux+=Math.max(0,normalizedPower[bin]-previousNormalizedPower[bin]);fluxTotal+=flux;}
      if(previousVector){let delta=0;for(let i=1;i<vector.length;i++)delta+=Math.abs(vector[i]-previousVector[i]);mfccDeltaTotal+=delta/(vector.length-1);}
      previousNormalizedPower=normalizedPower;previousVector=vector;
      if(frameIndex%5===4)await yieldSpectrumTask();
    }
    if(!vectors.length)return null;
    const mean=new Array(nMfcc).fill(0),stdev=new Array(nMfcc).fill(0),count=vectors.length;
    vectors.forEach(vector=>vector.forEach((value,index)=>mean[index]+=value/count));
    vectors.forEach(vector=>vector.forEach((value,index)=>stdev[index]+=(value-mean[index])*(value-mean[index])/count));
    for(let i=0;i<nMfcc;i++){mean[i]=Math.round(mean[i]*10000)/10000;stdev[i]=Math.round(Math.sqrt(stdev[i])*10000)/10000;}
    const rmsMean=frameRms.reduce((sum,value)=>sum+value,0)/frameRms.length;
    const rmsVariance=frameRms.reduce((sum,value)=>sum+(value-rmsMean)*(value-rmsMean),0)/frameRms.length;
    const round=value=>Math.round(value*10000)/10000,transitions=Math.max(1,count-1);
    return {mean,stdev,frames:count,sampleRate:targetRate,frameSize,nMels,nMfcc,
      spectralCentroid:round(centroidTotal/count),spectralFlatness:round(flatnessTotal/count),spectralRolloff:round(rolloffTotal/count),
      spectralBandwidth:round(bandwidthTotal/count),zeroCrossingRate:round(zcrTotal/count),bassRatio:round(bassTotal/count),midRatio:round(midTotal/count),
      highRatio:round(highTotal/count),spectralFlux:round(fluxTotal/transitions),crestFactor:round(crestTotal/count),
      dynamicRangeDb:round(20*Math.log10(1+Math.sqrt(rmsVariance)/Math.max(1e-8,rmsMean))),mfccDelta:round(mfccDeltaTotal/transitions)};
  }
  const SPECTRUM_TEXT_GENRES=[
    {genre:"Rock",keywords:["beyond","光辉岁月","海阔天空","真的爱你","黄家驹","五月天","崔健","汪峰","黑豹乐队","郑钧","伍佰","queen","the beatles","rolling stones","guns n roses","oasis","coldplay","radiohead","bon jovi","pink floyd","led zeppelin","ac/dc","foo fighters","nirvana","linkin park","摇滚"]},
    {genre:"Metal",keywords:["metallica","iron maiden","black sabbath","slipknot","megadeth","metal","金属"]},
    {genre:"Classical",keywords:["mozart","bach","beethoven","chopin","vivaldi","tchaikovsky","symphony","concerto","sonata","交响","协奏曲","古典"]},
    {genre:"Jazz",keywords:["jazz","miles davis","john coltrane","ella fitzgerald","louis armstrong","爵士"]},
    {genre:"Electronic",keywords:["edm","techno","house","trance","dubstep","avicii","skrillex","alan walker","daft punk","电子","电音"]},
    {genre:"Hip-Hop",keywords:["hip hop","hip-hop","rap","eminem","kendrick lamar","drake","jay-z","说唱","嘻哈"]},
    {genre:"R&B/Soul",keywords:["r&b","rnb","soul","the weeknd","beyonce","alicia keys","灵魂乐"]},
    {genre:"Folk/Country",keywords:["folk","country","bluegrass","johnny cash","民谣","乡村"]},
    {genre:"Ambient",keywords:["ambient","chillout","lofi","lo-fi","brian eno","氛围","白噪音"]},
    {genre:"Soundtrack",keywords:["soundtrack","ost","film score","hans zimmer","久石让","原声","配乐"]},
    {genre:"Reggae",keywords:["reggae","bob marley","雷鬼"]},
    {genre:"Blues",keywords:["blues","b.b. king","muddy waters","蓝调"]},
    {genre:"Pop",keywords:["taylor swift","ariana grande","adele","bruno mars","ed sheeran","harry styles","陈奕迅","邓紫棋","周杰伦","林俊杰","张学友","王菲","流行"]}
  ];
  function triangular(value,center,width){return Math.max(0,1-Math.abs(value-center)/width);}
  function inferSpectrumProfile(track,features){
    const searchable=`${track.artist||""} ${track.title||""} ${track.name||""}`.normalize("NFKC").toLocaleLowerCase();
    const textMatch=SPECTRUM_TEXT_GENRES.find(rule=>rule.keywords.some(keyword=>searchable.includes(keyword)));
    const mfcc=features.mfcc||{},clamp=value=>Math.max(0,Math.min(1,value));
    const hasAcousticEvidence=Array.isArray(mfcc.mean)&&mfcc.mean.length>=13&&Number(mfcc.frames)>0&&Number.isFinite(Number(features.energy))&&Number.isFinite(Number(features.bpm));
    const centroid=Number(mfcc.spectralCentroid)||0,flatness=clamp((Number(mfcc.spectralFlatness)||0)/.22),rolloff=Number(mfcc.spectralRolloff)||0;
    const bandwidth=Number(mfcc.spectralBandwidth)||0,zcr=clamp((Number(mfcc.zeroCrossingRate)||0)/.22),bass=Number(mfcc.bassRatio)||0,mid=Number(mfcc.midRatio)||0,high=Number(mfcc.highRatio)||0;
    const flux=clamp((Number(mfcc.spectralFlux)||0)/.75),dynamic=clamp((Number(mfcc.dynamicRangeDb)||0)/8),mfccDelta=clamp((Number(mfcc.mfccDelta)||0)/10);
    const energy=clamp((Number(features.energy)||0)/100),bpm=Number(features.bpm)||0,rhythm=clamp((Number(features.bpmConfidence)||0)/100),loudness=clamp(((Number(features.loudnessDb??features.energyDb)||-42)+42)/34);
    const scores={Pop:0,Rock:0,Metal:0,Electronic:0,"Hip-Hop":0,"R&B/Soul":0,Jazz:0,Classical:0,Ambient:0,"Folk/Country":0,Soundtrack:0,Reggae:0,Blues:0,Mixed:.35};
    const add=(genre,value)=>{scores[genre]=(scores[genre]||0)+Math.max(0,value);};
    add("Rock",1.3*energy+.8*loudness+.75*mid+.65*flux+.45*zcr+.55*triangular(bpm,125,65));
    add("Metal",1.0*energy+.65*loudness+1.35*high+1.15*zcr+1.0*flatness+.45*triangular(bpm,145,70));
    add("Electronic",1.25*energy+1.05*rhythm+.85*triangular(bpm,128,32)+.55*bass+.5*high+.45*(1-dynamic));
    add("Hip-Hop",.9*energy+1.15*bass+.9*triangular(bpm,90,30)+.7*flux+.35*(1-centroid));
    add("R&B/Soul",.75*energy+1.0*bass+.9*triangular(bpm,92,28)+.6*(1-flatness)+.45*(1-high));
    add("Jazz",.65*(1-Math.abs(energy-.48))+.9*dynamic+.75*(1-flatness)+.6*mfccDelta+.45*triangular(bpm,112,55));
    add("Classical",1.5*dynamic+1.1*(1-flatness)+.8*(1-rhythm)+.7*bandwidth+.55*(1-loudness));
    add("Ambient",1.4*(1-energy)+1.05*(1-rhythm)+.9*(1-flux)+.7*(1-zcr)+.5*(1-rolloff)+.8*(1-dynamic));
    add("Folk/Country",.8*triangular(bpm,105,45)+.75*(1-flatness)+.65*mid+.45*dynamic+.35*(1-high));
    add("Soundtrack",.95*dynamic+.8*(1-rhythm)+.65*bandwidth+.5*(1-flatness)+.4*(1-Math.abs(energy-.5)));
    add("Reggae",1.05*bass+1.0*triangular(bpm,88,24)+.6*rhythm+.45*(1-high));
    add("Blues",.85*mid+.75*triangular(bpm,100,45)+.7*dynamic+.55*(1-flatness));
    add("Pop",.75*triangular(bpm,116,38)+.65*(1-Math.abs(energy-.62))+.55*rhythm+.5*(1-Math.abs(centroid-.24)/.24)+.35*(1-flatness));
    if(textMatch)add(textMatch.genre,5.5);
    const ranked=Object.entries(scores).sort((a,b)=>b[1]-a[1]),top=ranked[0],second=ranked[1],margin=top[1]-second[1];
    const genre=!hasAcousticEvidence||top[1]<1.15?"Mixed":top[0],secondary=genre!=="Mixed"&&margin<.42&&second[0]!=="Mixed"?second[0]:null;
    const confidence=Math.round(Math.min(.96,.38+margin/Math.max(1,top[1])*.36+(textMatch?.genre===genre?.25:0))*100)/100;
    const tone=centroid>=.31?"bright":centroid<=.14?"deep":"warm";
    let motion="balanced";
    if(genre==="Rock"||genre==="Metal"||(genre==="Electronic"&&energy>.55))motion=energy>.38?"driving":"dynamic";
    else if(energy>.74&&flux>.35)motion="intense";
    else if(bass>.42&&flux>.25)motion="punchy";
    else if(dynamic>.48||mfccDelta>.45)motion="dynamic";
    else if(energy<.28&&flux<.25)motion="calm";
    else if(flatness<.2&&high<.16)motion="smooth";
    return {mfccSummary:{tone,motion},mood:motion,inferredGenre:genre,genreSecondary:secondary,
      genreScores:ranked.slice(0,3).map(([name,score])=>({name,score:Math.round(score*100)/100})),genreConfidence:confidence,genreSource:"spectrum-inference"};
  }
  async function analyzeTrackSpectrum(track){
    if(!track?.file)throw new Error("Local audio file is required");
    const arrayBuffer=await track.file.arrayBuffer();
    const audioBuffer=await decodeAudioBuffer(arrayBuffer);
    const analysis=await buildSpectrumEnvelope(audioBuffer);
    const tempo=await detectBpmFromEnvelope(analysis.envelope,analysis.envelopeRate);
    const mfcc=await extractMfccFeatures(audioBuffer);
    const base={energy:analysis.energy,energyDb:analysis.energyDb,loudnessDb:analysis.energyDb,normalizationGainDb:Math.max(-7,Math.min(7,-18-analysis.energyDb)),normalizationVersion:1,bpm:tempo.bpm,bpmConfidence:tempo.confidence,mfcc,
      sampleRate:audioBuffer.sampleRate,channels:audioBuffer.numberOfChannels,peaks:analysis.peaks,spectrumVersion:GP_SPECTRUM_ALGORITHM_VERSION,spectrumStatus:"complete"};
    return Object.assign(base,inferSpectrumProfile(track,base));
  }
  function waitForSpectrumWorkSlot(){
    return new Promise(resolve=>{
      const waitUntilPlaybackIsIdle=()=>{
        if(importRunning){yieldToInputPriority().then(resolve);return;}
        if(isPlaying||wantsPlayback){setTimeout(waitUntilPlaybackIsIdle,700);return;}
        if(performance.now()-gpLastUserInteractionAt<GP_BACKGROUND_IDLE_WINDOW){setTimeout(waitUntilPlaybackIsIdle,500);return;}
        if(performance.now()<spectrumResumeAfter){setTimeout(waitUntilPlaybackIsIdle,Math.min(700,Math.max(80,spectrumResumeAfter-performance.now())));return;}
        const ready=()=>yieldToInputPriority().then(resolve);
        if("requestIdleCallback" in window)window.requestIdleCallback(ready,{timeout:400});
        else setTimeout(ready,32);
      };
      waitUntilPlaybackIsIdle();
    });
  }
  function queueSpectrumAnalysis(tracks,options={}){
    const foreground=options.foreground===true,onProgress=typeof options.onProgress==="function"?options.onProgress:null;
    const eligible=tracks.filter(track=>track?.contentKey&&track.spectrumStatus!=="complete"&&!spectrumQueuedKeys.has(track.contentKey));
    let completed=0;
    eligible.forEach(track=>{
      spectrumQueuedKeys.add(track.contentKey);track.spectrumStatus="queued";GP.performance.spectrum.queued++;
      spectrumAnalysisQueue=spectrumAnalysisQueue.then(async()=>{
        if(!foreground)await waitForSpectrumWorkSlot();else await yieldImportFrame();
        track.spectrumStatus="analyzing";if(playlist[currentIndex]===track)updateTrackInfoCard(track);
        try{
          const result=await GPAnalyzer.analyze(track);
          applySpectrumRecordToTrack(track,result);
          if(playlist[currentIndex]===track&&audioCtx)applyCurrentTrackNormalization();
          await GPAnalyzer.saveSpectrum(track,result);
          await persistCompleteTrackSnapshot(track);
          GP.performance.spectrum.completed++;
        }catch(error){track.spectrumStatus="failed";GP.performance.spectrum.failed++;}
        finally{
          spectrumQueuedKeys.delete(track.contentKey);completed++;if(onProgress)onProgress(completed,eligible.length,track);
          if(playlist[currentIndex]===track)updateTrackInfoCard(track);
        }
      });
    });
    const completedBatch=spectrumAnalysisQueue;
    if(!foreground)completedBatch.then(()=>{if(completedBatch===spectrumAnalysisQueue)scheduleDailyMixRefresh(40);});
    return completedBatch;
  }
  function trackFromCache(file,contentKey,url,record,recognition=null){
    const parsed=parseName(file.name),metadata=record?.metadata||{};
    const cachedArtist=cleanMetadataText(metadata.artist),cachedTitle=cleanMetadataText(metadata.title);
    const cachedAlbum=cleanMetadataText(metadata.album),cachedDate=cleanMetadataText(metadata.date),cachedGenre=cleanMetadataText(metadata.genre);
    const coverBlob=record?.coverBlob instanceof Blob?record.coverBlob:null;
    const thumbBlob=record?.thumbBlob instanceof Blob?record.thumbBlob:null;
    return {
      id:idCounter++,name:file.name,artist:cachedArtist||parsed.artist,title:cachedTitle||parsed.title,album:cachedAlbum||null,date:cachedDate||null,url,
      duration:Number(metadata.duration)||0,file,sourceKey:songIdentity(cachedArtist||parsed.artist,cachedTitle||parsed.title),contentKey,
      spectrumId:recognition?.spectrumId||record?.spectrumId||recognition?.audioEssenceKey||record?.audioEssenceKey||contentKey,
      audioEssenceKey:recognition?.audioEssenceKey||record?.audioEssenceKey||contentKey,recognition:recognition||record?.recognition||null,
      identityLinks:record?.identityLinks||null,
      legacyContentKeys:Array.isArray(record?.legacyContentKeys)?record.legacyContentKeys.slice():[],
      coverUrl:coverBlob?URL.createObjectURL(coverBlob):null,thumbUrl:(thumbBlob||coverBlob)?URL.createObjectURL(thumbBlob||coverBlob):null,
      genre:cachedGenre||null,genreSource:metadata.genreSource||(cachedGenre?"metadata":null),format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",fileLastModified:file.lastModified||0,
      relativePath:file.webkitRelativePath||"",bitrateKbps:estimateTrackBitrate(file.size,metadata.duration),sampleRate:null,channels:null,
      peaks:null,energy:null,energyDb:null,loudnessDb:null,bpm:null,bpmConfidence:null,mfcc:null,mfccSummary:null,mood:null,inferredGenre:null,genreSecondary:null,genreScores:null,genreConfidence:null,spectrumStatus:null,spectrumVersion:null,cacheHit:true
    };
  }
  async function buildAndCacheTrack(file,contentKey,stats,knownCache,recognition){
    const url=URL.createObjectURL(file);
    try{
      let cached=knownCache||null;
      if(!cached){try{cached=await GPDatabase.getTrackCache(contentKey);}catch(error){stats.storageErrors++;}}
      if(cached?.metadata){
        stats.cacheHits++;
        const track=await restoreSpectrumRecord(trackFromCache(file,contentKey,url,cached,recognition),stats,cached);
        const surfaceChanged=cached.fileName!==file.name||Number(cached.fileSize)!==Number(file.size)||Number(cached.fileLastModified)!==Number(file.lastModified||0)||String(cached.relativePath||"")!==String(file.webkitRelativePath||"");
        if(surfaceChanged)await rescanTrackMetadata(track);
        return track;
      }
      stats.cacheMisses++;
      const parsed=parseName(file.name);
      // 7.3.2: duration probe, cover read and metadata parse are independent —
      // run them concurrently instead of serially (rescan already does this).
      const [duration,coverTempUrl,embeddedMetadata]=await Promise.all([
        probeTrackDuration(url),extractEmbeddedCover(file),extractFileMetadata(file)
      ]);
      const coverBlob=await coverURLToBlob(coverTempUrl);
      const title=embeddedMetadata.title||parsed.title,artist=embeddedMetadata.artist||parsed.artist,genre=embeddedMetadata.genre||null;
      const thumbBlob=await createCoverThumbnailBlob(coverBlob);
      const record={
        contentKey,spectrumId:recognition?.spectrumId||contentKey,audioEssenceKey:recognition?.audioEssenceKey||contentKey,recognition:recognition||null,
        identityLinks:{spectrumId:recognition?.spectrumId||contentKey,canonicalArtistId:null,artistAliases:[artist].filter(Boolean),titleAliases:[title].filter(Boolean),genreIds:[genre].filter(Boolean)},legacyContentKeys:[],
        cacheSchemaVersion:GP_TRACK_CACHE_SCHEMA_VERSION,fileName:file.name,fileSize:file.size,
        fileLastModified:file.lastModified||0,fileType:file.type||"",relativePath:file.webkitRelativePath||"",fileIdentity:fileCacheIdentity(file),
        metadata:{name:file.name,title,artist,album:embeddedMetadata.album||null,date:embeddedMetadata.date||null,duration,genre,genreSource:genre?"metadata":null},
        technical:{format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",lastModified:file.lastModified||0,
          relativePath:file.webkitRelativePath||"",duration,bitrateKbps:estimateTrackBitrate(file.size,duration),sampleRate:null,channels:null},
        analysis:{energy:null,energyDb:null,loudnessDb:null,bpm:null,bpmConfidence:null,sampleRate:null,channels:null,peaks:null,mfcc:null,mfccSummary:null,mood:null,inferredGenre:null,genreSecondary:null,genreScores:null,genreConfidence:null,genreSource:null,spectrumVersion:null,spectrumStatus:null},
        informationComplete:false,coverBlob:coverBlob||null,thumbBlob:thumbBlob||null,cachedAt:Date.now(),updatedAt:Date.now()
      };
      try{await GPDatabase.addTrackCache(record);stats.cacheWrites++;}
      catch(error){
        if(error?.name!=="ConstraintError")stats.storageErrors++;
      }
      return restoreSpectrumRecord(trackFromCache(file,contentKey,url,record,recognition),stats,record);
    }catch(error){
      stats.parseErrors++;
      const parsed=parseName(file.name);
      return restoreSpectrumRecord({id:idCounter++,name:file.name,artist:parsed.artist,title:parsed.title,url,duration:0,file,sourceKey:songIdentity(parsed.artist,parsed.title),contentKey,
        spectrumId:recognition?.spectrumId||contentKey,audioEssenceKey:recognition?.audioEssenceKey||contentKey,recognition:recognition||null,
        identityLinks:{spectrumId:recognition?.spectrumId||contentKey,canonicalArtistId:null,artistAliases:[parsed.artist].filter(Boolean),titleAliases:[parsed.title].filter(Boolean),genreIds:[]},legacyContentKeys:[],coverUrl:null,thumbUrl:null,genre:null,genreSource:null,
        format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",fileLastModified:file.lastModified||0,relativePath:file.webkitRelativePath||"",bitrateKbps:null,
        sampleRate:null,channels:null,peaks:null,energy:null,energyDb:null,loudnessDb:null,bpm:null,bpmConfidence:null,mfcc:null,mfccSummary:null,mood:null,inferredGenre:null,
        genreSecondary:null,genreScores:null,genreConfidence:null,spectrumStatus:null,spectrumVersion:null,cacheHit:false},stats);
    }
  }
  let importRunning=false,importCompletionTimer=0,pendingPostImportTracks=[],pendingImportHistorySync=false,importSpinnerAnimation=null;
  function startImportSpinner(){
    const icon=$("#rescanModal .scan-cycle-icon");if(!icon)return;
    importSpinnerAnimation?.cancel();icon.style.willChange="transform";
    importSpinnerAnimation=icon.animate([
      {transform:"translate3d(0,0,0) rotate(0deg)"},
      {transform:"translate3d(0,0,0) rotate(360deg)"}
    ],{duration:1350,iterations:Infinity,easing:"linear"});
  }
  function stopImportSpinner(){
    importSpinnerAnimation?.cancel();importSpinnerAnimation=null;
    const icon=$("#rescanModal .scan-cycle-icon");if(icon){icon.style.removeProperty("will-change");icon.style.removeProperty("transform");}
  }
  function releaseImportBackgroundWork(){
    pendingPostImportTracks.length=0;pendingImportHistorySync=false;
  }
  function openImportProgress(total){
    clearTimeout(importCompletionTimer);
    closeAllMotionPopovers();
    importRunning=true;rescanModalMode="importRunning";
    $("#rescanModal").classList.add("is-scanning");
    $("#rescanModalTitle").textContent=tr("正在导入音乐","Importing Music");
    $("#rescanModalMessage").textContent=tr(`正在准备识别 ${total} 首歌曲…`,`Preparing to identify ${total} songs…`);
    $("#rescanProgress").classList.add("show");$("#rescanProgressFill").style.width="0%";
    $("#rescanCancelBtn").style.display="none";
    $("#rescanConfirmBtn").disabled=true;$("#rescanConfirmBtn").textContent=tr("导入中…","Importing…");
    $("#rescanModal").classList.add("show");
    startImportSpinner();
  }
  let importProgressFrame=0,importProgressState=null;
  function paintImportProgress(){
    importProgressFrame=0;const state=importProgressState;if(!state)return;
    $("#rescanProgressFill").style.width=`${state.safe}%`;
    $("#rescanModalMessage").textContent=state.phase==="identity"
      ?tr(`正在识别歌曲身份 ${state.completed} / ${state.total}…`,`Identifying songs ${state.completed} / ${state.total}…`)
      :tr(`正在恢复或读取歌曲信息 ${state.completed} / ${state.total}…`,`Restoring or reading song data ${state.completed} / ${state.total}…`);
  }
  function updateImportProgress(percent,completed,total,phase){
    importProgressState={safe:Math.max(0,Math.min(100,percent)),completed,total,phase};
    if(!importProgressFrame)importProgressFrame=requestAnimationFrame(paintImportProgress);
  }
  const yieldImportFrame=()=>yieldToInputPriority();
  function updateImportCommitProgress(percent,phase){
    $("#rescanProgressFill").style.width=`${percent}%`;
    $("#rescanModalMessage").textContent=phase==="render"
      ?tr("正在更新歌单与界面…","Updating library and interface…")
      :phase==="analysis"
        ?tr("正在完成音频特征分析…","Completing audio feature analysis…")
        :phase==="neural"
          ?tr("正在更新 Resonance Boost 用户模型…","Updating the Resonance Boost user model…")
          :phase==="recommendation"
            ?tr("正在生成并保存每日推荐…","Generating and saving Daily Mix…")
        :phase==="organize"
          ?tr("正在整理历史、推荐与背景…","Finalizing history, recommendations and background…")
          :tr("正在安全保存导入结果…","Saving imported songs…");
  }
  function finishImportProgress(stats,error=null){
    if(importProgressFrame)cancelAnimationFrame(importProgressFrame);importProgressFrame=0;importProgressState=null;
    importRunning=false;rescanModalMode=error?"importError":"importDone";
    stopImportSpinner();
    $("#rescanModal").classList.remove("is-scanning");
    $("#rescanProgressFill").style.width="100%";
    $("#rescanModalTitle").textContent=error?tr("导入未完成","Import Incomplete"):tr("导入完成","Import Complete");
    $("#rescanModalMessage").textContent=error
      ?tr("导入过程中出现错误；已经成功加入的歌曲会保留。","An error interrupted the import. Songs already added remain available.")
      :tr(`已处理 ${stats?.files||0} 首歌曲，缓存命中 ${stats?.cacheHits||0} 首，新增 ${stats?.cacheMisses||0} 首${stats?.duplicates?`，跳过重复 ${stats.duplicates} 首`:""}。`,`Processed ${stats?.files||0} songs, restored ${stats?.cacheHits||0} from cache, added ${stats?.cacheMisses||0}${stats?.duplicates?`, and skipped ${stats.duplicates} duplicates`:""}.`);
    $("#rescanConfirmBtn").disabled=false;$("#rescanConfirmBtn").textContent=tr("完成","Done");
  }
  async function settleImportProgress(stats,error=null){
    $("#rescanProgressFill").style.width="100%";
    $("#rescanModalMessage").textContent=error
      ?tr("正在保留已完成的导入结果…","Preserving completed import results…")
      :tr("所有初始化已经完成…","All initialization is complete…");
    await yieldToInputPriority();await new Promise(resolve=>{
      // 7.3.2: close on paint commit instead of a fixed 240 ms wait.
      if(!document.hidden&&typeof requestAnimationFrame==="function")requestAnimationFrame(()=>requestAnimationFrame(resolve));
      else resolve();
    });
    finishImportProgress(stats,error);
  }
  const libraryOrderCollator=new Intl.Collator(["zh-CN","en"],{numeric:true,sensitivity:"base"});
  function libraryOrderKey(track){return String(track?.file?.webkitRelativePath||track?.file?.name||track?.name||`${track?.artist||""} - ${track?.title||""}`);}
  function insertImportedTracksInLibrary(tracks){
    const currentId=playlist[currentIndex]?.id||null;
    const overrideIds=overrideQueue?.map(index=>playlist[index]?.id).filter(Boolean)||null;
    playlist.push(...tracks);
    playlist.sort((a,b)=>libraryOrderCollator.compare(libraryOrderKey(a),libraryOrderKey(b))||String(a.id).localeCompare(String(b.id)));
    if(currentId)currentIndex=playlist.findIndex(track=>track.id===currentId);
    if(overrideIds)overrideQueue=overrideIds.map(id=>playlist.findIndex(track=>track.id===id)).filter(index=>index>=0);
    if(overrideQueue&&!overrideQueue.length)overrideQueue=null;
    if(playMode==="shuffle"&&currentIndex>=0){shuffleTimeline=[currentIndex];shuffleTimelineCursor=0;}
  }
  async function addFiles(fileList){
    const all = Array.from(fileList);
    const audioFiles = all.filter(f => f.type.startsWith("audio/") || /\.(mp3|wav|m4a|flac|ogg|aac|wma)$/i.test(f.name));
    if(audioFiles.length === 0) return;
    if(importRunning||metadataRescanRunning)return;
    openImportProgress(audioFiles.length);

    const renderStart=libraryRenderCommits;
    const startedAt=performance.now();
    const stats={files:audioFiles.length,cacheHits:0,cacheMisses:0,cacheWrites:0,featureCacheHits:0,duplicates:0,storageErrors:0,parseErrors:0,
      identityMigrations:0,essenceMatches:0,flacMd5Matches:0,anchorFallbackMatches:0,unreliableIdentities:0,renderCommits:0,durationMs:0};
    playlist.forEach(track=>{reservedSongIdentities.add(songIdentity(track.artist,track.title));if(track.contentKey)reservedAudioFingerprints.add(track.contentKey);});
    const uniqueFiles=[];
    const duplicates=[];
    let identityCompleted=0;
    const candidates=await mapWithConcurrency(audioFiles,5,async file=>{
      const recognition=await recognizeAudioEssence(file);if(!recognition.reliable)stats.unreliableIdentities++;
      let cachedRecord=null,match=null;
      try{match=await resolveTrackCacheByRecognition(recognition);}catch(error){stats.storageErrors++;}
      if(match){
        recognition.identityConfidence=match.identityConfidence||recognition.identityConfidence;
        cachedRecord=recognitionCacheIsCurrent(match.record,recognition)?match.record:await stampRecognitionCache(match.record,recognition,match.matchedBy).catch(()=>match.record);
        if(match.matchedBy==="flacPcmMd5")stats.flacMd5Matches++;
        else if(match.matchedBy.startsWith("anchors:"))stats.anchorFallbackMatches++;
        else stats.essenceMatches++;
      }else{
        let legacyRecord=null;
        try{legacyRecord=await GPDatabase.getTrackCacheByFileIdentity(fileCacheIdentity(file));}catch(error){stats.storageErrors++;}
        if(legacyRecord)cachedRecord=await migrateLegacyRecognitionCache(legacyRecord,recognition,stats).catch(()=>legacyRecord);
      }
      const candidate={file,contentKey:recognition.audioEssenceKey,cachedRecord,recognition};
      identityCompleted++;updateImportProgress(identityCompleted/audioFiles.length*35,identityCompleted,audioFiles.length,"identity");
      return candidate;
    });
    candidates.forEach(({file,contentKey,cachedRecord,recognition})=>{
      const parsed=parseName(file.name);
      const key=songIdentity(parsed.artist,parsed.title);
      if(reservedSongIdentities.has(key)||reservedAudioFingerprints.has(contentKey)){duplicates.push(file);return;}
      reservedSongIdentities.add(key);reservedAudioFingerprints.add(contentKey);uniqueFiles.push({file,contentKey,cachedRecord,recognition});
    });
    if(duplicates.length){
      stats.duplicates=duplicates.length;
      const firstTitle=parseName(duplicates[0].name).title;
      showToast(duplicates.length===1?tr(`「${firstTitle}」已经在歌单中`,`“${firstTitle}” is already in the library`):tr(`${duplicates.length} 首歌曲已经在歌单中，未重复添加`,`${duplicates.length} songs were already in the library and were skipped`));
    }
    if(uniqueFiles.length===0){updateImportCommitProgress(99,"organize");await yieldImportFrame();await settleImportProgress(stats);return;}

    let dataCompleted=0;
    const tracks=await mapWithConcurrency(uniqueFiles,6,async ({file,contentKey,cachedRecord,recognition})=>{
      const track=await buildAndCacheTrack(file,contentKey,stats,cachedRecord,recognition);
      dataCompleted++;updateImportProgress(35+dataCompleted/uniqueFiles.length*55,dataCompleted,uniqueFiles.length,"data");
      return track;
    });
    updateImportCommitProgress(92,"render");await yieldImportFrame();
    await mapWithConcurrency(tracks,4,preloadTrackArtwork);
    updateImportCommitProgress(93,"commit");await yieldImportFrame();
    insertImportedTracksInLibrary(tracks);
    tracks.forEach(track=>{reservedSongIdentities.add(songIdentity(track.artist,track.title));reservedAudioFingerprints.add(track.contentKey);});
    invalidateHistoryTrackIndex();pendingImportHistorySync=true;
    updateImportCommitProgress(97,"render");await yieldImportFrame();
    await renderLibraryIncrementally(searchInputSafe());
    if(currentIndex===-1&&playlist.length>0){
      const startIndex=playMode==="shuffle"?Math.floor(Math.random()*playlist.length):0;
      loadTrack(startIndex,false);
    }
    await renderMiniQueue({instantPosition:true,incremental:true});
    updateImportCommitProgress(98,"organize");await yieldImportFrame();
    syncHistoryMetadataForPlaylist();persistHistoryStoreNow();
    updateImportCommitProgress(99,"neural");await yieldImportFrame();
    await refreshUserModel();
    updateImportCommitProgress(99.5,"recommendation");await yieldImportFrame();
    await finalizeDailyMixForImport();
    await Promise.all([updateAmbient(),applyAdaptiveAccent()]);
    if(playlist[currentIndex])updateTrackInfoCard(playlist[currentIndex]);
    stats.renderCommits=libraryRenderCommits-renderStart;
    stats.durationMs=Math.round(performance.now()-startedAt);
    GP.performance.lastImport=Object.freeze({...stats});
    pendingPostImportTracks.length=0;pendingImportHistorySync=false;
    await settleImportProgress(stats);
    sweepRetiredArtworkUrls();
    // 7.3.2 aggressive: the dialog is already closed here; heavy spectrum
    // decoding continues in the background slot and refreshes Daily Mix when
    // done, so large imports no longer block the modal.
    queueSpectrumAnalysis(tracks,{foreground:false});
  }

  let metadataRescanRunning=false;
  const retiredArtworkUrls=new Set();
  const MAX_RETIRED_ARTWORK_URLS=256;
  const MAX_ARTWORK_SWEEP_RETRIES=12;
  let artworkSweepTimer=0,artworkSweepRetries=0;

  function clearArtworkSweepTimer(){
    if(artworkSweepTimer){clearTimeout(artworkSweepTimer);artworkSweepTimer=0;}
  }

  function isArtworkUrlReferenced(url){
    if(!url||typeof url!=="string")return false;
    if(Array.isArray(playlist)){
      for(let i=0;i<playlist.length;i++){
        const t=playlist[i];
        if(t&&(t.coverUrl===url||t.thumbUrl===url))return true;
      }
    }
    try{
      if(typeof artTransitionCopies!=="undefined"&&Array.isArray(artTransitionCopies)){
        for(let i=0;i<artTransitionCopies.length;i++){
          const node=artTransitionCopies[i];
          if(node&&(node.src===url||node.getAttribute?.("src")===url||node.currentSrc===url))return true;
        }
      }
    }catch(error){}
    if(typeof document!=="undefined"&&document.querySelectorAll){
      try{
        const nodes=document.querySelectorAll("img, image, video");
        for(let i=0;i<nodes.length;i++){
          const node=nodes[i];
          if(node&&(node.src===url||node.getAttribute?.("src")===url||node.currentSrc===url))return true;
        }
      }catch(error){}
    }
    try{
      if(typeof gpVideoPipCoverSource!=="undefined"&&gpVideoPipCoverSource===url)return true;
    }catch(error){}
    return false;
  }

  function enforceRetiredArtworkBounds(forceOldest=false){
    if(!retiredArtworkUrls.size)return;
    for(const url of Array.from(retiredArtworkUrls)){
      if(!isArtworkUrlReferenced(url)){
        retiredArtworkUrls.delete(url);
        try{URL.revokeObjectURL(url);}catch(error){}
      }
    }
    while(retiredArtworkUrls.size>(forceOldest?0:MAX_RETIRED_ARTWORK_URLS)){
      const oldest=retiredArtworkUrls.values().next().value;
      if(!oldest)break;
      retiredArtworkUrls.delete(oldest);
      try{URL.revokeObjectURL(oldest);}catch(error){}
    }
  }

  function sweepRetiredArtworkUrls(){
    clearArtworkSweepTimer();
    if(!retiredArtworkUrls.size){artworkSweepRetries=0;return;}
    for(const url of Array.from(retiredArtworkUrls)){
      if(!isArtworkUrlReferenced(url)){
        retiredArtworkUrls.delete(url);
        try{URL.revokeObjectURL(url);}catch(error){}
      }
    }
    if(retiredArtworkUrls.size>0){
      scheduleArtworkSweep();
    }else{
      artworkSweepRetries=0;
    }
  }

  function scheduleArtworkSweep(){
    if(artworkSweepTimer)return;
    if(!retiredArtworkUrls.size){artworkSweepRetries=0;return;}
    if(artworkSweepRetries>=MAX_ARTWORK_SWEEP_RETRIES){
      artworkSweepRetries=0;
      enforceRetiredArtworkBounds(true);
      return;
    }
    artworkSweepRetries++;
    artworkSweepTimer=setTimeout(()=>{
      artworkSweepTimer=0;
      sweepRetiredArtworkUrls();
    },240);
  }

  function retireArtworkUrl(url){
    if(typeof url!=="string"||!url.startsWith("blob:"))return;
    if(!isArtworkUrlReferenced(url)){
      try{URL.revokeObjectURL(url);}catch(error){}
      return;
    }
    retiredArtworkUrls.add(url);
    enforceRetiredArtworkBounds();
    scheduleArtworkSweep();
  }

  function replaceTrackArtwork(track,coverBlob,thumbBlob){
    if(!track)return;
    const oldUrls=new Set([track.coverUrl,track.thumbUrl].filter(url=>typeof url==="string"&&url.startsWith("blob:")));
    const nextCoverUrl=coverBlob?URL.createObjectURL(coverBlob):null;
    const nextThumbUrl=(thumbBlob||coverBlob)?URL.createObjectURL(thumbBlob||coverBlob):null;
    track.coverUrl=nextCoverUrl;
    track.thumbUrl=nextThumbUrl;
    oldUrls.forEach(url=>{
      if(url!==nextCoverUrl&&url!==nextThumbUrl){
        retireArtworkUrl(url);
      }
    });
  }
  function metadataVersionSnapshot(metadata,fileInfo={},capturedAt=Date.now()){
    const value=metadata||{};
    return {capturedAt,fileName:fileInfo.fileName||value.name||"",fileIdentity:fileInfo.fileIdentity||null,
      metadata:{name:value.name||"",title:value.title||"",artist:value.artist||"",album:value.album||null,date:value.date||null,genre:value.genre||null,genreSource:value.genreSource||null,duration:Number(value.duration)||0}};
  }
  async function rescanTrackMetadata(track){
    if(!track?.file||!track.contentKey)throw new Error("Local file is unavailable");
    if(typeof bindHistoryIdentityBeforeMetadataChange==="function")bindHistoryIdentityBeforeMetadataChange(track);
    const file=track.file,parsed=parseName(file.name),previous=await GPDatabase.getTrackCache(track.contentKey).catch(()=>null);
    const [embeddedMetadata,duration,coverTempUrl]=await Promise.all([
      extractFileMetadata(file),probeTrackDuration(track.url),extractEmbeddedCover(file)
    ]);
    const rescannedCoverBlob=await coverURLToBlob(coverTempUrl),coverBlob=rescannedCoverBlob||previous?.coverBlob||null;
    const thumbBlob=rescannedCoverBlob?(await createCoverThumbnailBlob(rescannedCoverBlob)):previous?.thumbBlob||coverBlob;
    const title=embeddedMetadata.title||parsed.title,artist=embeddedMetadata.artist||parsed.artist,genre=embeddedMetadata.genre||null;
    const beforeVersion=metadataVersionSnapshot(previous?.metadata||{name:track.name,title:track.title,artist:track.artist,album:track.album,date:track.date,genre:track.genre,duration:track.duration},
      {fileName:previous?.fileName||track.name,fileIdentity:previous?.fileIdentity||fileCacheIdentity(file)});
    const before=JSON.stringify({title:track.title,artist:track.artist,album:track.album||null,date:track.date||null,genre:track.genreSource==="metadata"?track.genre:null,duration:Math.round((track.duration||0)*1000)});
    track.name=file.name;track.title=title;track.artist=artist;track.album=embeddedMetadata.album||null;track.date=embeddedMetadata.date||null;
    track.duration=Number(duration)||Number(previous?.metadata?.duration)||track.duration||0;
    track.genre=genre;track.genreSource=genre?"metadata":null;
    if(!genre&&track.inferredGenre){track.genre=track.inferredGenre;track.genreSource="spectrum-inference";}
    track.sourceKey=songIdentity(artist,title);track.fileSize=file.size;track.fileLastModified=file.lastModified||0;track.mimeType=file.type||"";
    track.relativePath=file.webkitRelativePath||track.relativePath||"";track.format=audioFormatFromName(file.name);track.bitrateKbps=estimateTrackBitrate(file.size,track.duration);
    replaceTrackArtwork(track,coverBlob,thumbBlob);
    const base=previous||createPersistentTrackSnapshot(track,null),spectrumId=track.spectrumId||track.audioEssenceKey||track.contentKey;
    const aliases=Array.from(new Set([...(base.identityLinks?.artistAliases||[]),beforeVersion.metadata.artist,artist].filter(Boolean)));
    const titleAliases=Array.from(new Set([...(base.identityLinks?.titleAliases||[]),beforeVersion.metadata.title,title].filter(Boolean)));
    const afterMetadata={name:file.name,title,artist,album:embeddedMetadata.album||null,date:embeddedMetadata.date||null,duration:track.duration,genre,genreSource:genre?"metadata":null};
    const metadataVersions={before:beforeVersion,after:metadataVersionSnapshot(afterMetadata,{fileName:file.name,fileIdentity:fileCacheIdentity(file)})};
    const record=Object.assign({},base,{
      contentKey:track.contentKey,spectrumId,audioEssenceKey:track.audioEssenceKey||spectrumId,
      fileName:file.name,fileSize:file.size,fileLastModified:file.lastModified||0,fileType:file.type||"",relativePath:file.webkitRelativePath||"",fileIdentity:fileCacheIdentity(file),
      identityLinks:Object.assign({spectrumId,canonicalArtistId:null,artistAliases:[],titleAliases:[],genreIds:[]},base.identityLinks||{},{spectrumId,artistAliases:aliases,titleAliases,genreIds:genre?[genre]:[]}),
      metadata:afterMetadata,metadataVersions,
      technical:Object.assign({},base.technical||{},{format:audioFormatFromName(file.name),fileSize:file.size,mimeType:file.type||"",lastModified:file.lastModified||0,relativePath:file.webkitRelativePath||"",duration:track.duration,bitrateKbps:estimateTrackBitrate(file.size,track.duration)}),
      coverBlob:coverBlob||null,thumbBlob:thumbBlob||null,metadataRescannedAt:Date.now(),updatedAt:Date.now()
    });
    await GPDatabase.saveTrackCache(record);
    track.identityLinks=record.identityLinks;track.metadataVersions=metadataVersions;
    const after=JSON.stringify({title,artist,album:embeddedMetadata.album||null,date:embeddedMetadata.date||null,genre,duration:Math.round(track.duration*1000)});
    return {changed:before!==after,genreFound:Boolean(genre)};
  }
  async function rescanImportedLibrary(onProgress){
    if(metadataRescanRunning)throw new Error("Metadata rescan already running");
    metadataRescanRunning=true;const startedAt=performance.now(),stats={total:playlist.length,scanned:0,changed:0,genreFound:0,failed:0,durationMs:0};
    try{
      await mapWithConcurrency(playlist.slice(),2,async track=>{
        try{const result=await rescanTrackMetadata(track);stats.scanned++;if(result.changed)stats.changed++;if(result.genreFound)stats.genreFound++;}
        catch(error){stats.failed++;}
        onProgress?.(stats.scanned+stats.failed,stats.total,stats);await yieldSpectrumTask();
      });
      reservedSongIdentities.clear();reservedAudioFingerprints.clear();
      playlist.forEach(track=>{reservedSongIdentities.add(songIdentity(track.artist,track.title));if(track.contentKey)reservedAudioFingerprints.add(track.contentKey);});
      invalidateHistoryTrackIndex();
      syncHistoryMetadataForPlaylist();
      render(searchInputSafe());renderMiniQueue();
      scheduleDailyMixRefresh(40);
      if(currentIndex>=0&&playlist[currentIndex]){
        const current=playlist[currentIndex];setNowPlayingTitle(current.title);$("#nowArtist").textContent=current.artist;
        updateTrackInfoCard(current);updateArtDisplay();updateAmbient();applyAdaptiveAccent();
      }
      sweepRetiredArtworkUrls();
      stats.durationMs=Math.round(performance.now()-startedAt);GP.performance.lastMetadataRescan=Object.freeze({...stats});return stats;
    }finally{
      metadataRescanRunning=false;
      scheduleArtworkSweep();
    }
  }

