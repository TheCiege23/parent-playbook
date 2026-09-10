const {parseOBJ,sectionMesh}=require('../../js/mesh-section.js');
module.exports={parseOBJ,sectionMesh};
if(typeof require==='function'&&typeof module==='object'&&require.main===module){
  const fs=require('node:fs');
  try{
    const [file,axis,coordinate,unit]=process.argv.slice(2);
    if(!file || coordinate===undefined) throw Error('Usage: node mesh-section.cjs triangulated.obj y 0.9 m');
    const mesh=parseOBJ(fs.readFileSync(file,'utf8'));
    process.stdout.write(JSON.stringify(sectionMesh(mesh,{axis,plane:Number(coordinate),unit}),null,2)+'\n');
  }catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
