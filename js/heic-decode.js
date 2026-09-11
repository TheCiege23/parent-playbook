// Optional local decoder, loaded only for HEIC. See HEIC-IMPORT.md for provenance.
(function(root){
  'use strict';
  const URL='https://cdn.jsdelivr.net/npm/heic-to@1.5.2/src/lib/libheif-without-unsafe-eval.js';
  let codec;
  async function isHEIC(blob){
    if(/^image\/hei[cf]/i.test(blob.type)||/\.hei[cf]$/i.test(blob.name||''))return true;
    const bytes=new Uint8Array(await blob.slice(0,64).arrayBuffer());
    const text=Array.from(bytes,b=>String.fromCharCode(b)).join('');
    if(text.slice(4,8)!=='ftyp')return false;
    for(let i=8;i+4<=text.length;i+=4)if(['heic','heix','hevc','hevx','mif1','msf1'].includes(text.slice(i,i+4)))return true;
    return false;
  }
  async function normalize(blob,onProgress=()=>{}){
    if(!(blob instanceof Blob)||!blob.size||blob.size>25*1024*1024)throw Error('invalid_photo');
    if(!await isHEIC(blob))return {blob,conversion:null};
    onProgress('Converting the HEIC photo on this device…');
    if(!codec){const source=await import(URL);codec=source.default();}
    let decoder,images,canvas,bytes;
    try{
      bytes=new Uint8Array(await blob.arrayBuffer());decoder=new codec.HeifDecoder();images=decoder.decode(bytes);
      if(images.length!==1)throw Error('heic_multiple_images');
      const image=images[0],width=image.get_width(),height=image.get_height();
      if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||width*height>16000000)throw Error('photo_dimensions');
      const pixels=new ImageData(width,height);
      for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=255;
      const decoded=await new Promise((resolve,reject)=>image.display(pixels,data=>data?resolve(data):reject(Error('heic_decode_failed'))));
      canvas=new OffscreenCanvas(width,height);canvas.getContext('2d').putImageData(decoded,0,0);
      const output=await canvas.convertToBlob({type:'image/png'});
      return {blob:output,conversion:{protocol:'heic-png-v1',decoder:'libheif-1.22.2/heic-to-1.5.2-csp',width,height,outputType:'image/png'}};
    }finally{
      if(canvas)canvas.width=canvas.height=1;
      for(const image of images||[])image.free();
      if(decoder?.decoder)codec.heif_context_free(decoder.decoder);
      bytes?.fill(0);
    }
  }
  root.HeicImport={isHEIC,normalize};
})(globalThis);
