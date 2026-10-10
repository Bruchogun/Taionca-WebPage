const {test,expect}=require('@playwright/test');
const fs=require('fs'),vm=require('vm');
function transaction(pool){const context={pool};vm.runInNewContext(fs.readFileSync('src/lib/api-transaction.js','utf8').replace(/^import[^;]+;/,'').replace(/export /g,'')+';this.wrap=transaction;',context);return context.wrap;}
test('fallo al conectar devuelve error controlado y no ejecuta una escritura',async()=>{
 let executed=false,result;const res={json:v=>result=v};await transaction({connect:async()=>{throw Error('private connection details');}})(async()=>{executed=true;})({},res);
 expect(executed).toBe(false);expect(res.statusCode).toBe(500);expect(result).toEqual({error:'No se pudo completar la operación.'});
});
test('fallo de rollback conserva respuesta segura y libera la conexión',async()=>{
 let released=false,result;const calls=[],res={json:v=>result=v};const client={query:async sql=>{calls.push(sql);if(sql==='ROLLBACK')throw Error('lost connection');},release:()=>released=true};
 await transaction({connect:async()=>client})(async()=>{throw Error('secret database error');})({},res);
 expect(calls).toEqual(['BEGIN','ROLLBACK']);expect(released).toBe(true);expect(res.statusCode).toBe(500);expect(JSON.stringify(result)).not.toContain('secret');
});
