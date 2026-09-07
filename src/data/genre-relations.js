  /* ================= GP Neural Engine 2.1: offline genre graph =================
     Built from broad genre/style hierarchies (Discogs, MusicBrainz and the
     AcousticBrainz multi-label taxonomy). Runtime lookup is deliberately local:
     this module performs no network request and stores no remote identifier. */
  GP.genreRelations=(()=>{
    const families=Object.freeze({
      pop:["pop","dance-pop","synth-pop","art pop","indie pop","cantopop","mandopop","c-pop","k-pop","j-pop","adult contemporary"],
      rock:["rock","alternative rock","indie rock","hard rock","soft rock","art rock","progressive rock","psychedelic rock","electronic rock"],
      metal:["metal","heavy metal","alternative metal","progressive metal","metalcore","nu metal"],
      punk:["punk","punk rock","post-punk","pop punk","hardcore punk","new wave"],
      electronic:["electronic","electronica","edm","electro","idm","downtempo","trip hop","future bass","electropop"],
      house:["house","deep house","progressive house","electro house","future house","acid house","afro house"],
      techno:["techno","minimal techno","acid techno","industrial techno","hard techno"],
      trance:["trance","progressive trance","psytrance","goa trance","uplifting trance"],
      "drum and bass":["drum and bass","drum & bass","dnb","jungle","liquid funk","breakbeat"],
      ambient:["ambient","dark ambient","drone","chillout","new age","space music"],
      "hip hop":["hip hop","hip-hop","rap","trap","boom bap","abstract hip hop","cloud rap"],
      "r&b":["r&b","rnb","rhythm and blues","contemporary r&b","neo soul"],
      soul:["soul","motown","northern soul","gospel","blue-eyed soul"],
      funk:["funk","disco","boogie","p-funk","afro-funk"],
      jazz:["jazz","smooth jazz","bebop","hard bop","cool jazz","fusion","jazz fusion","latin jazz"],
      blues:["blues","rhythm & blues","electric blues","acoustic blues","blues rock"],
      classical:["classical","baroque","romantic","modern classical","opera","chamber music","orchestral"],
      folk:["folk","singer-songwriter","folk rock","acoustic","traditional","world","folk world country"],
      country:["country","country rock","americana","bluegrass","alt-country"],
      reggae:["reggae","dub","ska","dancehall","roots reggae"],
      latin:["latin","salsa","bossa nova","reggaeton","latin pop","latin jazz"],
      soundtrack:["soundtrack","stage and screen","film score","video game music","musical","score"]
    });
    const display=Object.freeze({
      pop:"Pop",rock:"Rock",metal:"Metal",punk:"Punk",electronic:"Electronic",house:"House",techno:"Techno",trance:"Trance",
      "drum and bass":"Drum & Bass",ambient:"Ambient","hip hop":"Hip-Hop","r&b":"R&B",soul:"Soul",funk:"Funk",jazz:"Jazz",
      blues:"Blues",classical:"Classical",folk:"Folk",country:"Country",reggae:"Reggae",latin:"Latin",soundtrack:"Soundtrack"
    });
    const edges=[
      ["pop","rock",.58],["pop","electronic",.68],["pop","r&b",.67],["pop","soul",.55],["pop","folk",.46],["pop","soundtrack",.42],
      ["rock","metal",.72],["rock","punk",.76],["rock","blues",.68],["rock","folk",.54],["rock","electronic",.48],
      ["metal","punk",.53],["punk","electronic",.42],["punk","pop",.44],
      ["electronic","house",.88],["electronic","techno",.84],["electronic","trance",.82],["electronic","drum and bass",.76],["electronic","ambient",.65],["electronic","hip hop",.44],
      ["house","techno",.78],["house","trance",.72],["house","drum and bass",.45],["house","funk",.57],["house","pop",.62],
      ["techno","trance",.68],["techno","drum and bass",.54],["techno","ambient",.48],
      ["trance","ambient",.55],["drum and bass","hip hop",.48],["drum and bass","ambient",.38],
      ["hip hop","r&b",.78],["hip hop","soul",.62],["hip hop","funk",.67],["hip hop","electronic",.52],
      ["r&b","soul",.9],["r&b","funk",.72],["r&b","jazz",.59],["soul","funk",.84],["soul","jazz",.68],["soul","gospel",.76],
      ["funk","jazz",.7],["funk","disco",.86],["jazz","blues",.77],["jazz","latin",.57],["blues","folk",.56],["blues","country",.6],
      ["folk","country",.82],["folk","classical",.35],["country","rock",.51],["reggae","ska",.88],["reggae","latin",.42],["reggae","hip hop",.43],
      ["latin","pop",.52],["latin","jazz",.6],["soundtrack","classical",.67],["soundtrack","ambient",.55],["soundtrack","electronic",.43]
    ];
    const aliases=new Map(),graph=new Map(),resolveCache=new Map(),similarityCache=new Map();
    function cacheSet(cache,key,value,limit){if(cache.size>=limit)cache.delete(cache.keys().next().value);cache.set(key,value);return value;}
    const normalize=value=>String(value||"").normalize("NFKD").toLowerCase().replace(/&/g," and ").replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," ");
    Object.entries(families).forEach(([canonical,names])=>{aliases.set(normalize(canonical),canonical);names.forEach(name=>aliases.set(normalize(name),canonical));graph.set(canonical,new Map([[canonical,1]]));});
    function connect(a,b,weight){if(!graph.has(a)||!graph.has(b))return;graph.get(a).set(b,weight);graph.get(b).set(a,weight);}
    edges.forEach(edge=>connect(...edge));
    function dice(a,b){
      if(a===b)return 1;if(a.length<2||b.length<2)return 0;
      const counts=new Map();for(let i=0;i<a.length-1;i++){const pair=a.slice(i,i+2);counts.set(pair,(counts.get(pair)||0)+1);}
      let matches=0;for(let i=0;i<b.length-1;i++){const pair=b.slice(i,i+2),count=counts.get(pair)||0;if(count){matches++;counts.set(pair,count-1);}}
      return 2*matches/((a.length-1)+(b.length-1));
    }
    function resolveOne(value){
      const normalized=normalize(value);if(!normalized)return null;
      if(resolveCache.has(normalized))return resolveCache.get(normalized);
      if(aliases.has(normalized)){const id=aliases.get(normalized);return cacheSet(resolveCache,normalized,{id,label:display[id],confidence:1,matched:normalized},512);}
      let best=null;
      for(const [name,id] of aliases){const score=dice(normalized,name);if(!best||score>best.confidence)best={id,label:display[id],confidence:score,matched:name};}
      return cacheSet(resolveCache,normalized,best&&best.confidence>=.48?best:null,512);
    }
    function resolve(value){
      const parts=String(value||"").split(/[\/,;|+]+/).map(resolveOne).filter(Boolean);
      return parts.length?parts.sort((a,b)=>b.confidence-a.confidence)[0]:resolveOne(value);
    }
    function graphSimilarity(a,b){
      if(a===b)return 1;
      const direct=graph.get(a)?.get(b);if(Number.isFinite(direct))return direct;
      let best=0;
      for(const [middle,left] of graph.get(a)||[]){const right=graph.get(middle)?.get(b);if(Number.isFinite(right))best=Math.max(best,left*right*.88);}
      return best;
    }
    function similarity(left,right){
      const leftKey=normalize(left),rightKey=normalize(right),cacheKey=leftKey<rightKey?`${leftKey}\u0000${rightKey}`:`${rightKey}\u0000${leftKey}`;
      if(similarityCache.has(cacheKey))return similarityCache.get(cacheKey);
      const a=resolve(left),b=resolve(right);if(!a||!b)return cacheSet(similarityCache,cacheKey,.12*dice(leftKey,rightKey),2048);
      const relation=graphSimilarity(a.id,b.id),certainty=Math.sqrt(a.confidence*b.confidence);
      return cacheSet(similarityCache,cacheKey,Math.max(.08,Math.min(1,relation*certainty+(1-certainty)*dice(leftKey,rightKey)*.38)),2048);
    }
    function relatedScore(map,genre){
      if(!map||!genre)return 0;
      const values=Object.values(map).map(value=>Math.abs(Number(value)||0)),max=Math.max(1,...values);let weighted=0,weight=0;
      Object.entries(map).forEach(([candidate,value])=>{const relation=similarity(candidate,genre);if(relation<.18)return;weighted+=(Number(value)||0)*relation;weight+=relation;});
      return Math.max(-1,Math.min(1,weight?weighted/(max*Math.max(1,Math.sqrt(weight))):0));
    }
    return Object.freeze({version:"1.0.0",source:"offline-static",families,resolve,similarity,relatedScore});
  })();
