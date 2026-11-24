const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {transformSync}=require('@babel/core');
const filename=path.resolve(__dirname,'../../src/routes/api/public/login.js');
const code=transformSync(fs.readFileSync(filename,'utf8'),{filename,babelrc:false,configFile:false,
 plugins:['@babel/plugin-transform-modules-commonjs']}).code;
async function scenario(user,password='correct',attempts=1,eligible=true,sessionVersion=user?.session_version){
 let verifies=0,identities=0,regenerations=0,saves=0,queries=0,registered=0,cleared=0;
 const exports={},context={exports,require(name){
  if(name==='argon2')return{verify:async()=>{verifies++;return password==='correct';}};
  if(name==='../../../db')return{query:async()=>{queries++;return{rows:user?[user]:[]};}};
  if(name==='../../../security/account')return{ACCOUNTING_ONLY_PASSWORD:'!accounting-only!'};
  if(name==='../../../security/login-attempts')return{
   loginOrigin:()=> 'local',registerLoginAttempt:async()=>{registered++;return{blocked:attempts>5};},
   clearLoginAttempt:async()=>{cleared++;}
  };
  if(name==='../../../security/identity')return{
   identity:async()=>{identities++;return eligible?{user_id:user.user_id,session_version:sessionVersion,is_admin:false,capabilities:[]}:null;},
   regenerate:async()=>{regenerations++;},saveSession:async()=>{saves++;}
  };
  throw Error('Unexpected dependency: '+name);
 }};
 vm.runInNewContext(code,context,{filename});
 const req={body:{username:'participant',password},socket:{remoteAddress:'local'},session:{}},res={statusCode:200,json(value){this.body=value;},setHeader(){}};
 await exports.post(req,res);
 return{status:res.statusCode,body:JSON.parse(JSON.stringify(res.body)),verifies,identities,regenerations,saves,queries,registered,cleared,session:req.session};
}
(async()=>{
 const disabled=await scenario({user_id:101,password_hash:'!accounting-only!'});
 const missing=await scenario(null);
 assert.strictEqual(disabled.status,401);
 assert.deepStrictEqual(disabled.body,missing.body);
 for(const key of['verifies','identities','regenerations','saves','cleared'])assert.strictEqual(disabled[key],0);
 assert.deepStrictEqual(disabled.session,{});
 const valid=await scenario({user_id:2,password_hash:'normal-password-hash'});
 assert.strictEqual(valid.status,200);
 for(const key of['verifies','identities','regenerations','saves','registered','cleared'])assert.strictEqual(valid[key],1);
 const changed=await scenario({user_id:2,password_hash:'normal-password-hash'},'correct',1,false);
 assert.strictEqual(changed.status,401);assert.strictEqual(changed.regenerations,0);
 const refreshed=await scenario({user_id:2,password_hash:'normal-password-hash',session_version:1},'correct',1,true,2);
 assert.strictEqual(refreshed.status,401);assert.strictEqual(refreshed.regenerations,0);
 const wrong=await scenario({user_id:2,password_hash:'normal-password-hash'},'wrong');
 assert.strictEqual(wrong.status,401);assert.deepStrictEqual(wrong.body,missing.body);
 const limited=await scenario({user_id:101,password_hash:'!accounting-only!'},'correct',6);
 assert.strictEqual(limited.status,429);assert.strictEqual(limited.verifies,0);
 const invalid=await scenario({user_id:101,password_hash:'!accounting-only!'},'');
 assert.strictEqual(invalid.status,400);assert.strictEqual(invalid.queries,0);assert.strictEqual(invalid.registered,0);
 console.log(JSON.stringify({status:'passed',scenarios:8,real_database_writes:0}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
