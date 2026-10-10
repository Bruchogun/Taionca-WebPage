const { test, expect } = require('@playwright/test');
const { query, login, closure, ledger, payload } = require('../helpers/app');
const { setupPayments, payment, pay, totals, settle } = require('../helpers/payments');

test.beforeEach(async ({ request }) => { await login(request); });

for (const [name, values] of [
    ['missing ODT', {id_odt:null}], ['invalid ODT ID', {id_odt:'1 OR 1=1'}],
    ['missing account', {id_account:null}], ['negative account', {id_account:-1}],
    ['zero amount', {amount:'0'}], ['negative amount', {amount:'-200'}], ['NaN amount', {amount:'NaN'}],
    ['infinite amount', {amount:'Infinity'}], ['overflow amount', {amount:'100000000000000000000'}],
    ['eleven decimals', {amount:'0.12345678901'}], ['boolean amount', {amount:true}],
    ['zero rate', {exchange_rate:'0'}], ['negative rate', {exchange_rate:'-4000'}], ['missing rate', {exchange_rate:null}],
    ['NaN rate', {exchange_rate:'NaN'}], ['infinite rate', {exchange_rate:'Infinity'}], ['overprecise rate', {exchange_rate:'1.12345678901'}],
    ['missing request key', {request_key:null}], ['invalid UUID', {request_key:'bad'}],
    ['invalid description', {description:{}}], ['long description', {description:'x'.repeat(513)}]
]) {
    test('payment rejects '+name+' atomically', async ({ request }) => {
        const {odt, accounts} = await setupPayments();
        const before = await query('SELECT count(*)::int AS total FROM incomes');
        const response = await request.post('/api/public/odt_payments', {data:payment(odt,accounts[0],'200','1',values)});
        expect(response.status()).toBe(400);
        expect((await response.json()).error).toBeTruthy();
        expect(await query('SELECT * FROM odt_payments WHERE id_odt=$1',[odt.id_odt])).toEqual([]);
        expect(await totals(accounts)).toEqual([]);
        expect(await query('SELECT count(*)::int AS total FROM incomes')).toEqual(before);
    });
}

test('USD and COP payments credit each account immediately; closure only reallocates its money', async ({ request }) => {
    const {odt, accounts} = await setupPayments();
    let result = await pay(request,payment(odt,accounts[0],'200'));
    expect(result.data).toMatchObject({paid_amount:'200.0000000000',remaining_amount:'800.0000000000',closed:false});
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'200.0000000000'}]);
    await pay(request,payment(odt,accounts[1],'300'));
    result = await pay(request,payment(odt,accounts[2],'1500000','4000'));
    expect(result.data).toMatchObject({paid_amount:'875.0000000000',remaining_amount:'125.0000000000'});
    expect(result.data.payments[2]).toMatchObject({amount:'1500000.0000000000',exchange_rate:'4000.0000000000',amount_odt:'375.0000000000',currency_code:'COP'});
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(400);
    expect(await closure(odt.id_odt)).toBeUndefined();
    await pay(request,payment(odt,accounts[0],'125'));
    const before = await totals(accounts);
    const response = await request.post('/api/public/closure_odt',{data:settle(odt,{
        admin_users:[{id_user:201,profit_percent:'0.125'}],operative_users:[{id_user:201,profit_percent:'0.075'}]
    })});
    expect((await response.json()).error).toBeUndefined();
    expect(response.status()).toBe(200);
    expect(await totals(accounts)).toEqual(before);
    expect(await closure(odt.id_odt)).toMatchObject({id_account:null,settled_from_payments:true,amount:'1000.0000000000',gross_profit:'800.0000000000',taionca_profit:'560.0000000000'});
    const balances = await query('SELECT id_account,id_entity,balance FROM balances WHERE id_account=ANY($1) ORDER BY id_account,id_entity',[accounts.map(a=>a.id_account)]);
    expect(balances.find(b=>b.id_account===accounts[0].id_account && b.id_entity===1).balance).toBe('182.0000000000');
    expect(balances.find(b=>b.id_account===accounts[1].id_account && b.id_entity===2).balance).toBe('60.0000000000');
    expect(balances.find(b=>b.id_account===accounts[2].id_account && b.id_entity===1).balance).toBe('840000.0000000000');
    expect(balances.find(b=>b.id_account===accounts[2].id_account && b.id_entity===2).balance).toBe('300000.0000000000');
    const [entity] = await query('SELECT id_entity FROM users WHERE user_id=201');
    expect(balances.find(b=>b.id_account===accounts[2].id_account && b.id_entity===entity.id_entity).balance).toBe('240000.0000000000');
    const summary = await (await request.get('/api/public/odt_payments/'+odt.id_odt)).json();
    expect(summary.data).toMatchObject({remaining_amount:'0.0000000000',closed:true});
    expect(summary.data.allocations).toHaveLength(12);
    const resume = await (await request.get('/api/public/odt_closure_resume/'+odt.id_odt)).json();
    expect(resume.odt_closure_resume.account_name).toContain(accounts[2].name);
    expect(resume.payments.payments).toHaveLength(4);
    const expenses = await (await request.get('/api/public/odt_movements/'+odt.id_odt)).json();
    expect(expenses.balance_movements).toEqual([]);
    const movements = await query(`SELECT get_odt_movement(m.id_movement_category,m.type_movement_category) AS id_odt
        FROM balance_movements m JOIN odt_payments p ON p.id_income=m.id_movement_category
        WHERE m.type_movement_category='incomes' AND p.id_odt=$1`,[odt.id_odt]);
    expect(movements.map(m=>m.id_odt)).toEqual([odt.id_odt,odt.id_odt,odt.id_odt,odt.id_odt]);
    expect((await request.get('/api/public/odts').then(r=>r.json())).odts.some(o=>o.id_odt===odt.id_odt)).toBe(false);
});

test('same-currency requires rate one; missing account/ODT and excessive conversions are rejected', async ({ request }) => {
    const {odt,accounts}=await setupPayments();
    for(const [data,status] of [
        [payment(odt,accounts[0],'200','2'),400], [payment(odt,accounts[0],'200','1',{id_account:2147483647}),404],
        [payment(odt,accounts[0],'200','1',{id_odt:2147483647}),404], [payment(odt,accounts[2],'1500000','0.0000000001'),400],
        [payment(odt,accounts[2],'0.0000000001','10000000000000'),400], [payment(odt,accounts[0],'1000.0000000001'),400]
    ]) expect((await request.post('/api/public/odt_payments',{data})).status()).toBe(status);
    expect(await totals(accounts)).toEqual([]);
});

test('concurrent identical requests and replay after closing create exactly one income', async ({ request }) => {
    const {odt,accounts}=await setupPayments();const data=payment(odt,accounts[0],'1000');
    const responses=await Promise.all([1,2,3].map(()=>request.post('/api/public/odt_payments',{data})));
    expect(responses.map(r=>r.status())).toEqual([200,200,200]);
    const results=await Promise.all(responses.map(r=>r.json()));
    expect(new Set(results.map(r=>r.id_odt_payment)).size).toBe(1);
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'1000.0000000000'}]);
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(200);
    expect((await request.post('/api/public/odt_payments',{data})).status()).toBe(200);
    expect((await query('SELECT count(*)::int AS count FROM odt_payments WHERE id_odt=$1',[odt.id_odt]))[0].count).toBe(1);
    expect((await request.post('/api/public/odt_payments',{data:{...data,amount:'1'}})).status()).toBe(409);
    expect((await request.post('/api/public/odt_payments',{data:payment(odt,accounts[0],'1')})).status()).toBe(409);
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'1000.0000000000'}]);
});

test('idempotency keys cannot be reused with different payment data or another ODT', async ({ request }) => {
    const {odt,accounts}=await setupPayments();const data=payment(odt,accounts[0],'200');await pay(request,data);
    const other=await setupPayments();
    for(const change of [{amount:'201'},{id_account:accounts[1].id_account},{description:'otro'},{id_odt:other.odt.id_odt}]) {
        expect((await request.post('/api/public/odt_payments',{data:{...data,...change}})).status()).toBe(409);
    }
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'200.0000000000'}]);
});

test('concurrent different payments cannot overpay the ODT', async ({ request }) => {
    const {odt,accounts}=await setupPayments();
    const responses=await Promise.all(accounts.slice(0,2).map(a=>request.post('/api/public/odt_payments',{data:payment(odt,a,'600')})));
    expect(responses.map(r=>r.status()).sort()).toEqual([200,400]);
    const result=await (await request.get('/api/public/odt_payments/'+odt.id_odt)).json();
    expect(result.data).toMatchObject({paid_amount:'600.0000000000',remaining_amount:'400.0000000000'});
    expect(result.data.payments).toHaveLength(1);
});

test('final payment racing closure and duplicate closes preserve totals', async ({ request }) => {
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[0],'900'));
    const [p,c]=await Promise.all([
        request.post('/api/public/odt_payments',{data:payment(odt,accounts[1],'100')}),
        request.post('/api/public/closure_odt',{data:settle(odt)})
    ]);
    expect(p.status()).toBe(200); expect([200,400]).toContain(c.status());
    if(c.status()===400) expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(200);
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(409);
    expect((await totals(accounts)).map(a=>a.total)).toEqual(['900.0000000000','100.0000000000']);
});

test('existing payments forbid direct closure and settlement rejects missing or mismatched receipts', async ({ request }) => {
    const {odt,accounts}=await setupPayments();
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(400);
    await pay(request,payment(odt,accounts[0],'1000'));
    const direct=await payload({id_odt:odt.id_odt,id_account:accounts[0].id_account});
    expect((await request.post('/api/public/closure_odt',{data:direct})).status()).toBe(400);
    for(const values of [{amount:'999'},{id_account:accounts[0].id_account},{settle_payments:'true'}]) {
        expect((await request.post('/api/public/closure_odt',{data:settle(odt,values)})).status()).toBe(400);
    }
    expect(await closure(odt.id_odt)).toBeUndefined();
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'1000.0000000000'}]);
});

test('accounting failure rolls back payment, income and balance together', async ({ request }) => {
    const {odt,accounts}=await setupPayments();
    const before=await query('SELECT count(*)::int AS count FROM incomes');
    await query(`CREATE FUNCTION test_reject_payment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type_movement_category='incomes' AND EXISTS(SELECT 1 FROM balances WHERE id_balance=NEW.id_balance AND id_account=${accounts[0].id_account})
        THEN RAISE EXCEPTION 'test payment rollback'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_reject_payment BEFORE INSERT ON balance_movements FOR EACH ROW EXECUTE FUNCTION test_reject_payment()`);
    try { expect((await request.post('/api/public/odt_payments',{data:payment(odt,accounts[0],'200')})).status()).toBe(400); }
    finally { await query('DROP TRIGGER test_reject_payment ON balance_movements; DROP FUNCTION test_reject_payment()'); }
    expect(await query('SELECT * FROM odt_payments WHERE id_odt=$1',[odt.id_odt])).toEqual([]);
    expect(await query('SELECT count(*)::int AS count FROM incomes')).toEqual(before);
    expect(await totals(accounts)).toEqual([]);
});

test('insufficient company balance blocks distribution without losing payments or partial closure', async ({ request }) => {
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[0],'500'));await pay(request,payment(odt,accounts[1],'500'));
    await query('UPDATE balances SET balance=0 WHERE id_account=$1 AND id_entity=1',[accounts[1].id_account]);
    const before=await totals(accounts);
    const response=await request.post('/api/public/closure_odt',{data:settle(odt)});
    expect(response.status()).toBe(400);expect((await response.json()).error).toContain('insuficiente');
    expect(await closure(odt.id_odt)).toBeUndefined();expect(await ledger(odt.id_odt)).toEqual([]);expect(await totals(accounts)).toEqual(before);
    await query('UPDATE balances SET balance=500 WHERE id_account=$1 AND id_entity=1',[accounts[1].id_account]);
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(200);
});

test('payment history and currencies cannot be rewritten; later contract increases preserve old conversion', async ({ request }) => {
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[2],'1500000','4000'));
    for(const statement of [
        ['UPDATE odt_payments SET exchange_rate=3000 WHERE id_odt=$1',odt.id_odt],
        ['DELETE FROM odt_payments WHERE id_odt=$1',odt.id_odt],
        ['UPDATE accounts SET id_currency=1 WHERE id_account=$1',accounts[2].id_account],
        ['UPDATE odts SET id_currency=3 WHERE id_odt=$1',odt.id_odt],
        ['UPDATE odts SET amount=374 WHERE id_odt=$1',odt.id_odt]
    ]) await expect(query(statement[0],[statement[1]])).rejects.toThrow();
    await query('UPDATE odts SET amount=1200 WHERE id_odt=$1',[odt.id_odt]);
    const result=await (await request.get('/api/public/odt_payments/'+odt.id_odt)).json();
    expect(result.data).toMatchObject({amount:'1200.0000000000',paid_amount:'375.0000000000',remaining_amount:'825.0000000000'});
});

test('anonymous and unprivileged users cannot post or read payment history', async ({ playwright }) => {
    const {odt,accounts}=await setupPayments();
    const other=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL});
    try {
        for(const status of [401,403]) {
            expect((await other.post('/api/public/odt_payments',{data:payment(odt,accounts[0],'200')})).status()).toBe(status);
            expect((await other.get('/api/public/odt_payments/'+odt.id_odt)).status()).toBe(status);
            if(status===401) await login(other,'test-user-202');
        }
    } finally { await other.dispose(); }
    expect(await totals(accounts)).toEqual([]);
});

test('payment permissions do not bypass ODT ownership', async ({ playwright }) => {
    const {odt,accounts}=await setupPayments({id_user:201});
    const [role]=await query("INSERT INTO roles(name) VALUES('payment-test-role') RETURNING role_id");
    await query("INSERT INTO join_roles_permissions(role_id,permission_id) SELECT $1,permission_id FROM permissions WHERE name='odt_update'",[role.role_id]);
    await query('INSERT INTO join_users_roles(user_id,role_id) VALUES(203,$1)',[role.role_id]);
    const other=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL});
    try {
        await login(other,'test-user-203');
        expect((await other.post('/api/public/odt_payments',{data:payment(odt,accounts[0],'200')})).status()).toBe(403);
        expect((await other.get('/api/public/odt_payments/'+odt.id_odt)).status()).toBe(404);
        expect((await other.get('/api/public/odt_closure_resume/'+odt.id_odt)).status()).toBe(404);
    } finally { await other.dispose(); }
});

for(const [name,amount,rate,equivalent] of [
    ['smallest decimal','0.0000000001','1','0.0000000001'],
    ['fractional rate','21.25','0.85','25.0000000000'],
    ['recurring decimal','1','3','0.3333333333'],
    ['round up','2','3','0.6666666667'],
    ['large exact value','99999999999999999999.9999999999','1','99999999999999999999.9999999999']
]) test('decimal conversion: '+name,async ({request})=>{
    const {odt,accounts}=await setupPayments({amount:equivalent});
    const result=await pay(request,payment(odt,accounts[2],amount,rate));
    expect(result.data.paid_amount).toBe(equivalent);
    const response=await request.post('/api/public/closure_odt',{data:settle(odt,{admin_percent:'0.33333',ceo_percent:'0.33333',admin_users:[{id_user:201,profit_percent:'0.33333'}]})});
    expect((await response.json()).error).toBeUndefined();expect(response.status()).toBe(200);
    expect(await totals(accounts)).toEqual([{id_account:accounts[2].id_account,total:amount.includes('.') ? (amount.split('.')[0]+'.'+(amount.split('.')[1]||'').padEnd(10,'0')) : amount+'.0000000000'}]);
});

test('payments with different exchange rates in the same account keep their own equivalents', async ({request})=>{
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[2],'1500000','3000'));
    const result=await pay(request,payment(odt,accounts[2],'2000000','4000'));
    expect(result.data.paid_amount).toBe('1000.0000000000');expect(result.data.payments.map(p=>p.amount_odt)).toEqual(['500.0000000000','500.0000000000']);
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(200);
    expect(await totals(accounts)).toEqual([{id_account:accounts[2].id_account,total:'3500000.0000000000'}]);
    expect((await query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=2',[accounts[2].id_account]))[0].balance).toBe('700000.0000000000');
});

for(const [name,overrides,company,admin] of [
    ['no commissions',{admin_percent:'0',ceo_percent:'0'},'1000.0000000000','0.0000000000'],
    ['full administration',{admin_percent:'1'},'0.0000000000','1000.0000000000'],
    ['full CEO',{admin_percent:'0',ceo_percent:'1'},'0.0000000000','0.0000000000'],
    ['full employee',{ceo_percent:'0',admin_users:[{id_user:201,profit_percent:'1'}]},'0.0000000000','200.0000000000']
]) test('payment settlement allocation: '+name,async({request})=>{
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[0],'200'));await pay(request,payment(odt,accounts[2],'3200000','4000'));
    const before=await totals(accounts);
    expect((await request.post('/api/public/closure_odt',{data:settle(odt,overrides)})).status()).toBe(200);
    expect(await totals(accounts)).toEqual(before);
    const result=await closure(odt.id_odt);expect(result.taionca_profit).toBe(company);
    const [a]=await query('SELECT round(amount*admin_expense_percent,10)::numeric(30,10) AS amount FROM closure_odts WHERE id_odt=$1',[odt.id_odt]);expect(a.amount).toBe(admin);
    const [conserved]=await query(`SELECT bool_and(expected=actual) AS ok FROM (
        SELECT p.id_account,p.amount AS expected,sum(d.amount) AS actual FROM
        (SELECT id_account,sum(amount) AS amount FROM odt_payments WHERE id_odt=$1 GROUP BY id_account) p
        JOIN closure_odt_allocations d USING(id_account) WHERE id_closure_odt=$2 GROUP BY p.id_account,p.amount) sums`,[odt.id_odt,result.id_closure_odt]);
    expect(conserved.ok).toBe(true);
});

test('paid ODT preserves expense calculations and rejects pending payroll until it is paid',async({request})=>{
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[0],'500'));await pay(request,payment(odt,accounts[2],'2000000','4000'));
    await query(`INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,100,2,'Gasto previo',1,7)`,[accounts[0].id_account,odt.id_odt]);
    await query('INSERT INTO payroll_odt_hours(id_supervisor,id_user,id_odt,hours_spent) VALUES(1,201,$1,8)',[odt.id_odt]);
    let response=await request.post('/api/public/closure_odt',{data:settle(odt)});
    expect(response.status()).toBe(400);expect((await response.json()).error).toContain('nómina');expect(await closure(odt.id_odt)).toBeUndefined();
    await query('UPDATE payroll_odt_hours SET is_paid=true WHERE id_odt=$1',[odt.id_odt]);
    const before=await totals(accounts);
    response=await request.post('/api/public/closure_odt',{data:settle(odt)});expect(response.status()).toBe(200);
    expect(await totals(accounts)).toEqual(before);
    expect(await closure(odt.id_odt)).toMatchObject({general_expense:'200.0000000000',gross_profit:'600.0000000000',taionca_profit:'740.0000000000'});
    await expect(query('UPDATE odts SET amount=1200 WHERE id_odt=$1',[odt.id_odt])).rejects.toThrow();
});

test('loss-making paid closure can be corrected without changing its receipts',async({request})=>{
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[0],'1000'));
    await query(`INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,500,1,'Gasto',1,1)`,[accounts[0].id_account,odt.id_odt]);
    const before=await totals(accounts);
    const response=await request.post('/api/public/closure_odt',{data:settle(odt,{admin_percent:'0.9'})});
    expect(response.status()).toBe(400);expect((await response.json()).error).toContain('no cubre');
    expect(await closure(odt.id_odt)).toBeUndefined();expect(await totals(accounts)).toEqual(before);
    expect((await request.post('/api/public/closure_odt',{data:settle(odt)})).status()).toBe(200);
});

test('ledger failure during allocation rolls back every account and leaves received payments intact',async({request})=>{
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[0],'200'));await pay(request,payment(odt,accounts[2],'3200000','4000'));
    const before=await query('SELECT id_balance,balance FROM balances WHERE id_account=ANY($1) ORDER BY id_balance',[accounts.map(a=>a.id_account)]);
    const receipts=await query('SELECT * FROM odt_payments WHERE id_odt=$1 ORDER BY id_odt_payment',[odt.id_odt]);
    await query(`CREATE FUNCTION test_fail_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type_movement_category='closure_odts' AND EXISTS(SELECT 1 FROM balances WHERE id_balance=NEW.id_balance AND id_account=${accounts[2].id_account} AND id_entity=2)
        THEN RAISE EXCEPTION 'test settlement rollback'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER test_fail_settlement BEFORE INSERT ON balance_movements FOR EACH ROW EXECUTE FUNCTION test_fail_settlement()`);
    try { expect((await request.post('/api/public/closure_odt',{data:settle(odt,{admin_percent:'0.3'})})).status()).toBe(400); }
    finally { await query('DROP TRIGGER test_fail_settlement ON balance_movements; DROP FUNCTION test_fail_settlement()'); }
    expect(await closure(odt.id_odt)).toBeUndefined();
    expect(await ledger(odt.id_odt)).toEqual([]);
    expect(await query('SELECT id_balance,balance FROM balances WHERE id_account=ANY($1) ORDER BY id_balance',[accounts.map(a=>a.id_account)])).toEqual(before);
    expect(await query('SELECT * FROM odt_payments WHERE id_odt=$1 ORDER BY id_odt_payment',[odt.id_odt])).toEqual(receipts);
    expect((await query('SELECT admin_percent FROM odts WHERE id_odt=$1',[odt.id_odt]))[0].admin_percent).toBe('0.20000');
});

test('database function rejects invalid money even if called without the API',async()=>{
    const {odt,accounts}=await setupPayments();
    for(const [amount,rate] of [['-1','1'],['NaN','1'],['200','0'],['200','NaN'],['200','2'],['1001','1']]) {
        const data=payment(odt,accounts[0],amount,rate);
        await expect(query('SELECT register_odt_payment($1,$2,1,$3,$4,$5,$6)',[data.id_odt,data.id_account,data.amount,data.exchange_rate,data.description,data.request_key])).rejects.toThrow();
    }
    expect(await totals(accounts)).toEqual([]);
});

test('read-only ODT permission can inspect but cannot create payments',async({request,playwright})=>{
    const {odt,accounts}=await setupPayments();await pay(request,payment(odt,accounts[0],'200'));
    const [role]=await query("INSERT INTO roles(name) VALUES('payment-reader-role') RETURNING role_id");
    await query("INSERT INTO join_roles_permissions(role_id,permission_id) SELECT $1,permission_id FROM permissions WHERE name='odt_read'",[role.role_id]);
    await query('INSERT INTO join_users_roles(user_id,role_id) VALUES(202,$1)',[role.role_id]);
    const reader=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL});
    try {
        await login(reader,'test-user-202');
        const response=await reader.get('/api/public/odt_payments/'+odt.id_odt);expect(response.status()).toBe(200);
        expect((await response.json()).data.paid_amount).toBe('200.0000000000');
        expect((await reader.post('/api/public/odt_payments',{data:payment(odt,accounts[0],'200')})).status()).toBe(403);
    } finally {await reader.dispose();}
});
