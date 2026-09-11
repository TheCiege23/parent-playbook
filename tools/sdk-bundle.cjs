const fs=require('node:fs'),path=require('node:path');
const {BUNDLE_FILES}=require('./sdk-files.cjs');
const {digest,verifyBundle}=require('./sdk-verify.cjs');
const root=path.join(__dirname,'..');
function buildBundle(destination){
  const source=fs.readFileSync(path.join(root,'js/body-sdk.mjs'),'utf8');
  const version=source.match(/SDK_VERSION = '(\d+\.\d+\.\d+)'/)?.[1];
  if(!version)throw new Error('SDK version is missing');
  const output=path.resolve(destination||path.join(root,'tools/sdk-releases','parent-playbook-sdk-'+version));
  if(fs.existsSync(output))throw new Error('Destination already exists; choose a new empty destination. Nothing was overwritten.');
  const readme=`# Parent Playbook browser SDK ${version}\n\nLocal experimental integration preview. This package contains source code and a loopback demo, not participant photos, geometry, saved assessments, accounts or database credentials.\n\n## Verify and run\n\nInstall a maintained Node.js runtime. No npm installation is needed for these scripts. From this folder, start with one command:\n\n\`\`\`sh\nnode tools/acceptance.cjs\n\`\`\`\n\nIt checks the manifest, scans for content that should never have been packaged, runs the contract suite against the shipped modules, replays every migration into a throwaway PostgreSQL cluster and runs the security suite as restricted roles, and confirms the bundled host serves modules correctly. Anything it cannot run on your machine reports SKIP with the reason instead of passing quietly, and the run closes by stating what a clean result does not establish. Read that part.\n\nThe individual commands remain available:\n\n\`\`\`sh\nnode tools/sdk-verify.cjs\nnode tools/sdk-demo.cjs 8774\n\`\`\`\n\nOpen http://127.0.0.1:8774/ in a supported browser. Use another port if that one is occupied. Select permissioned adult photos and enter measured height. Optional experimental surface processing requires four silhouette reviews. Cancel/Clear release this demo's working data. Nothing is uploaded or saved automatically.\n\n## Company integration\n\nSee BODY-SDK.md for the same-origin file layout, API examples, result contracts and host responsibilities. The js directory can be copied into a versioned location on your application origin. The package includes the roster-linked Supabase adapter and a separate adult-reference adapter, their required migrations, and the signed-in adult persistence example. Migrations are not applied automatically. The demo server is loopback-only and is not a production application or authenticated storage service.\n\nThe checksum manifest detects changed/missing files relative to this package. It is not signed, cannot establish trusted authorship, and can be replaced alongside modified files. Preserve a separately trusted copy of the manifest if checking a transferred package. Verification rejects extra files and symlinks.\n\n## External runtime dependencies and limits\n\nMediaPipe Tasks Vision 1.0.1 and the Pose Landmarker full float16 v1 model are downloaded from jsDelivr/Google at runtime. HEIC conversion additionally downloads the pinned heic-to 1.5.2 libheif build. These external assets are not bundled; this is not a fully offline engine. See BODY-SDK.md and HEIC-IMPORT.md for origins, browser/CSP requirements and dependency provenance. Including our adapter does not convey ownership of those dependencies or establish transferable rights to every model asset.\n\nOutputs remain provisional. Surface perimeters describe operator-selected or four-view pose-guided clothed contours; they are not validated anatomical girths. Anatomical accuracy, composition, maturation and FITMATCH equivalence are not established. This release passed a Parent Playbook production Windows Chrome scan, in-memory company save and direct JSON-download rehearsal. It has not passed buyer-host, production-backed company-record or physical-phone acceptance. The host owns authorization, participant linkage, storage, retention and deletion.\n`;
  const currentReadme=readme.replace('This release passed a Parent Playbook production Windows Chrome scan, in-memory company save and direct JSON-download rehearsal. It has not passed buyer-host, production-backed company-record or physical-phone acceptance.',
    'This release passed a Parent Playbook production Windows Chrome scan, persistent organization-owned adult save/reopen/export and direct JSON-download rehearsal. It has not passed buyer-host, physical-phone, backup-deletion or restore acceptance.');
  // The in-archive copy of BODY-SDK.md must not carry the handoff snapshot line: it
  // names an archive and its SHA-256, and no package should certify itself. Replacing
  // the line with fixed text also makes the archive's contents independent of what that
  // line says, so the hash can be recorded in the repository copy afterwards without
  // invalidating the archive it describes.
  const SNAPSHOT_LINE=/^The current buyer handoff snapshot is .*$/m;
  const guideSource=fs.readFileSync(path.join(root,'BODY-SDK.md'),'utf8');
  if(!SNAPSHOT_LINE.test(guideSource))throw new Error('BODY-SDK.md has no handoff snapshot line to strip; the self-description guard is no longer doing anything. Restore the line or update the pattern deliberately.');
  const guide=guideSource.replace(SNAPSHOT_LINE,'This archive does not record its own file count or checksum. Both are published alongside the archive, so a transferred package is checked against something other than itself.');
  // Snapshot only the explicit files before creating the destination.
  const files=BUNDLE_FILES.map(name=>({name,bytes:name==='README.md'?Buffer.from(currentReadme):name==='BODY-SDK.md'?Buffer.from(guide):fs.readFileSync(path.join(root,name))}));
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.mkdirSync(output);
  for(const file of files){const target=path.join(output,file.name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,file.bytes,{flag:'wx'});}
  const manifest={schema:'PP_BODY_SDK_BUNDLE_V1',sdkVersion:version,createdAt:new Date().toISOString(),
    files:files.map(f=>({path:f.name,bytes:f.bytes.length,sha256:digest(f.bytes)})),
    limitations:'Unsigned file integrity manifest. External runtime dependencies are not bundled. No real-person accuracy or production acceptance is implied.'};
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  const check=verifyBundle(output);if(!check.ok)throw new Error('Bundle verification failed: '+check.errors.join('; '));
  return {directory:output,...check};
}
if(require.main===module){try{console.log(JSON.stringify(buildBundle(process.argv[2]),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
// One hash over the whole payload: every path and the digest of its contents, in bundle
// order. Published beside the archive so a reader — or a test — can tell a stale recorded
// checksum from a current one WITHOUT rebuilding and re-zipping.
//
// The ZIP's own SHA-256 cannot answer that question. Compress-Archive stamps timestamps, so
// zipping identical files twice gives two different hashes; the archive checksum proves a
// received file is intact but says nothing about whether the payload has moved on. This
// does, and it is what caught the v10 record going stale after three bundled tools changed
// under it with nothing flagging the published hash as wrong.
//
// It builds through buildBundle() into a temp directory rather than re-deriving the file
// bytes, because two of them are transformed on the way in — README.md is generated, and
// BODY-SDK.md has its self-describing snapshot line replaced. A second implementation of
// those transformations would be free to drift from the real one, which is the failure this
// is meant to detect rather than reproduce.
function bundleDigest(){
  const os=require('node:os');
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pp-bundle-digest-'));
  try{
    const dir=path.join(tmp,'pkg');
    buildBundle(dir);
    const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
    // createdAt is deliberately not in the hash: it changes every build and describes when
    // the package was made, not what is in it.
    return digest(Buffer.from(manifest.files.map(f=>f.path+' '+f.sha256).join('\n')));
  }finally{ fs.rmSync(tmp,{recursive:true,force:true}); }
}
module.exports={buildBundle,bundleDigest};
