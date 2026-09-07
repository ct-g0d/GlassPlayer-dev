window.GPModules ??= Object.create(null);
window.GPModules.register = function register(name,factory){
  if(typeof name!=="string"||!name)throw new TypeError("Module name is required");
  if(typeof factory!=="function")throw new TypeError(`Module ${name} must register a factory`);
  if(Object.prototype.hasOwnProperty.call(window.GPModules,name))throw new Error(`Module already registered: ${name}`);
  Object.defineProperty(window.GPModules,name,{value:factory,enumerable:true,configurable:false,writable:false});
  return factory;
};
