const assert=require('assert'),fs=require('fs'),path=require('path'),vm=require('vm');
const {transformSync}=require('@babel/core'),svelte=require('svelte/compiler'),repo=path.resolve(__dirname,'../..');
const filename=path.join(repo,'src/routes/api/public/unassigned_company_purchases.js');
const compile=file=>transformSync(fs.readFileSync(file,'utf8'),{filename:file,babelrc:false,configFile:false,plugins:['@babel/plugin-transform-modules-commonjs']}).code;
const policy=JSON.parse(fs.readFileSync(path.join(repo,'src/security/policy.json'))),accessExports={};
vm.runInNewContext(compile(path.join(repo,'src/security/access.js')),{exports:accessExports,require(name){assert.strictEqual(name,'./policy.json');return policy;}});
const source='source-spreadsheet',sourceKey=cell=>'1475939614:A:C:'+cell;
const base={owner_user_id:100,owner_name:'Mauro Alejandro',owner_lastname:'D Agostini',amount:'99.5000000000',currency_code:'EUR',source_sheet_id:1475939614,source_row:6,source_cell:'C6',assignment_status:'awaiting_odt',source_spreadsheet_id:source,source_key:sourceKey('C6'),source_evidence_hash:'a'.repeat(64)};
const legacy=[
 {...base,id_purchase:'purchase-a',source_type:'ledger_import'},
 {...base,id_purchase:'purchase-b',owner_user_id:2,owner_name:'Mauro',amount:'3.0100000000',source_key:sourceKey('C7'),source_cell:'C7',source_row:7,source_type:'ledger_import'}
];
const modern=[
 {...base,id_purchase:'migrador-a',source_type:'taionca_import',source_sheet_id:'1475939614',source_row:'6'},
 {...base,id_purchase:'migrador-c',source_key:sourceKey('C8'),source_cell:'C8',source_row:'8',source_type:'taionca_import'},
 {...base,id_purchase:'migrador-d',source_spreadsheet_id:'different-spreadsheet',source_row:'6',source_type:'taionca_import'},
 {...base,id_purchase:'migrador-e',owner_user_id:2,source_key:sourceKey('C9'),source_cell:'C9',source_row:'9',source_type:'taionca_import'}
];
const load=(query)=>{const exports={};vm.runInNewContext(compile(filename),{exports,require(name){if(name==='../../../security/access')return accessExports;assert.strictEqual(name,'../../../db');return{query};}},{filename});assert.deepStrictEqual(Object.keys(exports),['get']);return exports.get;};
async function scenario(user,legacy_available=true,migrador_available=false){const calls=[];let body;const res={statusCode:200,json(value){body=value;}};
 const get=load(async(sql,parameters)=>{calls.push({sql,parameters});assert(!/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|CALL)\b/i.test(sql),'Readonly endpoint cannot write.');if(sql.includes('to_regclass'))return{rows:[{legacy_available,migrador_available}]};const data=sql.includes('FROM ledger_import.')?legacy:modern;return{rows:data.filter(r=>parameters[0]||r.owner_user_id===parameters[1]).map(r=>({...r}))};});
 await get({user,query:{owner_user_id:100} },res);return{calls,body,status:res.statusCode};
}
const users=[
 {user_id:1,is_admin:true,capabilities:[]},
 {user_id:4,is_admin:false,capabilities:['finance.read']},
 {user_id:4,is_admin:false,capabilities:['finance.loans']},
 {user_id:100,is_admin:false,capabilities:[]},
 {user_id:2,is_admin:false,capabilities:[]},
 {user_id:7,is_admin:false}
 ];
(async()=>{let scenarios=0;for(const [hasLegacy,hasMigrador] of[[false,false],[true,false],[false,true],[true,true]])for(const user of users){
 const result=await scenario(user,hasLegacy,hasMigrador),readAll=accessExports.allows(user,['finance.read','finance.loans']);
 assert.strictEqual(result.status,200);assert.strictEqual(result.calls.length,1+Number(hasLegacy)+Number(hasMigrador));
 for(const call of result.calls.slice(1)){
  assert.deepStrictEqual(Array.from(call.parameters),[readAll,user.user_id]);assert(!call.sql.includes('SELECT *'));
  for(const name of['native_footprint','id_company_debt_movement','id_balance_register','password_hash'])assert(!call.sql.includes(name),'Private audit/auth fields must not be exposed.');
  assert(!/SELECT\s+(?:o\.)?(?:payload|outcome|footprint)\b/.test(call.sql),'Do not expose whole audit payloads.');
  if(call.sql.includes('FROM ledger_import.')){assert(call.sql.includes('($1::boolean OR p.owner_user_id=$2)'));assert(call.sql.includes("p.assignment_status='awaiting_odt'"));}
  else{assert(call.sql.includes('($1::boolean OR u.user_id=$2)'));assert(call.sql.includes("o.payload->>'kind'='owner_purchase'"));assert(call.sql.includes("o.outcome->>'kind'='owner_purchase'"));assert(call.sql.includes("'{ownerPurchase,assignmentStatus}'='awaiting_odt'"));assert(call.sql.includes("'{ownerPurchase,refundable}'='true'"));assert(call.sql.includes('JOIN taionca_import.sources'));assert(call.sql.includes("s.source_evidence_hash=o.payload #>> '{sourceEvidence,0,evidenceHash}'"));assert(call.sql.includes("s.source_key=o.payload #>> '{sourceKeys,0}'"));}
 }
 const expected=new Map();for(const row of[...(hasLegacy?legacy:[]),...(hasMigrador?modern:[])].filter(r=>readAll||r.owner_user_id===user.user_id))expected.set(JSON.stringify([row.source_spreadsheet_id,row.source_key]),row);
 const actual=result.body.unassigned_company_purchases;
 assert.strictEqual(actual.length,expected.size);assert.strictEqual(result.body.unassigned_purchases_available,hasLegacy||hasMigrador);
 for(const row of actual){assert.strictEqual(row.id_purchase,expected.get(JSON.stringify([row.source_spreadsheet_id,row.source_key])).id_purchase);assert(Number.isInteger(row.source_sheet_id));assert(Number.isInteger(row.source_row));assert(/^[a-f0-9]{64}$/.test(row.source_evidence_hash));assert(readAll||row.owner_user_id===user.user_id);}
 if(hasLegacy&&hasMigrador&&readAll){assert(!actual.some(r=>r.id_purchase==='purchase-a'),'Same spreadsheet/cell is only shown once.');assert(actual.some(r=>r.id_purchase==='migrador-c'),'Equal amount in a different cell is independent.');assert(actual.some(r=>r.id_purchase==='migrador-d'),'Same key in a different spreadsheet is independent.');}
 assert(actual.every((row,i)=>i===0||actual[i-1].source_row<=row.source_row));scenarios++;
 }
 for(const [hasLegacy,hasMigrador] of[[false,false],[true,false],[false,true],[true,true]])for(const user of[undefined,{user_id:'100',capabilities:[]},{user_id:0,capabilities:[]}]){const result=await scenario(user,hasLegacy,hasMigrador);assert.strictEqual(result.status,401);assert.strictEqual(result.calls.length,0);assert(result.body.error);scenarios++;}
 assert.strictEqual(accessExports.apiAccess('GET','/api/public/unassigned_company_purchases'),'authenticated');for(const method of['POST','PUT','PATCH','DELETE'])assert.strictEqual(accessExports.apiAccess(method,'/api/public/unassigned_company_purchases'),undefined);
 const component=fs.readFileSync(path.join(repo,'src/components/Loans.svelte'),'utf8');
 svelte.compile(component,{generate:'ssr',filename:'Loans.svelte'});
 assert.match(component,/fetch\('\/api\/public\/unassigned_company_purchases'\)/);
 assert.match(component,/owner_user_id\s*===\s*userId/);
 assert.match(component,/merchant_payment:\s*'Pagado por propietario'/);
 assert.match(component,/value:\s*'Pago al comercio'/);
 assert(component.includes('Compras de Taionca pendientes de ODT'));
 assert(component.includes('purchase-history')&&/overflow-x:\s*auto/.test(component));
 assert.match(component,/amount:\s*\{\s*value:\s*purchase\.amount,\s*currency:\s*purchase\.currency_code\s*\}/);
 assert.match(component,/\{\s*\.\.\.amountColumn,\s*value:\s*'Importe'\s*\}/);
 assert(!component.includes('method:'));
 assert(!component.includes('id_company_debt_movement')||component.includes('company_debt_registers'));
 let databaseSmoke=[];
 if(process.argv.includes('--database-smoke')){
  require('dotenv').config({path:path.join(repo,'.env')});const {Client}=require('pg');
  for(const database of['taionca_migracion_20261010','taionca_migrador_20261013_tool']){
   const url=new URL(process.env.DATABASE_URL);url.pathname='/'+database;const client=new Client({connectionString:url.toString()});await client.connect();
   try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const identity=(await client.query('SELECT current_database() database,inet_server_port() port,host(inet_server_addr()) host')).rows[0];assert.strictEqual(identity.database,database);assert.strictEqual(identity.port,55432);assert(['127.0.0.1','::1'].includes(identity.host));
    const get=load((sql,p)=>client.query(sql,p)),observed=[];
    for(const user of[{user_id:1,is_admin:true,capabilities:[]},{user_id:100,is_admin:false,capabilities:[]},{user_id:2,is_admin:false,capabilities:[]}]){let body;await get({user},{json(value){body=value;}});assert.strictEqual(body.unassigned_purchases_available,true);assert(body.unassigned_company_purchases.every(r=>accessExports.allows(user,['finance.read','finance.loans'])||r.owner_user_id===user.user_id));observed.push({user_id:user.user_id,rows:body.unassigned_company_purchases.length});}
    databaseSmoke.push({database,read_only:true,observed});await client.query('ROLLBACK');
   }finally{await client.end();}
  }
 }
 console.log(JSON.stringify({status:'passed',authorization_and_schema_scenarios:scenarios,readonly_policy_methods:true,private_fields_not_selected:true,svelte_compiled:true,source_cell_not_amount_dedup:true,database_smoke:databaseSmoke,database_writes:0}));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
