const {test,expect}=require('@playwright/test');
const {login,query,createOdt}=require('../helpers/app');
const {post,unique,account,income,balance,item}=require('../helpers/audit');
test.beforeEach(async({request})=>login(request));
for(const type of ['spendable','no_spendable']){
 test('inventario '+type+': alta, catálogos, compra, consumo, control y rechazo de stock insuficiente',async({request})=>{
    const product=await item(request,type),a=await account(request);await income(request,a,100,3);await income(request,a,100);
    const sid=product['id_'+type+'_stock'],iid=product['id_'+type+'_item'];
    const catalogs=await (await request.get('/api/public/'+type+'_products')).json();expect(catalogs[type+'_products'].some(p=>p.code===product.code)).toBe(true);
    const brands=await (await request.get('/api/public/brands')).json();expect(brands.brands.some(b=>b.name===product.brand)).toBe(true);
    await post(request,type+'_inv_odt_incomes',{id_spendable_stock:sid,id_account:a.id_account,quantity:10,cost:40,id_item:iid});
    expect(await balance(a,3)).toBe(60);
    let stock=(await query(`SELECT * FROM ${type}_stocks JOIN ${type}_items USING(id_${type}_item) WHERE id_${type}_stock=$1`,[sid]))[0];expect(Number(stock.amount)).toBe(10);expect(Number(stock.cost)).toBe(4);expect(Number(stock.price)).toBe(5);
    const odt=await createOdt();await post(request,type+'_inv_odt_expenses',{id_spendable_stock:sid,id_odt:odt.id_odt,amount:3,currency_code:'usd',description:'Consumo de prueba'});
    expect(Number((await query(`SELECT amount FROM ${type}_stocks WHERE id_${type}_stock=$1`,[sid]))[0].amount)).toBe(7);
    const moves=await query(`SELECT sum(m.amount)::float total FROM balance_movements m WHERE type_movement_category=$1 AND id_movement_category IN(SELECT id_${type}_inv_odt_expense FROM ${type}_inv_odt_expenses WHERE id_odt=$2)`,[type+'_inv_odt_expenses',odt.id_odt]);expect(moves[0].total).toBe(0);
    const list=await (await request.get('/api/public/all_items')).json();expect(list[type+'_stocks'].find(s=>s['id_'+type+'_stock']===sid)[type+'_stocks_amount']).toBe('7.0000000000');
    const table=await request.get('/api/public/all_items_table');expect(table.status()).toBe(200);expect((await table.json()).itemsToList.some(s=>s.code===product.code)).toBe(true);
    const bad=await request.post('/api/public/'+type+'_inv_odt_expenses',{data:{id_spendable_stock:sid,id_odt:odt.id_odt,amount:8,currency_code:'usd',description:'Exceso'}});expect(bad.status()).toBe(400);
    expect(Number((await query(`SELECT amount FROM ${type}_stocks WHERE id_${type}_stock=$1`,[sid]))[0].amount)).toBe(7);
 });
 test('reposición '+type+' revierte sin fondos y exige cantidad positiva',async({request})=>{
    const product=await item(request,type),a=await account(request),sid=product['id_'+type+'_stock'];
    const data={id_spendable_stock:sid,id_account:a.id_account,quantity:5,cost:20,id_item:product['id_'+type+'_item']};
    for(const invalid of [data,{...data,quantity:0},{...data,quantity:-5}])expect((await request.post('/api/public/'+type+'_inv_odt_incomes',{data:invalid})).status()).toBe(400);
    expect(Number((await query(`SELECT amount FROM ${type}_stocks WHERE id_${type}_stock=$1`,[sid]))[0].amount)).toBe(0);
    expect(await query(`SELECT * FROM ${type}_inv_odt_incomes WHERE id_${type}_stock=$1`,[sid])).toEqual([]);
 });
}
test('cotización guarda gastos generales y ambos inventarios, calcula monto y origina ODT',async({request})=>{
 const a=await item(request),b=await item(request,'no_spendable');
 const body=await post(request,'create_quotation',{currency:{id_currency:1,code:'usd'},id_client:1,description:unique('Cotización'),general_expenses:[{amount:100,quantity:2,currency:{id_currency:1,code:'usd'},measure:{value:1},description:'Servicio'}],inv_expenses:[{item:a,amount:3,quantity:2,description:'Consumible'},{item:b,amount:4,quantity:5,description:'Herramienta'}]});
 expect(body.total_general_expenses).toBe(100);expect(body.total_inv_expenses).toBe(26);expect(body.contract_amount).toBe(157.5);
 const review=await (await request.get('/api/public/quotations_review/'+body.id_quotation)).json();expect(review.quotation_general_expenses.length).toBe(1);expect(review.quotation_spendable_inv_expenses.length).toBe(1);expect(review.quotation_no_spendable_inv_expenses.length).toBe(1);
 const list=await (await request.get('/api/public/quotations')).json();expect(Number(list.quotations.find(q=>q.id_quotation===body.id_quotation).amount)).toBe(157.5);
 const odt=await post(request,'nueva_odt',{id_client:1,id_currency:1,id_entity:1,id_quotation:body.id_quotation,amount:body.contract_amount,admin_percent:0.2,description:'Derivada'});
 expect((await query('SELECT id_quotation FROM odts WHERE id_odt=$1',[odt.odt.id_odt]))[0].id_quotation).toBe(body.id_quotation);
});
test('límites, gastos generales y porcentaje administrativo se actualizan y consultan',async({request})=>{
 const a=await account(request);await income(request,a,1000);const odt=await createOdt();
 await post(request,'update_limit_resources',{id_odt:odt.id_odt,id_account:a.id_account,amount:150});
 await post(request,'update_admin_percent',{id_odt:odt.id_odt,admin_percent:0.25});
 await post(request,'general_expenses',{id_account:a.id_account,id_odt:odt.id_odt,amount:40,quantity:4,id_measure:1,description:'Gasto',odt_currency_code:'usd',expense_currency_code:'usd'});
 expect(await balance(a)).toBe(960);const limits=await (await request.get('/api/public/get_limit_resources')).json();expect(Number(limits.limit_resources.find(l=>l.id_odt===odt.id_odt&&l.id_account===a.id_account).amount)).toBe(110);
 expect(Number((await query('SELECT admin_percent FROM odts WHERE id_odt=$1',[odt.id_odt]))[0].admin_percent)).toBe(0.25);
 const report=await (await request.get('/api/public/odt_movements/'+odt.id_odt)).json();expect(report.balance_movements.map(m=>Number(m.amount))).toEqual([-40]);expect(Number(report.balance_movements[0].end_balance)).toBe(960);
});
test('gasto administrativo afecta solo entidad Administración y deja trazabilidad',async({request})=>{
 const a=await account(request);await income(request,a,100,2);
 await post(request,'admin_expenses',{id_account:a.id_account,amount:'12.50',description:'Gasto administrativo',expense_currency_code:'usd'});
 expect(await balance(a,2)).toBe(87.5);expect(await balance(a)).toBe(0);
 const expense=(await query('SELECT * FROM admin_expenses WHERE id_account=$1',[a.id_account]))[0];expect(Number(expense.amount)).toBe(12.5);
 expect((await query("SELECT amount FROM balance_movements WHERE type_movement_category='admin_expenses' AND id_movement_category=$1",[expense.id_admin_expense]))[0].amount).toBe('-12.5000000000');
});
test('préstamos: consulta de deuda y registros coincide con desembolso y abono',async({request})=>{
 const a=await account(request);await income(request,a,1000);const before=Number((await query('SELECT amount FROM loans WHERE id_user=202 AND id_currency=1'))[0].amount);
 await post(request,'give_loan',{user:{value:202},account:a,amount:80,description:'Préstamo auditado'});await post(request,'pay_loan',{user:{value:202},account:a,amount:30,description:'Abono auditado'});
 const debt=await (await request.get('/api/public/loans')).json();expect(Number(debt.loans.find(l=>l.id_user===202&&l.id_currency===1).amount)).toBe(before+50);
 const history=await (await request.get('/api/public/loans_registers')).json();expect(history.loans_register.filter(l=>l.id_user===202).slice(-2).map(l=>Number(l.amount))).toEqual([80,-30]);expect(await balance(a)).toBe(950);
});
test('saldos, movimientos y cortes históricos concilian; gráfico incluye todo el último día',async({request})=>{
 const a=await account(request);await income(request,a,100);await post(request,'investments',{id_account:a.id_account,id_entity:1,amount:25,description:'Auditoría'});
 const {balances}=await (await request.get('/api/public/balances')).json();expect(Number(balances.find(b=>b.id_account===a.id_account&&b.id_entity===1).balance)).toBe(75);
 const {balance_movements}=await (await request.get('/api/public/balance_movements')).json();const moves=balance_movements.filter(m=>m.account===a.name);expect(moves.map(m=>Number(m.amount))).toEqual([100,-25]);expect(Number(moves[1].end_balance)).toBe(75);
 const {balance_registers}=await (await request.get('/api/public/balance_registers')).json();const snapshots=balance_registers.filter(r=>r.id_account===a.id_account&&r.id_entity===1);expect(snapshots.map(r=>Number(r.balance))).toEqual([100,75]);
 await query("UPDATE balance_registers SET created_at='2026-01-10 15:00:00' WHERE id_balance_register=$1",[snapshots[0].id_balance_register]);
 await query("UPDATE balance_registers SET created_at='2026-01-12 15:00:00' WHERE id_balance_register=$1",[snapshots[1].id_balance_register]);
 const chart=await (await request.get('/api/public/balance_registers_charts/'+new Date('2026-01-11T12:00:00Z').getTime()+'/'+new Date('2026-01-12T12:00:00Z').getTime())).json();
 expect(chart.balance_registers1.filter(r=>r.id_account===a.id_account).map(r=>Number(r.balance))).toEqual([100]);expect(chart.balance_registers.filter(r=>r.id_account===a.id_account).map(r=>Number(r.balance))).toEqual([75]);
});
for(const [route,key,min] of [['currencys','currencys',5],['entitys','entitys',3],['measures','measures',1],['time_frequencys','time_frequencys',9],['payroll_variables','payroll_variables',1]])test('catálogo de referencia '+route,async({request})=>{
 const data=await (await request.get('/api/public/'+route)).json();expect(data[key].length).toBeGreaterThanOrEqual(min);if(route==='currencys')expect(data[key].map(c=>c.code)).toEqual(expect.arrayContaining(['usd','cop','ves']));
});
