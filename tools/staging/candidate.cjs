'use strict';
// Fixed latest-candidate validation only; no CLI path overrides or data access.
if(process.env.WINLEW_TEST_ISOLATED==='1')throw new Error('Supervisor-only candidate validator');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
module.exports=function loadCandidate(repo){
  const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const pointer=JSON.parse(fs.readFileSync(path.join(repo,'.test-tmp/integration-final-artifact.json'),'utf8'));
  assert.equal(pointer.generator,'tools/release/package.cjs');assert.match(pointer.candidate,/^\.test-tmp\/winlew3-rc-[A-Za-z0-9]+$/);
  const artifact=path.join(repo,pointer.candidate),manifestFile=path.join(artifact,'manifest.json');
  function noLinks(file){for(let current=file;current!==repo;current=path.dirname(current)){
    assert.ok(current.startsWith(repo+path.sep));assert.equal(fs.lstatSync(current).isSymbolicLink(),false);
  }}
  noLinks(manifestFile);assert.equal(hash(manifestFile),pointer.manifestSha256);
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));assert.equal(manifest.staging.entry,'tools/staging/server.mjs');
  const root=path.join(artifact,'staging');
  function verify(){
    const inventory=[];
    function walk(directory,relative=''){
      noLinks(directory);
      for(const item of fs.readdirSync(directory,{withFileTypes:true})){
        const name=relative?relative+'/'+item.name:item.name,file=path.join(directory,item.name);
        assert.equal(item.isSymbolicLink(),false);
        if(item.isDirectory())walk(file,name);else{assert.equal(item.isFile(),true);inventory.push(name);}
      }
    }
    walk(root);assert.deepEqual(inventory.sort(),Object.keys(manifest.staging.files).sort(),'Frozen source additions/removals refused');
    for(const [relative,value] of Object.entries(manifest.staging.files)){
      assert.ok(!path.isAbsolute(relative)&&!relative.split(/[\\/]/).some(p=>p==='..'||p==='.'||p===''));
      const file=path.join(root,relative);noLinks(file);assert.equal(hash(file),value.sha256);
    }
    assert.deepEqual(Object.keys(manifest.staging.trustedGuard).sort(),['test/support/isolation-guard.cjs','test/support/isolation-policy.cjs','tools/test-audit/policy.cjs'].sort());
    for(const [relative,value] of Object.entries(manifest.staging.trustedGuard)){
      assert.ok(['test/support/isolation-guard.cjs','test/support/isolation-policy.cjs','tools/test-audit/policy.cjs'].includes(relative));
      const file=path.join(repo,relative);noLinks(file);assert.equal(hash(file),value.sha256,'Trusted original guard changed; rebuild candidate');
    }
  }
  verify();return {root,entry:path.join(root,manifest.staging.entry),candidate:pointer.candidate,manifestSha256:pointer.manifestSha256,verify};
};
