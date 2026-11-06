  GPModules.register("createBrowserFileAdapter",function createBrowserFileAdapter({fileInput,folderInput,storage}){
    const DEFAULT_MUSIC_FOLDER_ID="defaultMusicFolder";
    function pick(input){return new Promise(resolve=>{if(!input){resolve([]);return;}const done=()=>{input.removeEventListener("change",done);resolve(Array.from(input.files||[]));};input.addEventListener("change",done,{once:true});input.click();});}
    function supportsPersistedAudioFolder(){if(globalThis.glassAPI?.music)return true;return typeof globalThis.showDirectoryPicker==="function"&&typeof storage?.getRecommendation==="function"&&typeof storage?.saveRecommendation==="function";}
    async function hasReadPermission(handle){try{return handle?.kind==="directory"&&await handle.queryPermission({mode:"read"})==="granted";}catch(error){return false;}}
    async function filesFromDirectory(handle){
      const files=[];
      async function visit(directory){for await(const entry of directory.values()){if(entry.kind==="file")files.push(await entry.getFile());else if(entry.kind==="directory")await visit(entry);}}
      await visit(handle);return files;
    }
    /* Electron: the music folder is remembered by the main process (a native folder dialog, no permission prompt) and listed
       again at every start-up. Each song becomes a file-shaped object that reads its bytes from app://…/music/<path> with
       Range requests, so recognition reads only the few samples it needs, and playback streams the same URL (gpUrl). */
    const nativeMusic=globalThis.glassAPI?.music||null;
    const AUDIO_TYPES={mp3:"audio/mpeg",flac:"audio/flac",wav:"audio/wav",ogg:"audio/ogg",m4a:"audio/mp4",aac:"audio/aac",wma:"audio/x-ms-wma",opus:"audio/opus"};
    function diskFile(entry,folderName){
      const url=`${location.origin}/music/${entry.rel.split("/").map(encodeURIComponent).join("/")}`,size=entry.size;
      const read=(start,end)=>end<=start?Promise.resolve(new ArrayBuffer(0)):fetch(url,{headers:{Range:`bytes=${start}-${end-1}`}}).then(response=>{if(!response.ok)throw new Error(`Cannot read ${entry.rel} (${response.status})`);return response.arrayBuffer();});
      const clamp=(value,fallback,length)=>{if(value===undefined)return fallback;value=Math.trunc(Number(value)||0);return value<0?Math.max(0,length+value):Math.min(value,length);};
      const part=(offset,length,type)=>({size:length,type,arrayBuffer:()=>read(offset,offset+length),
        slice:(start,end,sliceType="")=>{const s=clamp(start,0,length),e=Math.max(s,clamp(end,length,length));return part(offset+s,e-s,sliceType);}});
      const ext=(entry.name.split(".").pop()||"").toLowerCase(),whole=part(0,size,AUDIO_TYPES[ext]||"");
      return Object.freeze({...whole,name:entry.name,lastModified:entry.lastModified,webkitRelativePath:`${folderName}/${entry.rel}`,gpUrl:url,
        arrayBuffer:()=>fetch(url).then(response=>response.arrayBuffer()),stream:()=>{const body=new TransformStream();fetch(url).then(response=>response.body.pipeTo(body.writable));return body.readable;}});
    }
    async function nativeFolderFiles(){const listing=await nativeMusic.scan();return listing?listing.files.map(entry=>diskFile(entry,listing.name)):[];}
    async function pickAndRememberAudioFolder(){
      if(nativeMusic){if(!await nativeMusic.choose())throw Object.assign(new Error("No folder chosen"),{name:"AbortError"});return nativeFolderFiles();}
      if(!supportsPersistedAudioFolder())return pick(folderInput);
      const handle=await globalThis.showDirectoryPicker({mode:"read"});
      if(await hasReadPermission(handle))try{await storage.saveRecommendation({id:DEFAULT_MUSIC_FOLDER_ID,folderHandle:handle,savedAt:Date.now()});}catch(error){console.warn("Default music folder persistence failed",error);}
      return filesFromDirectory(handle);
    }
    async function restoreRememberedAudioFolder(){
      if(nativeMusic){try{return await nativeFolderFiles();}catch(error){console.warn("Music folder listing failed",error);return [];}}
      if(!supportsPersistedAudioFolder())return [];
      let record=null;try{record=await storage.getRecommendation(DEFAULT_MUSIC_FOLDER_ID);}catch(error){return [];}
      const handle=record?.folderHandle;if(!await hasReadPermission(handle))return [];
      try{return await filesFromDirectory(handle);}catch(error){return [];}
    }
    return Object.freeze({pickAudioFiles:()=>pick(fileInput),pickAudioFolder:()=>pick(folderInput),supportsPersistedAudioFolder,pickAndRememberAudioFolder,restoreRememberedAudioFolder,hasNativeMusicFolder:()=>!!nativeMusic});
  });
