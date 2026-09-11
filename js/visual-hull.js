/* Experimental orthographic silhouette intersection. No anatomy or composition model.
 * Input masks describe the visible, clothed surface. Scale assumes silhouette extent
 * equals recorded stature. Neither that assumption nor camera alignment is validated.
 */
(function(root){
  'use strict';
  const VIEWS=['front','right','back','left'];
  function prepareMask({width,height,data,centerX}){
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<8||height<8||width*height>4e6||!data||data.length!==width*height)throw Error('Invalid mask dimensions.');
    const bits=new Uint8Array(data.length);
    for(let i=0;i<data.length;i++){
      if(!Number.isFinite(data[i])||data[i]<0||data[i]>1)throw Error('Invalid mask probability.');
      bits[i]=data[i]>=.5?1:0;
    }
    // Retain the largest connected foreground; fail if another substantial region exists.
    const seen=new Uint8Array(bits.length),queue=new Int32Array(bits.length);
    let largest=[],second=0,total=0;
    for(let seed=0;seed<bits.length;seed++){
      if(!bits[seed]||seen[seed])continue;
      let start=0,end=1;queue[0]=seed;seen[seed]=1;
      while(start<end){
        const p=queue[start++],x=p%width,y=Math.floor(p/width);
        for(const n of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1]){
          if(n>=0&&bits[n]&&!seen[n]){seen[n]=1;queue[end++]=n;}
        }
      }
      total+=end;
      if(end>largest.length){second=largest.length;largest=queue.slice(0,end);}else second=Math.max(second,end);
    }
    if(largest.length<width*height*.01)throw Error('No usable person silhouette.');
    if(second>largest.length*.02)throw Error('Disconnected silhouette. Use a clear full-body photo.');
    bits.fill(0);let left=width,right=0,top=height,bottom=0;
    for(const p of largest){bits[p]=1;const x=p%width,y=Math.floor(p/width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    if(left===0||top===0||right===width-1||bottom===height-1)throw Error('Silhouette touches the image edge. Retake with space around the whole body.');
    if(bottom-top<height*.3)throw Error('Person is too small in the frame.');
    if(!Number.isFinite(centerX)||centerX<left||centerX>right)throw Error('A valid hip-center alignment is required.');
    return {width,height,bits,top:top-.5,bottom:bottom+.5,centerX,left:left-.5,right:right+.5,discardedPixels:total-largest.length};
  }
  function reconstruct(masks,{heightM,resolution=96,allowLowerArtifactRemoval=false}={}){
    if(!Number.isFinite(heightM)||heightM<.8||heightM>2.5)throw Error('Enter a recorded height from 80 to 250 cm.');
    if(!Number.isInteger(resolution)||resolution<24||resolution>128)throw Error('Resolution must be 24–128.');
    for(const view of VIEWS){const m=masks?.[view];if(!m||!(m.bits instanceof Uint8Array)||!Number.isInteger(m.width)||!Number.isInteger(m.height)||m.width*m.height>4e6||m.bits.length!==m.width*m.height||!Number.isFinite(m.centerX)||!(m.bottom>m.top)||![m.top,m.bottom,m.left,m.right].every(Number.isFinite)||m.centerX<m.left||m.centerX>m.right)throw Error('Four prepared silhouettes with valid alignment are required.');}
    const extent=views=>Math.max(...views.map(v=>{const m=masks[v];return Math.max(m.centerX-m.left,m.right-m.centerX)/(m.bottom-m.top)*heightM;}));
    const step=heightM/resolution,nx=Math.ceil(extent(['front','back'])/step)*2+2,nz=Math.ceil(extent(['left','right'])/step)*2+2,ny=resolution;
    if(nx*nz*ny>2e6)throw Error('Silhouette is too wide for this experiment. Check pose and alignment.');
    const voxels=new Uint8Array(nx*ny*nz),index=(x,y,z)=>(y*nz+z)*nx+x;
    function inside(view,horizontal,y){
      const m=masks[view],span=m.bottom-m.top;
      const u=Math.round(m.centerX+horizontal/heightM*span),v=Math.round(m.bottom-y/heightM*span);
      return u>=0&&u<m.width&&v>=0&&v<m.height&&m.bits[v*m.width+u]===1;
    }
    let count=0;
    for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      const px=(x-nx/2+.5)*step,py=(y+.5)*step,pz=(z-nz/2+.5)*step;
      if(inside('front',px,py)&&inside('back',-px,py)&&inside('right',pz,py)&&inside('left',-pz,py)){voxels[index(x,y,z)]=1;count++;}
    }
    if(count<100)throw Error('Insufficient intersection. Check all four views and alignment.');
    // Reject fragmented intersections instead of silently displaying severed anatomy.
    const queue=new Int32Array(count),labels=new Int32Array(voxels.length);
    const components=[];let componentCount=0;
    for(let seed=0;seed<voxels.length;seed++){
      if(!voxels[seed]||labels[seed])continue;
      const componentId=++componentCount;
      let start=0,end=1,minY=ny,maxY=0;queue[0]=seed;labels[seed]=componentId;
      while(start<end){const p=queue[start++],x=p%nx,z=Math.floor(p/nx)%nz,y=Math.floor(p/(nx*nz));
        minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        for(const n of [x>0?p-1:-1,x<nx-1?p+1:-1,z>0?p-nx:-1,z<nz-1?p+nx:-1,y>0?p-nx*nz:-1,y<ny-1?p+nx*nz:-1]){
          if(n>=0&&voxels[n]&&!labels[n]){labels[n]=componentId;queue[end++]=n;}
        }
      }
      components.push({id:componentId,voxels:end,fromFloorFraction:minY/ny,toFloorFraction:(maxY+1)/ny,...(end<=4096?{cells:queue.slice(0,end)}:{})});
      components.sort((a,b)=>b.voxels-a.voxels);if(components.length>8)components.pop();
    }
    let topologyAdjustment=null;
    if(componentCount>1){
      const largest=components[0];
      // For small retained fragments, report whether only one to three empty face
      // voxels separate them from the main body. This diagnoses a possible sampling
      // gap; it does not repair, delete or join any geometry.
      const closestBridgeVoxels=component=>{
        if(!component.cells)return null;let best=5;
        for(const p of component.cells){const x=p%nx,z=Math.floor(p/nx)%nz,y=Math.floor(p/(nx*nz));
          for(let dy=-4;dy<=4;dy++)for(let dz=-4;dz<=4;dz++)for(let dx=-4;dx<=4;dx++){
            const distance=Math.abs(dx)+Math.abs(dy)+Math.abs(dz);if(distance<2||distance>=best)continue;
            const xx=x+dx,yy=y+dy,zz=z+dz;if(xx<0||xx>=nx||yy<0||yy>=ny||zz<0||zz>=nz)continue;
            if(labels[index(xx,yy,zz)]===largest.id)best=distance;
          }
        }
        return best<=4?best-1:null;
      };
      const diagnostics={protocol:'surface-connectivity-v1',resolution,occupiedVoxels:count,componentCount,
        largestComponentFraction:largest.voxels/count,components:components.slice(0,8).map((c,i)=>({voxels:c.voxels,fromFloorFraction:c.fromFloorFraction,toFloorFraction:c.toFloorFraction,
          ...(i?{closestBridgeVoxels:closestBridgeVoxels(c)}:{})}))};
      const fragments=components.slice(1),removedVoxels=count-largest.voxels;
      // Optional cleanup is intentionally narrow and disclosed in the returned mesh.
      // It can remove a tiny detached sampling artifact beside the feet, but it never
      // joins components or fills unsupported anatomy. Strict rejection is the default.
      const removable=allowLowerArtifactRemoval===true&&componentCount===components.length&&componentCount<=4&&
        largest.voxels/count>=.995&&removedVoxels<=256&&fragments.every(c=>c.cells&&c.toFloorFraction<=.1);
      if(removable){
        for(let i=0;i<voxels.length;i++)if(voxels[i]&&labels[i]!==largest.id)voxels[i]=0;
        topologyAdjustment={protocol:'surface-lower-artifact-removal-v1',componentCountBefore:componentCount,
          originalOccupiedVoxels:count,removedVoxels,removedFraction:removedVoxels/count,
          affectedFromFloorFraction:Math.min(...fragments.map(c=>c.fromFloorFraction)),affectedToFloorFraction:Math.max(...fragments.map(c=>c.toFloorFraction))};
        count=largest.voxels;
      }else{
        const error=Error('The surface is disconnected. Pose or alignment differs between views.');
        error.code='DISCONNECTED_SURFACE';error.diagnostics=diagnostics;throw error;
      }
    }
    const vertices=[],faces=[],lookup=new Map();
    function vertex(x,y,z){const key=[x,y,z].join(',');if(!lookup.has(key)){lookup.set(key,vertices.length);vertices.push([(x-nx/2)*step,y*step,(z-nz/2)*step]);}return lookup.get(key);}
    const sides=[
      [-1,0,0,[[0,0,0],[0,0,1],[0,1,1],[0,1,0]]],
      [1,0,0,[[1,0,1],[1,0,0],[1,1,0],[1,1,1]]],
      [0,-1,0,[[0,0,1],[0,0,0],[1,0,0],[1,0,1]]],
      [0,1,0,[[0,1,0],[0,1,1],[1,1,1],[1,1,0]]],
      [0,0,-1,[[1,0,0],[0,0,0],[0,1,0],[1,1,0]]],
      [0,0,1,[[0,0,1],[1,0,1],[1,1,1],[0,1,1]]]
    ];
    for(let y=0;y<ny;y++)for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
      if(!voxels[index(x,y,z)])continue;
      for(const [dx,dy,dz,corners] of sides){const xx=x+dx,yy=y+dy,zz=z+dz;
        if(xx>=0&&xx<nx&&yy>=0&&yy<ny&&zz>=0&&zz<nz&&voxels[index(xx,yy,zz)])continue;
        const q=corners.map(c=>vertex(x+c[0],y+c[1],z+c[2]));faces.push([q[0],q[1],q[2]],[q[0],q[2],q[3]]);
        if(faces.length>150000)throw Error('Surface exceeds the preview complexity limit. Use clearer silhouettes.');
      }
    }
    const edges=new Map();
    for(const f of faces)for(let i=0;i<3;i++){const a=f[i],b=f[(i+1)%3],key=a<b?a+','+b:b+','+a;edges.set(key,(edges.get(key)||0)+1);}
    if([...edges.values()].some(n=>n!==2))throw Error('Surface has ambiguous voxel contacts. Check alignment or retake clearer silhouettes.');
    return {vertices,faces,protocol:'orthographic-four-silhouette-v1',heightM,resolution,stepM:step,occupiedVoxels:count,
      ...(topologyAdjustment?{topologyAdjustment}:{}),scaleStatus:'assumed-stature-not-validated',units:'m',experimental:true};
  }
  function toOBJ(mesh){
    return ['# EXPERIMENTAL silhouette intersection; clothed outer surface, not anatomical reconstruction',
      '# Units: m; scale assumes silhouette height equals recorded stature; NOT independently calibrated',
      '# Protocol: '+mesh.protocol,...mesh.vertices.map(v=>'v '+v.map(n=>n.toFixed(7)).join(' ')),...mesh.faces.map(f=>'f '+f.map(n=>n+1).join(' ')),''].join('\n');
  }
  const api={VIEWS,prepareMask,reconstruct,toOBJ};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.VisualHull=api;
})(globalThis);
