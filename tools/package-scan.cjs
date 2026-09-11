// Scans a built buyer package for content that must never leave this repository.
//
// The bundle manifest in sdk-verify.cjs answers "are these the files we meant to
// ship, unmodified". It cannot answer "should any of them have been shipped at
// all" — a file listed in sdk-files.cjs passes verification by definition. This
// is the second question, and it is the one that matters before a package is
// handed to somebody outside the project.
//
//   node tools/package-scan.cjs <bundle-directory> [--json]
//
// Exits non-zero on any finding. Every rule below exists because the thing it
// looks for would be a real disclosure, not because it is tidy.
const fs=require('node:fs'),path=require('node:path');

// Image/video/geometry containers. A buyer package is source and documentation;
// there is no legitimate reason for a photograph or a mesh to be inside one.
const BINARY_EXT=/\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|mp4|mov|webm|avi|ply|obj|stl|glb|gltf|fbx|dae|pcd|npy|npz)$/i;
// Leading bytes, for a file that carries an image regardless of what it is named.
const MAGIC=[['PNG',Buffer.from([0x89,0x50,0x4e,0x47])],['JPEG',Buffer.from([0xff,0xd8,0xff])],
  ['GIF',Buffer.from('GIF8')],['BMP',Buffer.from('BM')],['ZIP/office',Buffer.from([0x50,0x4b,0x03,0x04])]];
// ISO-BMFF (HEIC, MP4) puts its brand at offset 4, not 0.
const FTYP=Buffer.from('ftyp');

const SECRETS=[
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/,'private key block'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,'JWT'],
  [/\bsk_(live|test)_[A-Za-z0-9]{16,}/,'Stripe secret key'],
  [/\bAKIA[0-9A-Z]{16}\b/,'AWS access key id'],
  [/\bghp_[A-Za-z0-9]{30,}\b/,'GitHub token'],
  [/\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,'assigned credential'],
  [/postgres(ql)?:\/\/[^\s'"]*:[^\s'"@]+@/,'database URL with password'],
];

// Identifiers that belong to real, live records or to a project this package has no
// business referencing. Exact strings, not heuristics — and deliberately NOT written
// here: this file ships inside the package, and a hardcoded list would publish the
// very identifiers it exists to keep out. tools/package-scan-identifiers.json stays
// in the source repository and is read when present.
//
// A shipped copy therefore runs with this rule switched off, and says so rather than
// reporting a clean result it did not actually check.
const IDENTIFIER_FILE=path.join(__dirname,'package-scan-identifiers.json');
const LIVE=(()=>{
  if(!fs.existsSync(IDENTIFIER_FILE))return null;
  try{
    const parsed=JSON.parse(fs.readFileSync(IDENTIFIER_FILE,'utf8'));
    if(!Array.isArray(parsed.identifiers))throw new Error('no identifiers array');
    return parsed.identifiers;
  }catch(error){
    // A malformed list must not silently degrade to "nothing to check".
    throw new Error('package-scan-identifiers.json is present but unreadable: '+error.message);
  }
})();

// Raw observation payloads: the arrays a scan produces, not the code that makes them.
const CAPTURE=[
  [/"(landmarks|worldLandmarks|vertices|contours|maskData|silhouette)"\s*:\s*\[\s*[-\d[{]/,'serialized capture geometry'],
];

function walk(dir,base,out){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name),rel=base?base+'/'+entry.name:entry.name;
    if(entry.isSymbolicLink())out.push({rel,full,symlink:true});
    else if(entry.isDirectory())walk(full,rel,out);
    else out.push({rel,full,symlink:false});
  }
  return out;
}

// Scanning a listed subset instead of a whole directory. In the development tree the
// question is not "is this directory clean" — it is not, it holds the whole repository —
// but "would the files this package ships be clean". A file that is listed and absent is
// itself a finding: a shorter scan must never read as a cleaner one.
function listed(dir,rels){
  const out=[],missing=[];
  for(const rel of rels){
    const full=path.join(dir,rel);
    let stat;
    try{stat=fs.lstatSync(full);}catch{missing.push(rel);continue;}
    if(stat.isSymbolicLink())out.push({rel,full,symlink:true});
    else if(stat.isFile())out.push({rel,full,symlink:false});
    else missing.push(rel);
  }
  return {out,missing};
}

// options.only restricts the scan to those repository-relative paths. Omit it to walk
// the whole directory, which is what a shipped bundle is checked with.
function scan(dir,options){
  if(!fs.existsSync(dir))throw new Error('No such package directory: '+dir);
  const only=options&&options.only;
  const subset=only?listed(dir,only):null;
  const files=subset?subset.out:walk(dir,'',[]);
  const findings=[];
  if(subset)for(const rel of subset.missing)findings.push({file:rel,rule:'missing',detail:'listed in the bundle file list but absent from this tree'});
  for(const file of files){
    const add=(rule,detail)=>findings.push({file:file.rel,rule,detail});
    if(file.symlink){add('symlink','packages must be self-contained');continue;}
    // A dot-prefixed segment anywhere in the path: .env, .git, .npmrc, .DS_Store.
    const dotted=file.rel.split('/').find(s=>s.startsWith('.'));
    if(dotted)add('dotfile',dotted);
    if(BINARY_EXT.test(file.rel))add('binary asset','extension');
    const bytes=fs.readFileSync(file.full);
    for(const [name,sig] of MAGIC)if(bytes.subarray(0,sig.length).equals(sig))add('binary asset',name+' header');
    if(bytes.length>=12&&bytes.subarray(4,8).equals(FTYP))add('binary asset','ISO-BMFF (HEIC/MP4) header');
    // Text rules only apply to text. A NUL byte in the first 4KB means it is not.
    if(bytes.subarray(0,4096).includes(0))continue;
    const text=bytes.toString('utf8');
    for(const [re,name] of SECRETS)if(re.test(text))add('secret',name);
    if(LIVE)for(const [needle,name] of LIVE)if(text.includes(needle))add('live identifier',name+' ('+needle+')');
    for(const [re,name] of CAPTURE)if(re.test(text))add('capture data',name);
  }
  // liveIdentifiersChecked is part of the result on purpose: a caller must be able to
  // tell a clean scan from a scan that skipped a rule.
  return {directory:path.resolve(dir),scanned:files.length,ok:findings.length===0,liveIdentifiersChecked:LIVE!==null,findings};
}

if(require.main===module){
  try{
    const args=process.argv.slice(2),json=args.includes('--json'),dir=args.find(a=>!a.startsWith('--'));
    if(!dir)throw new Error('Usage: node tools/package-scan.cjs <bundle-directory> [--json]');
    const result=scan(dir);
    if(json)console.log(JSON.stringify(result,null,2));
    else{
      console.log('scanned '+result.scanned+' files in '+result.directory);
      for(const f of result.findings)console.log('  FAIL  '+f.file+'  ['+f.rule+'] '+f.detail);
      if(!result.liveIdentifiersChecked)console.log('  NOTE  live-identifier rule not run: tools/package-scan-identifiers.json is absent (expected in a shipped package)');
      console.log(result.ok?'clean: no excluded content found':result.findings.length+' finding(s)');
    }
    if(!result.ok)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
module.exports={scan};
