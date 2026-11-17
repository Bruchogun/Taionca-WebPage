const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {transformSync}=require('@babel/core'),svelte=require('svelte/compiler');
const filename=path.resolve(__dirname,'../../src/routes/api/public/loans.js');
const code=transformSync(fs.readFileSync(filename,'utf8'),{filename,babelrc:false,configFile:false,
 plugins:['@babel/plugin-transform-modules-commonjs']}).code;
async function scenario(user){
 const calls=[],exports={};let body;
 vm.runInNewContext(code,{exports,require(name){
  assert.strictEqual(name,'../../../db');
  return{query:async(sql,parameters)=>{
   calls.push({sql,parameters});
   return{rows:sql.includes('SELECT u.user_id')?[{user_id:2,name:'Mauro',lastname:'President'}]:[]};
  }};
 }},{filename});
 await exports.get({user},{json(value){body=value;}});
 return{calls,body};
}
(async()=>{
 for(const user of[
  {user_id:1,is_admin:true,capabilities:[]},
  {user_id:4,is_admin:false,capabilities:['finance.read']},
  {user_id:4,is_admin:false,capabilities:['finance.loans']},
  {user_id:4,is_admin:false,capabilities:[]}
 ]){
  const result=await scenario(user),readAll=user.is_admin||user.capabilities.some(c=>['finance.read','finance.loans'].includes(c));
  assert.strictEqual(result.calls.length,4);
  for(const call of result.calls){assert.strictEqual(call.parameters[0],readAll);assert.strictEqual(call.parameters[1],user.user_id);}
  const selection=result.calls[3].sql;
  assert(selection.includes('($1::boolean OR u.user_id=$2)'));
  assert(selection.includes('u.special_user=false')&&selection.includes('FROM loans_registers')&&selection.includes('FROM company_debts'));
  assert(!selection.includes('password_hash')&&!selection.includes('email'));
  assert.strictEqual(result.body.loan_users[0].user_id,2);
 }
 svelte.compile(fs.readFileSync(path.resolve(__dirname,'../../src/components/Loans.svelte'),'utf8'),{generate:'ssr',filename:'Loans.svelte'});
 svelte.compile(fs.readFileSync(path.resolve(__dirname,'../../src/routes/index.svelte'),'utf8'),{generate:'ssr',filename:'index.svelte'});
 svelte.compile(fs.readFileSync(path.resolve(__dirname,'../../src/routes/_layout.svelte'),'utf8'),{generate:'ssr',filename:'_layout.svelte'});
 svelte.compile(fs.readFileSync(path.resolve(__dirname,'../../src/components/Current_balances.svelte'),'utf8'),{generate:'ssr',filename:'Current_balances.svelte'});
 console.log(JSON.stringify({status:'passed',authorization_scenarios:4,svelte_compiled:true,database_writes:0}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
