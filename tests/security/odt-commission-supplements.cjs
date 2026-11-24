const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {transformSync}=require('@babel/core'),svelte=require('svelte/compiler');
const root=path.resolve(__dirname,'../..');
function transformed(relative){const file=path.join(root,relative);return transformSync(fs.readFileSync(file,'utf8'),{filename:file,babelrc:false,configFile:false,plugins:['@babel/plugin-transform-modules-commonjs']}).code;}
const helper={};vm.runInNewContext(transformed('src/lib/odt-commission-supplements.js'),{exports:helper});
(async()=>{
 const calls=[];const empty=await helper.commissionSupplements({query:async(text,args)=>{calls.push({text,args});return{rows:[{available:null}]};}},273);
 assert.strictEqual(empty.length,0);assert.strictEqual(calls.length,1);
 assert(calls[0].text.includes('mauro100_supplement16_outcomes')&&calls[0].text.includes('mauro100_supplement16_runs'));
 assert(calls[0].text.includes('has_schema_privilege')&&calls[0].text.includes('has_table_privilege'));
 calls.length=0;
 const sample={id_odt:273,recipient_user_id:100,percent:'0.05000',amount:'174.5630000000',currency:'USD',actual_event_date:null};
 const present=await helper.commissionSupplements({query:async(text,args)=>{calls.push({text,args});return{rows:args?[sample]:[{available:true}]};}},273);
 assert.strictEqual(present[0],sample);assert.strictEqual(calls[1].args[0],273);
 assert(calls.every(c=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|CREATE)/i.test(c.text)));
 assert(!calls[1].text.includes('password')&&!calls[1].text.includes('email'));
 const historical={id_odt:273,source_id:'historical:16',recipient_user_id:5,role:'operative',percent:'0.10000',amount:'10.00',currency:'USD'};
 for(const legacyAvailable of [false,true]){
  const historicalCalls=[];
  const credits=await helper.commissionSupplements({query:async(text,args)=>{
   historicalCalls.push({text,args});
   if(!args)return{rows:[{available:legacyAvailable,historical_available:true}]};
   return{rows:[text.includes('FROM public.profit_supplement_credits')?historical:sample]};
  }},273);
  assert.strictEqual(credits.length,legacyAvailable?2:1);
  assert.strictEqual(credits[credits.length-1],historical);
  const historicalQuery=historicalCalls[historicalCalls.length-1];
  assert.strictEqual(historicalQuery.args[0],273);
  assert(historicalQuery.text.includes('p.id_currency=s.id_currency'));
 }
 for(const kind of['anonymous','denied','invalid','inaccessible','authorized']){
  let supplements=0,body,res={json(v){body=v;}};const exports={};
  const summaryError=Object.assign(Error('No access'),{code:'42501'});
  vm.runInNewContext(transformed('src/routes/api/public/odt_closure_resume/[id_odt].js'),{exports,require(name){
   if(name.endsWith('/odt-settlement-data'))return{settlementDetails:async()=>({parts:[]})};
   if(name.endsWith('/odt-commission-supplements'))return{commissionSupplements:async()=>{supplements++;return[sample];}};
   if(name.endsWith('/odt-payment-data'))return{paymentSummary:async()=>{if(kind==='inaccessible')throw summaryError;return{};},paymentError:(r)=>{r.statusCode=403;return r.json({error:'No access'});}};
   if(name.endsWith('/odt-closure'))return{validId:v=>v==='273'};
   if(name.endsWith('/db'))return{pool:{},sql:async()=>({rows:[{id_odt:273}]})};
   throw Error('Unexpected import '+name);
  }});
  await exports.get({params:{id_odt:kind==='invalid'?'bad':'273'},session:kind==='anonymous'?null:{user:{user_id:1}},authorized:kind!=='denied'},res);
  assert.strictEqual(supplements,kind==='authorized'?1:0);
  if(kind==='authorized')assert.strictEqual(body.commission_supplements[0],sample);
  else assert.strictEqual(res.statusCode,kind==='anonymous'?401:kind==='invalid'?400:403);
 }
 svelte.compile(fs.readFileSync(path.join(root,'src/components/Closed_odts_review.svelte'),'utf8'),{generate:'ssr',filename:'Closed_odts_review.svelte'});
 svelte.compile(fs.readFileSync(path.join(root,'src/components/Odt_settlement_history.svelte'),'utf8'),{generate:'ssr',filename:'Odt_settlement_history.svelte'});
 console.log(JSON.stringify({status:'passed',access_scenarios:5,optional_schema_scenarios:4,read_only:true,svelte_compiled:true,database_writes:0}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
