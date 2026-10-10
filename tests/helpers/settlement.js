const { expect } = require('@playwright/test');
const { initialSettlement }=require('esm')(module)('../../src/lib/odt-settlement');
const { query, createOdt }=require('./app');
const { payment, pay }=require('./payments');
function manualPayment(odt,account,amount,equivalent,overrides={}) {
    const data=payment(odt,account,amount);delete data.exchange_rate;
    return {...data,amount_odt:equivalent,...overrides};
}
async function scenario(request, options={}) {
    const odt=await createOdt({amount:options.amount||'10000'});
    const accounts=await query(`INSERT INTO accounts(id_currency,name) VALUES(1,$1),(3,$2),(2,$3) RETURNING *`,
        ['Cierre USD '+odt.id_odt,'Cierre COP '+odt.id_odt,'Cierre VES '+odt.id_odt]);
    const amounts=options.payments||[['5000','5000'],['10000000','2500'],['10200800','2500']];
    for(let i=0;i<amounts.length;i++) if(amounts[i]) await pay(request,manualPayment(odt,accounts[i],...amounts[i]));
    return {odt,accounts};
}
async function expense(odt,account,amount,description='Gasto de prueba',fund='0') {
    if(fund!=='0') await query(`WITH i AS (INSERT INTO incomes(id_user,id_account,id_entity,amount,description) VALUES(1,$1,1,$2,'Fondos de prueba') RETURNING id_income)
        SELECT alter_balance(id_balance,$2,id_income,'incomes') FROM balances,i WHERE id_account=$1 AND id_entity=1`,[account.id_account,fund]);
    const [row]=await query(`WITH e AS (INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,$3,999,$4,1,7) RETURNING id_general_expense)
        SELECT id_general_expense,alter_balance(id_balance,-$3::numeric,id_general_expense,'general_expenses')
        FROM e,balances WHERE id_account=$1 AND id_entity=1`,[account.id_account,odt.id_odt,amount,description]);
    return 'general:'+row.id_general_expense;
}
async function planFor(request,odt,mode='split',currency=odt.id_currency) {
    const response=await request.get('/api/public/odt_settlement/'+odt.id_odt);
    const body=await response.json();expect(body.error).toBeUndefined();expect(response.status()).toBe(200);
    return {source:body.data,plan:initialSettlement(body.data,mode,currency)};
}
async function closePlan(request,plan) {
    const response=await request.post('/api/public/odt_settlement',{data:plan});
    const body=await response.json();expect(body.error).toBeUndefined();expect(response.status()).toBe(200);return body.data;
}
async function parts(id) {return query(`SELECT p.* FROM closure_odt_parts p JOIN closure_odts c USING(id_closure_odt) WHERE c.id_odt=$1 ORDER BY id_currency`,[id]);}
module.exports={manualPayment,scenario,expense,planFor,closePlan,parts};
