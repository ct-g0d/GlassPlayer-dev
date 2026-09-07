  GPModules.register("createBrowserFileAdapter",function createBrowserFileAdapter({fileInput,folderInput,storage}){
    const DEFAULT_MUSIC_FOLDER_ID="defaultMusicFolder";
    function pick(input){return new Promise(resolve=>{if(!input){resolve([]);return;}const done=()=>{input.removeEventListener("change",done);resolve(Array.from(input.files||[]));};input.addEventListener("change",done,{once:true});input.click();});}
    function supportsPersistedAudioFolder(){return typeof globalThis.showDirectoryPicker==="function"&&typeof storage?.getRecommendation==="function"&&typeof storage?.saveRecommendation==="function";}
    async function hasReadPermission(handle){try{return handle?.kind==="directory"&&await handle.queryPermission({mode:"read"})==="granted";}catch(error){return false;}}
    async function filesFromDirectory(handle){
      const files=[];
      async function visit(directory){for await(const entry of directory.values()){if(entry.kind==="file")files.push(await entry.getFile());else if(entry.kind==="directory")await visit(entry);}}
      await visit(handle);return files;
    }
    async function pickAndRememberAudioFolder(){
      if(!supportsPersistedAudioFolder())return pick(folderInput);
      const handle=await globalThis.showDirectoryPicker({mode:"read"});
      if(await hasReadPermission(handle))try{await storage.saveRecommendation({id:DEFAULT_MUSIC_FOLDER_ID,folderHandle:handle,savedAt:Date.now()});}catch(error){console.warn("Default music folder persistence failed",error);}
      return filesFromDirectory(handle);
    }
    async function restoreRememberedAudioFolder(){
      if(!supportsPersistedAudioFolder())return [];
      let record=null;try{record=await storage.getRecommendation(DEFAULT_MUSIC_FOLDER_ID);}catch(error){return [];}
      const handle=record?.folderHandle;if(!await hasReadPermission(handle))return [];
      try{return await filesFromDirectory(handle);}catch(error){return [];}
    }
    return Object.freeze({pickAudioFiles:()=>pick(fileInput),pickAudioFolder:()=>pick(folderInput),supportsPersistedAudioFolder,pickAndRememberAudioFolder,restoreRememberedAudioFolder});
  });
