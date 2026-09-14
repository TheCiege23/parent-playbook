// Avatar files for an experimental silhouette surface: a USD text layer (.usda) and a USDZ package holding it.
//
// FITMATCH says its avatar is delivered as a USDZ or an OBJ file. The lab already writes OBJ (VisualHull.toOBJ); this
// writes the same triangles as USD, Y up and in metres, with the same warnings carried inside the file. A USDZ package
// is a zip archive with no compression and no encryption whose first file is the default layer, and whose file data
// starts on a 64-byte boundary so it can be memory-mapped; the writer below meets that and nothing more.
//
// It changes nothing about what the geometry means. The surface is a clothed silhouette intersection whose scale assumes
// the recorded stature, not an anatomical reconstruction, and every file says so. Lab-only for now: not in the SDK, the
// buyer package or the company results contract.
(function(root){
  const DISCLAIMER='EXPERIMENTAL silhouette intersection; clothed outer surface, not anatomical reconstruction. '
    +'Units: m; scale assumes silhouette height equals recorded stature; NOT independently calibrated.';
  const MAX_FACES=150000;

  function checkMesh(mesh){
    if(!mesh||mesh.experimental!==true||mesh.units!=='m')throw Error('Only an experimental silhouette surface in metres can be written as an avatar file.');
    const {vertices,faces}=mesh;
    if(!Array.isArray(vertices)||!Array.isArray(faces)||vertices.length<4||faces.length<4)throw Error('The surface has too few vertices or faces to write.');
    if(faces.length>MAX_FACES)throw Error('The surface exceeds the avatar file complexity limit.');
    for(const v of vertices)if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error('A surface vertex is not three finite numbers.');
    for(const f of faces)if(!Array.isArray(f)||f.length!==3||!f.every(i=>Number.isInteger(i)&&i>=0&&i<vertices.length)||f[0]===f[1]||f[1]===f[2]||f[0]===f[2])
      throw Error('A surface face does not name three distinct vertices.');
  }

  // Positive when the triangles wind counter-clockwise seen from outside, which is USD's rightHanded orientation.
  function signedVolume(mesh){
    let volume=0;
    for(const [a,b,c] of mesh.faces){
      const p=mesh.vertices[a],q=mesh.vertices[b],r=mesh.vertices[c];
      volume+=(p[0]*(q[1]*r[2]-q[2]*r[1])-p[1]*(q[0]*r[2]-q[2]*r[0])+p[2]*(q[0]*r[1]-q[1]*r[0]))/6;
    }
    return volume;
  }

  const number=n=>{const s=n.toFixed(7);return /^-0\.0+$/.test(s)?s.slice(1):s;};
  const tuple=v=>'('+v.map(number).join(', ')+')';
  const quote=s=>'"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,' ')+'"';

  function toUSDA(mesh){
    checkMesh(mesh);
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const v of mesh.vertices)for(let i=0;i<3;i++){if(v[i]<min[i])min[i]=v[i];if(v[i]>max[i])max[i]=v[i];}
    const protocol=String(mesh.protocol||'unknown'),scale=String(mesh.scaleStatus||'unknown');
    return ['#usda 1.0','(',
      '    defaultPrim = "Avatar"',
      '    doc = '+quote(DISCLAIMER+' Protocol: '+protocol),
      '    metersPerUnit = 1',
      '    upAxis = "Y"',
      '    customLayerData = {',
      '        bool experimental = 1',
      '        string protocol = '+quote(protocol),
      '        string scaleStatus = '+quote(scale),
      '    }',
      ')','',
      'def Xform "Avatar" (','    kind = "component"',')','{',
      '    def Mesh "Surface"','    {',
      '        uniform bool doubleSided = 0',
      '        float3[] extent = ['+tuple(min)+', '+tuple(max)+']',
      '        int[] faceVertexCounts = ['+mesh.faces.map(()=>3).join(', ')+']',
      '        int[] faceVertexIndices = ['+mesh.faces.map(f=>f.join(', ')).join(', ')+']',
      '        uniform token orientation = "'+(signedVolume(mesh)>=0?'rightHanded':'leftHanded')+'"',
      '        point3f[] points = ['+mesh.vertices.map(tuple).join(', ')+']',
      '        uniform token subdivisionScheme = "none"',
      '    }','}',''].join('\n');
  }

  const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
  function crc32(bytes){let c=0xFFFFFFFF;for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0;}

  // One stored file, avatar.usda, at offset 0. The local header's extra field is padded so the file data begins on a
  // 64-byte boundary. Fixed timestamps (1980-01-01 00:00) make the same surface give the same bytes.
  function toUSDZ(mesh){
    const encoder=new TextEncoder();
    const data=encoder.encode(toUSDA(mesh)),name=encoder.encode('avatar.usda'),crc=crc32(data);
    const fixedLocal=30+name.length+4,pad=(64-fixedLocal%64)%64,extraLength=4+pad,dataOffset=fixedLocal+pad;
    const centralLength=46+name.length,out=new Uint8Array(dataOffset+data.length+centralLength+22),view=new DataView(out.buffer);
    let at=0;
    const u16=v=>{view.setUint16(at,v,true);at+=2;},u32=v=>{view.setUint32(at,v>>>0,true);at+=4;};
    u32(0x04034b50);u16(20);u16(0);u16(0);u16(0);u16(0x21);u32(crc);u32(data.length);u32(data.length);u16(name.length);u16(extraLength);
    out.set(name,at);at+=name.length;
    u16(0x1986);u16(pad);at+=pad;
    out.set(data,at);at+=data.length;
    const centralStart=at;
    u32(0x02014b50);u16(20);u16(20);u16(0);u16(0);u16(0);u16(0x21);u32(crc);u32(data.length);u32(data.length);
    u16(name.length);u16(0);u16(0);u16(0);u16(0);u32(0);u32(0);
    out.set(name,at);at+=name.length;
    u32(0x06054b50);u16(0);u16(0);u16(1);u16(1);u32(centralLength);u32(centralStart);u16(0);
    return out;
  }

  const api={DISCLAIMER,toUSDA,toUSDZ,signedVolume,crc32,USDZ_MEDIA_TYPE:'model/vnd.usdz+zip'};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AvatarFiles=api;
})(globalThis);
