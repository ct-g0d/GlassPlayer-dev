  GPModules.register("createActions",function createActions(){
    const types=Object.freeze({PATCH:"app/patch",REPLACE:"app/replace"});
    return Object.freeze({types,patch:(path,value)=>Object.freeze({type:types.PATCH,path:Object.freeze([...path]),value}),replace:state=>Object.freeze({type:types.REPLACE,state})});
  });
