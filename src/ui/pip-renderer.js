  GP.pipRenderer = (() => {
    function roundedRect(ctx,x,y,width,height,radius){
      const r=Math.max(0,Math.min(radius,width/2,height/2));ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+width,y,x+width,y+height,r);ctx.arcTo(x+width,y+height,x,y+height,r);ctx.arcTo(x,y+height,x,y,r);ctx.arcTo(x,y,x+width,y,r);ctx.closePath();
    }
    function fitText(ctx,text,maxWidth){
      const value=String(text||"");if(ctx.measureText(value).width<=maxWidth)return value;let low=0,high=value.length;while(low<high){const mid=Math.ceil((low+high)/2);if(ctx.measureText(value.slice(0,mid)+"…").width<=maxWidth)low=mid;else high=mid-1;}return value.slice(0,low)+"…";
    }
    function drawCover(ctx,image,x,y,size,radius){
      const deviceScale=ctx.getTransform?.().a||1;x=Math.round(x*deviceScale)/deviceScale;y=Math.round(y*deviceScale)/deviceScale;size=Math.round(size*deviceScale)/deviceScale;
      roundedRect(ctx,x,y,size,size,radius);ctx.save();ctx.clip();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
      const scale=Math.max(size/image.naturalWidth,size/image.naturalHeight),width=image.naturalWidth*scale,height=image.naturalHeight*scale;ctx.drawImage(image,x+(size-width)/2,y+(size-height)/2,width,height);ctx.restore();
    }
    function calculateLayout(designWidth,designHeight,canvasWidth,pipWidth){
      const scale=canvasWidth/designWidth,compactness=Math.max(0,Math.min(1,(520-pipWidth)/260)),snap=value=>Math.round(value*scale)/scale;
      const coverSize=snap(492+52*compactness),coverX=snap(82-40*compactness),coverY=snap((designHeight-coverSize)/2),contentX=snap(620+6*compactness),contentWidth=snap(designWidth-contentX-70),titleSize=snap(52+16*compactness),artistSize=snap(29+8*compactness),titleY=snap(267+9*compactness),artistY=snap(319+20*compactness);
      return Object.freeze({scale,compactness,coverSize,coverX,coverY,contentX,contentWidth,titleSize,artistSize,titleY,artistY});
    }
    return Object.freeze({roundedRect,fitText,drawCover,calculateLayout});
  })();

