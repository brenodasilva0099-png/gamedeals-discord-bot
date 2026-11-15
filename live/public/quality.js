'use strict';
(function (root) {
  const LIMITS={480:{width:854,height:480},720:{width:1280,height:720},1080:{width:1920,height:1080},1440:{width:2560,height:1440}};
  // Mantém a proporção do conteúdo e NUNCA amplia pixels de uma fonte menor.
  function dimensions(sourceWidth,sourceHeight,selected){
    const limit=LIMITS[selected];
    if(!limit||!Number.isFinite(sourceWidth)||!Number.isFinite(sourceHeight)||sourceWidth<2||sourceHeight<2)throw Error('Resolução de origem inválida');
    const scale=Math.min(1,limit.width/sourceWidth,limit.height/sourceHeight);
    const width=Math.max(2,Math.floor(sourceWidth*scale/2)*2);
    const height=Math.max(2,Math.floor(sourceHeight*scale/2)*2);
    return {width,height,native:width===sourceWidth&&height===sourceHeight};
  }
  function bitrate(width,height,fps){
    if(![15,30,60].includes(fps))throw Error('FPS inválido');
    return Math.max(850000,Math.min(16000000,Math.round(6500000*(width*height/(1920*1080))*(fps/60))));
  }
  const api={dimensions,bitrate,LIMITS};
  root.GDQuality=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
