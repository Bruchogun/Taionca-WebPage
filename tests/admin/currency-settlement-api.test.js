const {test,expect}=require('@playwright/test');
const {query,login,closure,ledger}=require('../helpers/app');
const {setupPayments,pay,totals,settle}=require('../helpers/payments');
const {manualPayment,scenario,expense,planFor,closePlan,parts}=require('../helpers/settlement');
const {allocateRecipients}=require('esm')(module)('../../src/lib/odt-settlement');
const {units,money}=require('esm')(module)('../../src/lib/money');
test.beforeEach(async({request})=>{await login(request);});

test('manual equivalent is preserved exactly without deriving an exchange rate',async({request})=>{
    const {odt,accounts}=await setupPayments();
    const data=manualPayment(odt,accounts[2],'1500000','333.1234567891');
    const result=await pay(request,data);
    expect(result.data).toMatchObject({paid_amount:'333.1234567891',remaining_amount:'666.8765432109'});
    expect(result.data.payments[0]).toMatchObject({amount:'1500000.0000000000',amount_odt:'333.1234567891',exchange_rate:null});
    expect((await query('SELECT exchange_rate,amount_odt FROM odt_payments WHERE id_odt=$1',[odt.id_odt]))[0]).toEqual({exchange_rate:null,amount_odt:'333.1234567891'});
    expect((await request.post('/api/public/odt_payments',{data})).status()).toBe(200);
    expect((await request.post('/api/public/odt_payments',{data:{...data,amount_odt:'334'}})).status()).toBe(409);
    expect(await totals(accounts)).toEqual([{id_account:accounts[2].id_account,total:'1500000.0000000000'}]);
});
for(const [label,change] of [['missing equivalent',{amount_odt:undefined}],['zero equivalent',{amount_odt:'0'}],['negative equivalent',{amount_odt:'-1'}],
    ['NaN equivalent',{amount_odt:'NaN'}],['boolean equivalent',{amount_odt:true}],['too precise equivalent',{amount_odt:'1.12345678901'}],
    ['overflow equivalent',{amount_odt:'100000000000000000000'}],['both equivalent and rate',{exchange_rate:'4000'}]]) {
    test('manual payment rejects '+label,async({request})=>{
        const {odt,accounts}=await setupPayments();
        expect((await request.post('/api/public/odt_payments',{data:manualPayment(odt,accounts[2],'1500000','375',change)})).status()).toBe(400);
        expect(await totals(accounts)).toEqual([]);
    });
}

test('same-currency equivalent must match and manual payments cannot use the legacy automatic closure',async({request})=>{
    const {odt,accounts}=await setupPayments();
    expect((await request.post('/api/public/odt_payments',{data:manualPayment(odt,accounts[0],'1000','999')})).status()).toBe(400);
    await pay(request,manualPayment(odt,accounts[0],'1000','1000'));
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(400);
    await expect(query('SELECT closure_odt(NULL,$1,1,1000,2,\'[]\',\'[]\',\'[]\',0.2,0.1)',[odt.id_odt])).rejects.toThrow('modalidad');
    expect(await closure(odt.id_odt)).toBeUndefined();
});

test('three mini closures use native income and expenses, preserve accounts and store separate commissions',async({request})=>{
    const {odt,accounts}=await scenario(request);
    await expense(odt,accounts[0],'1000','Gasto USD');await expense(odt,accounts[1],'1000000','Gasto COP');await expense(odt,accounts[2],'1020080','Gasto VES');
    const {plan}=await planFor(request,odt);plan.parts.find(p=>p.id_currency===3).ceo_percent='0.2';
    plan.parts.find(p=>p.id_currency===1).admin_users=[{id_user:201,profit_percent:'0.1'}];
    const before=await totals(accounts);const result=await closePlan(request,plan);
    expect(result.settlement_mode).toBe('split');expect(result.parts).toHaveLength(3);
    expect(await totals(accounts)).toEqual(before);
    const stored=await parts(odt.id_odt);
    expect(stored.map(p=>[p.id_currency,p.amount,p.general_expense,p.gross_profit,p.taionca_profit])).toEqual([
        [1,'5000.0000000000','1000.0000000000','3000.0000000000','3400.0000000000'],
        [2,'10200800.0000000000','1020080.0000000000','7140560.0000000000','7446584.0000000000'],
        [3,'10000000.0000000000','1000000.0000000000','7000000.0000000000','6600000.0000000000']
    ]);
    expect((await closure(odt.id_odt)).gross_profit).toBeNull(); // Never sum USD, COP and VES.
    expect((await query('SELECT sum(m.amount) AS net FROM balance_movements m JOIN closure_odts c ON c.id_closure_odt=m.id_movement_category WHERE m.type_movement_category=\'closure_odts\' AND c.id_odt=$1',[odt.id_odt]))[0].net).toBe('0.0000000000');
    const history=await (await request.get('/api/public/odt_closure_resume/'+odt.id_odt)).json();
    expect(history.currency_settlement.parts).toHaveLength(3);expect(history.currency_settlement.expenses).toHaveLength(3);
    expect(history.currency_settlement.parts[0].commissions.find(c=>c.role==='admin').profit).toBe('300.0000000000');
    expect(history.currency_settlement.revenues.every(r=>r.valuation_source==='native')).toBe(true);
});

test('negative mini closure must reassign selected expenses with an explicit manual amount',async({request})=>{
    const {odt,accounts}=await scenario(request,{amount:'1000',payments:[['900','900'],['100','100']]});
    const key=await expense(odt,accounts[1],'200','Gasto mayor al ingreso COP','200');
    const {plan}=await planFor(request,odt);const before=await totals(accounts);
    let response=await request.post('/api/public/odt_settlement',{data:plan});
    expect(response.status()).toBe(400);expect((await response.json()).error).toContain('utilidad negativa');expect(await closure(odt.id_odt)).toBeUndefined();
    plan.expenses[0].id_currency=1;plan.expenses[0].amount='';
    expect((await request.post('/api/public/odt_settlement',{data:plan})).status()).toBe(400);
    plan.expenses[0].amount='25';await closePlan(request,plan);
    expect(await totals(accounts)).toEqual(before);
    const stored=await parts(odt.id_odt);
    expect(stored.find(p=>p.id_currency===1)).toMatchObject({amount:'900.0000000000',general_expense:'25.0000000000',gross_profit:'695.0000000000'});
    expect(stored.find(p=>p.id_currency===3)).toMatchObject({general_expense:'0.0000000000',gross_profit:'80.0000000000'});
    const [allocation]=await query('SELECT e.* FROM closure_odt_expenses e JOIN closure_odts c USING(id_closure_odt) WHERE c.id_odt=$1 AND expense_key=$2',[odt.id_odt,key]);
    expect(allocation).toMatchObject({source_currency:3,source_amount:'200.0000000000',id_currency:1,amount:'25.0000000000'});
    const expenses=await (await request.get('/api/public/odt_movements/'+odt.id_odt)).json();
    expect(expenses.balance_movements).toHaveLength(1);expect(expenses.balance_movements[0].amount).toBe('-200.0000000000');
});

test('original-currency closure uses entered ODT equivalents and records explicit cash exchanges atomically',async({request})=>{
    const {odt,accounts}=await scenario(request);
    await expense(odt,accounts[0],'1000');await expense(odt,accounts[1],'1000000');await expense(odt,accounts[2],'1020080');
    const [destination]=await query("INSERT INTO accounts(id_currency,name) VALUES(1,'Destino de reparto USD') RETURNING *");
    const {plan}=await planFor(request,odt,'single',1);plan.id_account=destination.id_account;
    plan.parts[0].admin_users=[{id_user:201,profit_percent:'0.1'}];
    for(const e of plan.expenses)if(e.id_currency===1 && e.amount==='')e.amount='250';
    plan.exchanges=[{id_account_from:accounts[1].id_account,amount_from:'4000000',amount_to:'1000'},
        {id_account_from:accounts[2].id_account,amount_from:'5000000',amount_to:'2300'}];
    await closePlan(request,plan);
    expect((await parts(odt.id_odt))[0]).toMatchObject({id_currency:1,amount:'10000.0000000000',general_expense:'1500.0000000000',gross_profit:'6500.0000000000',taionca_profit:'6700.0000000000'});
    const balances=await totals([...accounts,destination]);
    expect(balances.map(b=>b.total)).toEqual(['4000.0000000000','5000000.0000000000','4180720.0000000000','3300.0000000000']);
    const outgoing=await query(`SELECT m.amount,a.id_currency FROM balance_movements m JOIN balances b USING(id_balance) JOIN accounts a USING(id_account)
        JOIN closure_odts c ON c.id_closure_odt=m.id_movement_category WHERE m.type_movement_category='closure_odts' AND c.id_odt=$1`,[odt.id_odt]);
    expect(outgoing.every(m=>m.id_currency===1)).toBe(true);
    const history=(await (await request.get('/api/public/odt_closure_resume/'+odt.id_odt)).json()).currency_settlement;
    expect(history.exchanges.map(e=>[e.amount_from,e.amount_to])).toEqual([['4000000.0000000000','1000.0000000000'],['5000000.0000000000','2300.0000000000']]);
    expect(history.revenues.map(r=>r.valuation_source)).toEqual(['native','payment_equivalent','payment_equivalent']);
});

test('a received currency needs manual income and expense equivalents, never inferred rates',async({request})=>{
    const {odt,accounts}=await scenario(request);
    await expense(odt,accounts[0],'1000');await expense(odt,accounts[1],'1000000');await expense(odt,accounts[2],'1020080');
    const {plan}=await planFor(request,odt,'single',3);plan.id_account=accounts[1].id_account;
    expect((await request.post('/api/public/odt_settlement',{data:plan})).status()).toBe(400);
    plan.income_values=[{id_currency:1,amount:'17500000'},{id_currency:2,amount:'14000000'}];
    // Explicitly map the original expense currencies from the preview.
    const {source}=await planFor(request,odt,'single',3);
    for(const e of plan.expenses){const src=source.expenses.find(x=>x.expense_key===e.expense_key);if(src.source_currency!==3)e.amount=src.source_currency===1?'3700000':'1100000';}
    plan.exchanges=[{id_account_from:accounts[0].id_account,amount_from:'500',amount_to:'2040000'}];
    await closePlan(request,plan);
    expect((await parts(odt.id_odt))[0]).toMatchObject({id_currency:3,amount:'41500000.0000000000',general_expense:'5800000.0000000000',gross_profit:'27400000.0000000000'});
    expect((await query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=1',[accounts[1].id_account]))[0].balance).toBe('0.0000000000');
});

for(const [label,mutate] of [
    ['unknown mode',p=>p.mode='auto'],['missing expense',p=>p.expenses=[]],['duplicate expense',p=>p.expenses.push({...p.expenses[0]})],
    ['fake expense',p=>p.expenses.push({expense_key:'fake',id_currency:1,amount:'1'})],['changed native expense',p=>p.expenses[0].amount='1'],
    ['unavailable expense currency',p=>p.expenses[0].id_currency=4],['missing percentages',p=>p.parts=[]],
    ['duplicate part',p=>p.parts.push({...p.parts[0]})],['excess commissions',p=>p.parts[0].ceo_percent='1.1'],
    ['forged income',p=>p.income_values=[{id_currency:1,amount:'999999'}]],['unexpected bank change',p=>p.exchanges=[{}]],
    ['invalid source version',p=>p.version='other'],['non-array expenses',p=>p.expenses={}]
]) test('currency settlement rejects '+label+' without changing balances',async({request})=>{
    const {odt,accounts}=await scenario(request);await expense(odt,accounts[0],'100');const {plan}=await planFor(request,odt);const before=await totals(accounts);
    mutate(plan);const response=await request.post('/api/public/odt_settlement',{data:plan});expect(response.status()).toBe(400);
    expect(await closure(odt.id_odt)).toBeUndefined();expect(await ledger(odt.id_odt)).toEqual([]);expect(await totals(accounts)).toEqual(before);
});

test('only original or received currencies and a matching payout account are allowed',async({request})=>{
    const {odt,accounts}=await scenario(request);const {plan}=await planFor(request,odt,'single',1);
    for(const values of [{id_currency:4,id_account:accounts[0].id_account},{id_account:accounts[1].id_account},{id_account:2147483647}]) {
        expect((await request.post('/api/public/odt_settlement',{data:{...plan,...values}})).status()).toBe(400);
    }
});

test('stale expense preview is rejected and a refreshed preview can close',async({request})=>{
    const {odt,accounts}=await scenario(request);const {plan}=await planFor(request,odt);await expense(odt,accounts[0],'100');
    const response=await request.post('/api/public/odt_settlement',{data:plan});expect(response.status()).toBe(400);expect((await response.json()).error).toContain('cambiaron');
    expect(await closure(odt.id_odt)).toBeUndefined();const fresh=await planFor(request,odt);await closePlan(request,fresh.plan);
    await expect(query('UPDATE general_expenses SET amount=200 WHERE id_odt=$1',[odt.id_odt])).rejects.toThrow('cerrada');
});

test('concurrent currency closures distribute once',async({request})=>{
    const {odt,accounts}=await scenario(request);const {plan}=await planFor(request,odt);const before=await totals(accounts);
    const responses=await Promise.all([1,2,3].map(()=>request.post('/api/public/odt_settlement',{data:plan})));
    expect(responses.map(r=>r.status()).sort()).toEqual([200,409,409]);expect(await parts(odt.id_odt)).toHaveLength(3);expect(await totals(accounts)).toEqual(before);
});

test('insufficient exchange balance rolls back every change and mini closure',async({request})=>{
    const {odt,accounts}=await scenario(request);const {plan}=await planFor(request,odt,'single',1);plan.id_account=accounts[0].id_account;
    plan.exchanges=[{id_account_from:accounts[1].id_account,amount_from:'99999999',amount_to:'1'}];
    const before=await totals(accounts);const exchanges=await query('SELECT count(*)::int AS count FROM exchange_currencys');
    const response=await request.post('/api/public/odt_settlement',{data:plan});expect(response.status()).toBe(400);expect((await response.json()).error).toContain('insuficiente');
    expect(await totals(accounts)).toEqual(before);expect(await closure(odt.id_odt)).toBeUndefined();expect(await parts(odt.id_odt)).toEqual([]);
    expect(await query('SELECT count(*)::int AS count FROM exchange_currencys')).toEqual(exchanges);
});

test('failure after bank exchanges rolls back transfers, distributions and the complete closure',async({request})=>{
    const {odt,accounts}=await scenario(request);const {plan}=await planFor(request,odt,'single',1);plan.id_account=accounts[0].id_account;
    plan.exchanges=[{id_account_from:accounts[1].id_account,amount_from:'1000',amount_to:'100'}];
    const before=await totals(accounts);const exchanges=await query('SELECT count(*)::int AS count FROM exchange_currencys');
    await query(`CREATE FUNCTION fail_currency_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type_movement_category='closure_odts' AND EXISTS(SELECT 1 FROM balances WHERE id_balance=NEW.id_balance AND id_account=${accounts[0].id_account} AND id_entity=2)
        THEN RAISE EXCEPTION 'Fallo de reparto'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_currency_close BEFORE INSERT ON balance_movements FOR EACH ROW EXECUTE FUNCTION fail_currency_close()`);
    try {expect((await request.post('/api/public/odt_settlement',{data:plan})).status()).toBe(400);}
    finally {await query('DROP TRIGGER fail_currency_close ON balance_movements; DROP FUNCTION fail_currency_close()');}
    expect(await totals(accounts)).toEqual(before);expect(await closure(odt.id_odt)).toBeUndefined();expect(await parts(odt.id_odt)).toEqual([]);
    expect(await query('SELECT count(*)::int AS count FROM exchange_currencys')).toEqual(exchanges);
});

test('missing inventory cost requires an explicit amount, without using the current item price',async({request})=>{
    const {odt}=await scenario(request);
    const [supplier]=await query("INSERT INTO suppliers(name) VALUES('Inventario cierre') RETURNING id_supplier");
    const [item]=await query('INSERT INTO spendable_items(cost,price,id_supplier) VALUES(1,999999,$1) RETURNING id_spendable_item',[supplier.id_supplier]);
    const [stock]=await query('INSERT INTO spendable_stocks(id_spendable_item,amount) VALUES($1,10) RETURNING id_spendable_stock',[item.id_spendable_item]);
    await query('INSERT INTO spendable_inv_odt_expenses(id_spendable_stock,id_odt,amount,description,rate) VALUES($1,$2,1,\'Costo sin registro\',999)',[stock.id_spendable_stock,odt.id_odt]);
    const {source,plan}=await planFor(request,odt);expect(source.expenses[0].source_amount).toBeNull();expect(source.expenses[0].source_currency).toBeNull();
    expect((await request.post('/api/public/odt_settlement',{data:plan})).status()).toBe(400);
    plan.expenses[0].id_currency=1;plan.expenses[0].amount='17.35';await closePlan(request,plan);
    expect((await parts(odt.id_odt)).find(p=>p.id_currency===1).inv_expense).toBe('17.3500000000');
});

test('inventory costs follow their booked currency and amount, ignoring price and stored rate changes',async({request})=>{
    const {odt,accounts}=await scenario(request);
    const [supplier]=await query("INSERT INTO suppliers(name) VALUES('Inventario registrado') RETURNING id_supplier");
    for(const [type,account,amount] of [['spendable',accounts[1],'250'],['no_spendable',accounts[0],'75']]) {
        const [item]=await query(`INSERT INTO ${type}_items(cost,price,id_supplier) VALUES(1,999999,$1) RETURNING id_${type}_item AS id`,[supplier.id_supplier]);
        const [stock]=await query(`INSERT INTO ${type}_stocks(id_${type}_item,amount) VALUES($1,10) RETURNING id_${type}_stock AS id`,[item.id]);
        await query(`WITH e AS (INSERT INTO ${type}_inv_odt_expenses(id_${type}_stock,id_odt,amount,description,rate) VALUES($1,$2,1,'Costo registrado',999) RETURNING id_${type}_inv_odt_expense AS id)
            SELECT alter_balance(id_balance,-$4::numeric,id,'${type}_inv_odt_expenses') FROM e,balances WHERE id_account=$3 AND id_entity=1`,[stock.id,odt.id_odt,account.id_account,amount]);
    }
    const {source,plan}=await planFor(request,odt);expect(source.expenses.map(e=>e.source_amount).sort()).toEqual(['250.0000000000','75.0000000000']);
    await closePlan(request,plan);const stored=await parts(odt.id_odt);
    expect(stored.find(p=>p.id_currency===3).inv_expense).toBe('250.0000000000');expect(stored.find(p=>p.id_currency===1).inv_expense).toBe('75.0000000000');
});

test('anonymous, unprivileged and unrelated users cannot prepare or confirm currency closures',async({request,playwright})=>{
    const {odt}=await scenario(request);const {plan}=await planFor(request,odt);
    const other=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL});
    try {
        expect((await other.get('/api/public/odt_settlement/'+odt.id_odt)).status()).toBe(401);
        expect((await other.post('/api/public/odt_settlement',{data:plan})).status()).toBe(401);
        await login(other,'test-user-202');expect((await other.get('/api/public/odt_settlement/'+odt.id_odt)).status()).toBe(403);
        expect((await other.post('/api/public/odt_settlement',{data:plan})).status()).toBe(403);
    }finally{await other.dispose();}
});

test('rounding conserves each account and each recipient down to the smallest money unit',async()=>{
    for(let seed=1;seed<=40;seed++) {
        const accounts=[1,2,3].map((id,i)=>({id_account:id,amount:money(BigInt(seed+i))}));
        const total=accounts.reduce((s,a)=>s+units(a.amount),BigInt(0));
        const recipients=[{id_entity:2,amount:money(total/BigInt(2))},{id_entity:3,amount:money(total-total/BigInt(2))}];
        const result=allocateRecipients(accounts,recipients);
        for(const a of accounts)expect(result.filter(r=>r.id_account===a.id_account).reduce((s,r)=>s+units(r.amount),BigInt(0))).toBe(units(a.amount));
        for(const r of recipients)expect(result.filter(a=>a.id_entity===r.id_entity).reduce((s,a)=>s+units(a.amount),BigInt(0))).toBe(units(r.amount));
    }
});

test('payroll changes invalidate the preview and pending hours prevent closure',async({request})=>{
    const {odt}=await scenario(request);const {plan}=await planFor(request,odt);
    await query('INSERT INTO payroll_odt_hours(id_supervisor,id_user,id_odt,hours_spent) VALUES(1,201,$1,8)',[odt.id_odt]);
    let response=await request.post('/api/public/odt_settlement',{data:plan});expect(response.status()).toBe(400);expect((await response.json()).error).toContain('nómina');
    const pending=await planFor(request,odt);response=await request.post('/api/public/odt_settlement',{data:pending.plan});expect(response.status()).toBe(400);
    await query('UPDATE payroll_odt_hours SET is_paid=true WHERE id_odt=$1',[odt.id_odt]);
    const fresh=await planFor(request,odt);await closePlan(request,fresh.plan);
    await expect(query('UPDATE payroll_odt_hours SET hours_spent=9 WHERE id_odt=$1',[odt.id_odt])).rejects.toThrow('cerrada');
});

test('a new expense posted after closing returns conflict without altering the ledger',async({request})=>{
    const {odt,accounts}=await scenario(request);const {plan}=await planFor(request,odt);await closePlan(request,plan);
    const before=await totals(accounts);
    const response=await request.post('/api/public/general_expenses',{data:{id_odt:odt.id_odt,id_account:accounts[0].id_account,amount:'10',description:'Gasto tardío',odt_currency_code:'USD',expense_currency_code:'USD',id_measure:1,quantity:1}});
    expect(response.status()).toBe(409);expect((await response.json()).error).toContain('cerrada');expect(await totals(accounts)).toEqual(before);
    expect(await query('SELECT * FROM general_expenses WHERE id_odt=$1',[odt.id_odt])).toEqual([]);
});

test('currency closure permission does not bypass ownership of the ODT',async({request,playwright})=>{
    const {odt}=await scenario(request);await query('UPDATE odts SET id_user=201 WHERE id_odt=$1',[odt.id_odt]);const {plan}=await planFor(request,odt);
    const [role]=await query("INSERT INTO roles(name) VALUES('currency-close-test') RETURNING role_id");
    await query("INSERT INTO join_roles_permissions(role_id,permission_id) SELECT $1,permission_id FROM permissions WHERE name='odt_update'",[role.role_id]);
    await query('INSERT INTO join_users_roles(user_id,role_id) VALUES(204,$1)',[role.role_id]);
    const other=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL});
    try {await login(other,'test-user-204');expect((await other.get('/api/public/odt_settlement/'+odt.id_odt)).status()).toBe(404);
        expect((await other.post('/api/public/odt_settlement',{data:plan})).status()).toBe(403);}
    finally{await other.dispose();}
});

test('commission rounding cannot create a negative company allocation',async({request})=>{
    const {odt,accounts}=await scenario(request,{amount:'0.0000000001',payments:[['0.0000000001','0.0000000001']]});
    const {plan}=await planFor(request,odt);plan.parts[0].admin_percent='0';plan.parts[0].ceo_percent='0.5';plan.parts[0].admin_users=[{id_user:201,profit_percent:'0.5'}];
    expect((await request.post('/api/public/odt_settlement',{data:plan})).status()).toBe(400);expect(await closure(odt.id_odt)).toBeUndefined();
    plan.parts[0].ceo_percent='0';plan.parts[0].admin_users[0].profit_percent='1';await closePlan(request,plan);
    expect((await totals(accounts))[0].total).toBe('0.0000000001');
});

test('a currency without received payments requires explicit expense reassignment',async({request})=>{
    const {odt,accounts}=await scenario(request,{payments:[['10000','10000']]});
    await query('INSERT INTO balances(id_account,id_entity,balance) VALUES($1,1,1000)',[accounts[1].id_account]);
    await expense(odt,accounts[1],'250','Gasto en moneda sin abonos');
    const {plan}=await planFor(request,odt);expect(plan.expenses[0].id_currency).toBeNull();expect(plan.expenses[0].amount).toBe('');
    expect((await request.post('/api/public/odt_settlement',{data:plan})).status()).toBe(400);
    plan.expenses[0]={...plan.expenses[0],id_currency:1,amount:'7.25'};await closePlan(request,plan);
    expect((await parts(odt.id_odt))[0].general_expense).toBe('7.2500000000');
});

test('a new payout account retains its currency and exchange movements identify the ODT',async({request})=>{
    const {odt,accounts}=await scenario(request);const [destination]=await query("INSERT INTO accounts(id_currency,name) VALUES(1,'Cuenta destino protegida') RETURNING *");
    const {plan}=await planFor(request,odt,'single',1);plan.id_account=destination.id_account;plan.exchanges=[{id_account_from:accounts[1].id_account,amount_from:'5000000',amount_to:'2800'}];
    await closePlan(request,plan);
    await expect(query('UPDATE accounts SET id_currency=3 WHERE id_account=$1',[destination.id_account])).rejects.toThrow('moneda');
    const movements=await query(`SELECT get_odt_movement(m.id_movement_category,m.type_movement_category) AS id_odt
        FROM balance_movements m JOIN closure_odt_exchanges e ON e.id_exchange_currency=m.id_movement_category
        JOIN closure_odts c USING(id_closure_odt) WHERE m.type_movement_category='exchange_currency' AND c.id_odt=$1`,[odt.id_odt]);
    expect(movements.map(m=>m.id_odt)).toEqual([odt.id_odt,odt.id_odt]);
});
