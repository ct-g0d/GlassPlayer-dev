  GPModules.register("createEqPresets",function createEqPresets(source){const copy={};Object.entries(source).forEach(([key,value])=>copy[key]=Object.freeze([...value]));return Object.freeze(copy);});
