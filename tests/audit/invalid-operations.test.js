const {test,expect}=require('@playwright/test');
const {login,query,createOdt}=require('../helpers/app');
const {account,income,balance}=require('../helpers/audit');
test.beforeEach(async({request})=>login(request));
for(const route of ['money_incomes','investments','give_loan','pay_loan','admin_expenses','general_expenses','transfer_entitys','exchange_currency','nueva_odt'])test('importe negativo/cero inválido sin cambios: '+route,async({request})=>{
 const before=(await query('SELECT count(*)::int n FROM balance_movements'))[0].n;
 for(const amount of ['-10','0','NaN']){
 const response=await request.post('/api/public/'+route,{data:{amount,expense:{amount},income:{amount}}});expect(response.status()).toBe(400);
 }
 expect((await query('SELECT count(*)::int n FROM balance_movements'))[0].n).toBe(before);
});
test('transferencia y cambio verifican las monedas reales frente a datos manipulados',async({request})=>{
 const a=await account(request),b=await account(request,3);await income(request,a,100);
 const fake={...b,id_currency:1,id_entity:1,amount:1};
 expect((await request.post('/api/public/transfer_entitys',{data:{amount:10,expense:{...a,id_entity:1},income:fake}})).status()).toBe(400);
 expect(await balance(a)).toBe(100);expect(await balance(b)).toBe(0);
 expect((await request.post('/api/public/exchange_currency',{data:{id_entity:1,expense:{...a,amount:10,id_currency:2},income:{...a,amount:400,id_currency:3}}})).status()).toBe(400);
});
test('un ingreso sin saldo asociado no crea un registro sin contabilizar',async({request})=>{
 const response=await request.post('/api/public/money_incomes',{data:{id_account:999999,id_entity:1,amount:10}});expect(response.status()).toBe(400);
});
for(const [route,method,redirect] of [['incomes','post','/money_incomes'],['recurrentExpenses','get','/gasto_admin']])test('operación obsoleta '+route+' informa sustituto',async({request})=>{
 const response=await request[method]('/api/public/'+route,method==='post'?{data:{}}:{});expect(response.status()).toBe(410);expect((await response.json()).redirect).toBe(redirect);
});
test('ingresos e inversiones conservan diez decimales incluso con enteros grandes',async({request})=>{
 const a=await account(request);const amount='123456789012345.1234567890';await income(request,a,amount);
 expect((await query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=1',[a.id_account]))[0].balance).toBe(amount);
 const response=await request.post('/api/public/investments',{data:{id_account:a.id_account,id_entity:1,amount:'0.0000000001',description:'Precisión'}});expect(response.status()).toBe(200);
 expect((await query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=1',[a.id_account]))[0].balance).toBe('123456789012345.1234567889');
});
test('inversión sin fondos devuelve error y revierte movimiento y registro',async({request})=>{
 const a=await account(request);const response=await request.post('/api/public/investments',{data:{id_account:a.id_account,id_entity:1,amount:1,description:'Sin fondos'}});expect(response.status()).toBe(400);
 expect(await query('SELECT * FROM investments WHERE id_account=$1',[a.id_account])).toEqual([]);expect(await balance(a)).toBe(0);
});
for(const admin_percent of [-0.1,1.1,null])test('porcentaje administrativo inválido '+admin_percent,async({request})=>{
 const odt=await createOdt();expect((await request.post('/api/public/update_admin_percent',{data:{id_odt:odt.id_odt,admin_percent}})).status()).toBe(400);expect(Number((await query('SELECT admin_percent FROM odts WHERE id_odt=$1',[odt.id_odt]))[0].admin_percent)).toBe(0.2);
});
