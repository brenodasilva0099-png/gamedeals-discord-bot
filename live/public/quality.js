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
  // Tenta primeiro a qualidade selecionada. Se o navegador nao tiver encoder
  // compativel, reduz FPS/resolucao sem ampliar artificialmente a origem.
  function encoderCandidates(width,height,fps){
    if(![15,30,60].includes(fps))throw Error('FPS inválido');
    const choices=[];
    const seen=new Set();
    function add(w,h,f){
      const key=w+'x'+h+'@'+f;
      if(w<320||h<180||w%2||h%2||seen.has(key))return;
      seen.add(key);choices.push({width:w,height:h,fps:f});
    }
    add(width,height,fps);
    if(fps>30)add(width,height,30);
    for(const tier of [1080,720,480]){
      const d=dimensions(width,height,tier);
      add(d.width,d.height,30);
    }
    const d=dimensions(width,height,480);
    add(d.width,d.height,15);
    const scale=Math.min(1,640/width,360/height);
    add(Math.floor(width*scale/2)*2,Math.floor(height*scale/2)*2,15);
    return choices;
  }
  const api={dimensions,bitrate,encoderCandidates,LIMITS};
  root.GDQuality=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(globalThis);
