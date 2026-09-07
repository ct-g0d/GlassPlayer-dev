  function monotoneCurvePath(points,tension=.62){
    if(!points?.length)return "";
    if(points.length===1)return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    const slopes=points.slice(0,-1).map((point,index)=>(points[index+1].y-point.y)/Math.max(.001,points[index+1].x-point.x));
    const tangents=points.map((_,index)=>{
      if(index===0)return slopes[0]*tension;
      if(index===points.length-1)return slopes[slopes.length-1]*tension;
      const before=slopes[index-1],after=slopes[index];
      if(before===0||after===0||Math.sign(before)!==Math.sign(after))return 0;
      return .5*(Math.sign(before)+Math.sign(after))*Math.min(Math.abs(before),Math.abs(after),Math.abs(before+after)/2)*tension;
    });
    let path=`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
    for(let index=0;index<points.length-1;index++){
      const point=points[index],next=points[index+1],handle=(next.x-point.x)/3;
      path+=` C ${(point.x+handle).toFixed(2)} ${(point.y+tangents[index]*handle).toFixed(2)} ${(next.x-handle).toFixed(2)} ${(next.y-tangents[index+1]*handle).toFixed(2)} ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
    }
    return path;
  }
  GP.utils = (() => {
    function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
    function formatTime(sec){if(!isFinite(sec)||sec<0)sec=0;const m=Math.floor(sec/60),s=Math.floor(sec%60).toString().padStart(2,"0");return `${m}:${s}`;}
    return Object.freeze({clamp,formatTime,monotoneCurvePath});
  })();
