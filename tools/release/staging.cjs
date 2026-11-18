'use strict';
// Source-only frozen staging bundle. No data, credentials, signing keys or startup.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
module.exports=function assembleStaging(repo,destination,manifest){
  const files={},root=path.join(destination,'staging');
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  function copy(source,relative,expected){
    if(fs.lstatSync(source).isSymbolicLink()||!fs.statSync(source).isFile())throw new Error('Staging source requires review');
    const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
    const sha256=hash(target);if(expected&&sha256!==expected)throw new Error('Frozen staging copy mismatch');
    files[relative]={bytes:fs.statSync(target).size,sha256};
  }
  for(const [relative,value] of Object.entries(manifest.runtime.files))copy(path.join(destination,'runtime',relative),relative,value.sha256);
  for(const [relative,value] of Object.entries(manifest.publicFiles))copy(path.join(destination,'public',relative),'src/public/'+relative,value.sha256);
  for(const relative of ['tools/staging/server.mjs','tools/staging/gateway.mjs','test/support/localStaging.mjs'])copy(path.join(repo,relative),relative);
  const trustedGuard=Object.fromEntries(['test/support/isolation-guard.cjs','test/support/isolation-policy.cjs','tools/test-audit/policy.cjs']
    .map(relative=>[relative,{sha256:hash(path.join(repo,relative))}]));
  return {entry:'tools/staging/server.mjs',files,trustedGuard,
    command:'node tools/staging/run.cjs --candidate [--smoke]',
    boundary:'Run through the original reviewed repository supervisor and guard; never start this entry directly. Uses existing local dependencies, disposable data and loopback providers. No production entry is executed.'};
};
