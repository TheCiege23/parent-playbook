const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {BUNDLE_FILES}=require('./sdk-files.cjs');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function verifyBundle(directory){
  const root=path.resolve(directory),errors=[];
  let manifest;
  try{
    const p=path.join(root,'manifest.json');
    if(!fs.lstatSync(p).isFile()||fs.lstatSync(p).isSymbolicLink())throw new Error('Not a regular file');
    manifest=JSON.parse(fs.readFileSync(p,'utf8'));
  }catch{ return {ok:false,errors:['Missing or invalid manifest.json']}; }
  if(manifest.schema!=='PP_BODY_SDK_BUNDLE_V1'||!/^\d+\.\d+\.\d+$/.test(manifest.sdkVersion)||!Array.isArray(manifest.files))return {ok:false,errors:['Unsupported manifest']};
  const expected=new Set(BUNDLE_FILES),entries=new Map();
  for(const row of manifest.files){
    if(!row||!expected.has(row.path)||entries.has(row.path)||!Number.isSafeInteger(row.bytes)||row.bytes<0||typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)){errors.push('Invalid, duplicate or unexpected manifest entry');continue;}
    entries.set(row.path,row);
  }
  // Walk only to reject unexpected files; never follow directory or file symlinks.
  const allowedDirs=new Set();
  for(const file of BUNDLE_FILES){const parts=file.split('/');parts.pop();let current='';for(const part of parts){current=current?current+'/'+part:part;allowedDirs.add(current);}}
  function walk(dir,relative=''){
    for(const name of fs.readdirSync(dir)){
      const rel=relative?relative+'/'+name:name,p=path.join(dir,name),stat=fs.lstatSync(p);
      if(stat.isSymbolicLink()){errors.push('Symbolic link is not allowed: '+rel);continue;}
      if(stat.isDirectory()){
        if(!allowedDirs.has(rel))errors.push('Unexpected directory: '+rel);else walk(p,rel);
      // signature.json is a DETACHED signature over the manifest: legitimately present,
      // never required, and not itself a manifest entry — tools/sdk-sign.cjs writes it after
      // the build. Rejecting it here made signing a package break its own verification.
      }else if(!stat.isFile()||(!expected.has(rel)&&rel!=='manifest.json'&&rel!=='signature.json'))errors.push('Unexpected file: '+rel);
    }
  }
  try{walk(root);}catch{errors.push('Unable to read bundle directory');}
  for(const name of expected){
    const row=entries.get(name);if(!row){errors.push('Missing manifest entry: '+name);continue;}
    try{
      const parts=name.split('/');let p=root;
      for(const part of parts){p=path.join(p,part);if(fs.lstatSync(p).isSymbolicLink())throw new Error('Symbolic link');}
      if(!fs.lstatSync(p).isFile())throw new Error('Not a file');
      const bytes=fs.readFileSync(p);
      if(bytes.length!==row.bytes||digest(bytes)!==row.sha256)errors.push('Checksum mismatch: '+name);
    }catch{errors.push('Missing or unreadable file: '+name);}
  }
  if(!errors.length){
    const source=fs.readFileSync(path.join(root,'js/body-sdk.mjs'),'utf8');
    if(!source.includes("SDK_VERSION = '"+manifest.sdkVersion+"'"))errors.push('SDK version mismatch');
  }
  // Report whether a detached signature accompanies the package. Its VALIDITY is a
  // separate question for tools/sdk-sign.cjs; this only says whether one is there.
  const signed=fs.existsSync(path.join(root,'signature.json'));
  return {ok:errors.length===0,sdkVersion:manifest.sdkVersion,fileCount:entries.size,signed,errors};
}
if(require.main===module){
  const result=verifyBundle(process.argv[2]||path.join(__dirname,'..'));
  console.log(JSON.stringify(result,null,2));process.exitCode=result.ok?0:1;
}
module.exports={verifyBundle,digest};
