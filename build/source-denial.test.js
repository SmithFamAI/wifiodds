'use strict';
const assert=require('node:assert/strict');
const {get}=require('../scripts/update-unitedstarlink.js');
async function main(){
  const saved=global.fetch;
  try {
    for(const status of [401,403]) {
      let calls=0;
      global.fetch=async(url,options)=>{calls++;assert.equal(options.headers['User-Agent'],'wifiodds-daily/1.0 (+https://wifiodds.com/)');return new Response('error code: 1010\n',{status,headers:{server:'cloudflare','cf-ray':'offline-fixture-DEN'}});};
      await assert.rejects(get('https://source.invalid/api/data',true),new RegExp('HTTP '+status+'.*offline-fixture-DEN.*1010'));
      assert.equal(calls,1,'denied source must not be retried');
      console.log('PASS '+status+' stops after one request and preserves diagnostic metadata');
    }
    global.fetch=async()=>new Response('{"ok":true}',{status:200});
    assert.deepEqual(await get('https://source.invalid/api/data',true),{ok:true});
    console.log('PASS successful public source still parses');
  } finally {global.fetch=saved;}
  console.log('source denial controls: 3 passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
