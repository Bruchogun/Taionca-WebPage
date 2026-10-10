const { test, expect } = require('@playwright/test');
const { query, login, createOdt, payload, closure } = require('../helpers/app');
const { exchangeRate, quotationTotals } = require('esm')(module)('../../src/lib/currency');
let serial=0;
async function account(request, currency=1) {
    const name='Regresión monetaria '+Date.now()+' '+(++serial);
    const response=await request.post('/api/public/create_account',{data:{name,id_currency:currency}});
    expect((await response.json()).error).toBeUndefined();
    return (await query('SELECT * FROM accounts WHERE name=$1',[name]))[0];
}
async function balance(id,entity=1) { return Number((await query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=$2',[id,entity]))[0].balance); }
async function income(request,id,amount,entity=1) {
    const response=await request.post('/api/public/money_incomes',{data:{id_account:id,id_entity:entity,amount,description:'Test'}});
    expect((await response.json()).error).toBeUndefined();
}
test.beforeEach(async ({request})=>{await login(request);});

test('income and investment update balances and movement totals with cents',async ({request})=>{
    const a=await account(request); await income(request,a.id_account,'1000.25');
    expect(await balance(a.id_account)).toBe(1000.25);
    const response=await request.post('/api/public/investments',{data:{id_account:a.id_account,id_entity:1,amount:'100.05',description:'Test'}});
    expect((await response.json()).error).toBeUndefined();
    expect(await balance(a.id_account)).toBe(900.20);
    expect((await query('SELECT sum(m.amount)::text AS total FROM balance_movements m JOIN balances b USING(id_balance) WHERE b.id_account=$1',[a.id_account]))[0].total).toBe('900.2000000000');
});

test('same-currency transfer conserves funds across accounts and entities',async ({request})=>{
    const a=await account(request), b=await account(request); await income(request,a.id_account,'1000');
    for (const [target,entity,amount] of [[b,1,'250.15'],[a,2,'125.35']]) {
        const response=await request.post('/api/public/transfer_entitys',{data:{description:'Test',amount,expense:{...a,id_entity:1},income:{...target,id_entity:entity}}});
        expect((await response.json()).error).toBeUndefined();
    }
    expect(await balance(a.id_account)).toBe(624.5);
    expect(await balance(b.id_account)).toBe(250.15);
    expect(await balance(a.id_account,2)).toBe(125.35);
});

test('currency exchange debits and credits the explicitly entered amounts',async ({request})=>{
    const a=await account(request),b=await account(request,2); await income(request,a.id_account,'100');
    const response=await request.post('/api/public/exchange_currency',{data:{description:'Test',id_entity:1,expense:{...a,amount:'10.25'},income:{...b,amount:'410'}}});
    expect((await response.json()).error).toBeUndefined();
    expect(await balance(a.id_account)).toBe(89.75);
    expect(await balance(b.id_account)).toBe(410);
});

test('loan and repayment reconcile both debt and account balance',async ({request})=>{
    const a=await account(request); await income(request,a.id_account,'1000');
    const before=Number((await query('SELECT amount FROM loans WHERE id_user=201 AND id_currency=1'))[0].amount);
    for(const [endpoint,amount] of [['give_loan','125.75'],['pay_loan','25.25']]){
        const response=await request.post('/api/public/'+endpoint,{data:{user:{value:201},account:a,amount,description:'Test'}});
        expect((await response.json()).error).toBeUndefined();
    }
    expect(await balance(a.id_account)).toBe(899.50);
    expect(Number((await query('SELECT amount FROM loans WHERE id_user=201 AND id_currency=1'))[0].amount)-before).toBe(100.5);
});

test('ODT creation initializes spending limits to 30 percent of the contract',async ({request})=>{
    const response=await request.post('/api/public/nueva_odt',{data:{id_client:1,id_currency:1,id_entity:1,amount:'1234.50',description:'Test API',id_quotation:null,admin_percent:'0.2'}});
    const body=await response.json();expect(body.error).toBeUndefined();
    const limits=await query('SELECT amount FROM limit_resources WHERE id_odt=$1',[body.odt.id_odt]);
    expect(limits.length).toBeGreaterThan(0);expect(limits.every(row=>row.amount==='370.3500000000')).toBe(true);
});

for (const [hours, expected] of [[8,91.68],[32,366.72],[36,565.36],[40,611.2],[45,706.7]]) {
    test('payroll formula at '+hours+' hours',async ({request})=>{
        await query('INSERT INTO payroll_variables(base_salary,food_voucher,base_extra_salary,ivss_discount) VALUES(10,2,20,0.045)');
        const odt=await createOdt();
        const [row]=await query('INSERT INTO payroll_odt_hours(id_supervisor,id_user,id_odt,hours_spent) VALUES(1,202,$1,$2) RETURNING id_payroll_odt_hour',[odt.id_odt,hours]);
        const response=await request.post('/api/public/payroll_preview',{data:{payrolls:[{id_payroll_odt_hour:row.id_payroll_odt_hour,id_account:1,rate:1}]}});
        const body=await response.json();expect(body.error).toBeUndefined();expect(Number(body.payroll[0].v_amount)).toBe(expected);
    });
}

for(const [counter,base,expected] of [['usd','USD',1],['ves','USD',40],['USD','ves',0.025],['cop','eur',5000]]){
    test('exchange-rate normalization '+base+' to '+counter,()=>{
        expect(exchangeRate({USD:1,VES:40,COP:4000,EUR:0.8},counter,base)).toBe(expected);
    });
}
test('missing or zero rates are rejected instead of generating NaN',()=>{
    expect(()=>exchangeRate({},'VES','USD')).toThrow('tasa');
    expect(()=>exchangeRate({VES:0},'USD','VES')).toThrow('tasa');
});
test('quotation converts each inventory line once regardless of order',()=>{
    const general=[{amount:100,quantity:9,rate:2}];
    const inventory=[{amount:10,quantity:3,rate:40},{amount:20,quantity:2,rate:40}];
    expect(quotationTotals(general,inventory,0.2)).toEqual([200,2800,3750,0.2]);
    expect(quotationTotals(general,inventory.slice().reverse(),0.2)).toEqual([200,2800,3750,0.2]);
});

for(const type of ['spendable','no_spendable']){
    test(type+' inventory purchase, expense and closure preserve the original booked cost',async ({request})=>{
        const a=await account(request); await income(request,a.id_account,1000,3);
        // Inventory spending chooses an existing USD account with funds, preserving the current business rule.
        await income(request,1,1000,1);
        const [supplier]=await query("INSERT INTO suppliers(name) VALUES('Proveedor regression') RETURNING id_supplier");
        const [item]=await query(`INSERT INTO ${type}_items(cost,price,id_supplier) VALUES(1,2,$1) RETURNING id_${type}_item AS id`,[supplier.id_supplier]);
        const [stock]=await query(`INSERT INTO ${type}_stocks(id_${type}_item,amount) VALUES($1,0) RETURNING id_${type}_stock AS id`,[item.id]);
        const buy=await request.post('/api/public/'+type+'_inv_odt_incomes',{data:{id_spendable_stock:stock.id,id_account:a.id_account,quantity:10,cost:40,id_item:item.id}});
        expect((await buy.json()).error).toBeUndefined();
        expect(await balance(a.id_account,3)).toBe(960);
        expect(Number((await query(`SELECT price FROM ${type}_items WHERE id_${type}_item=$1`,[item.id]))[0].price)).toBe(5);
        const odt=await createOdt();
        const spend=await request.post('/api/public/'+type+'_inv_odt_expenses',{data:{id_spendable_stock:stock.id,amount:2,id_odt:odt.id_odt,description:'Test',currency_code:'usd'}});
        expect((await spend.json()).error).toBeUndefined();
        expect(Number((await query(`SELECT amount FROM ${type}_stocks WHERE id_${type}_stock=$1`,[stock.id]))[0].amount)).toBe(8);
        await query(`UPDATE ${type}_items SET price=500 WHERE id_${type}_item=$1`,[item.id]);
        const data=await payload({id_odt:odt.id_odt,id_account:a.id_account});
        expect((await request.post('/api/public/closure_odt',{data})).status()).toBe(200);
        expect((await closure(odt.id_odt)).inv_expense).toBe('10.0000000000');
    });
}


test('legacy payroll URL reports the replacement without attempting an automatic payment',async ({request})=>{
    const before=await query('SELECT count(*)::int AS count FROM payroll_records');
    const response=await request.get('/api/public/pay_payroll');
    expect(response.status()).toBe(410);
    expect((await response.json()).redirect).toBe('/payroll');
    expect(await query('SELECT count(*)::int AS count FROM payroll_records')).toEqual(before);
});
