const { test, expect } = require('@playwright/test');
const { query, login, payload, closure, ledger } = require('../helpers/app');

test.beforeEach(async ({ request }) => { await login(request); });

for (const [name, overrides, expected] of [
    ['no commissions', { ceo_percent: '0', admin_percent: '0' }, ['1000.0000000000','1000.0000000000']],
    ['100 percent administration', { admin_percent: '1' }, ['0.0000000000','0.0000000000']],
    ['100 percent CEO', { ceo_percent: '1', admin_percent: '0' }, ['1000.0000000000','0.0000000000']],
    ['100 percent employee', { ceo_percent: '0', admin_users: [{ id_user: 201, profit_percent: '1' }] }, ['800.0000000000','0.0000000000']],
    ['decimal payment', { amount: '1234.56' }, ['987.6480000000','888.8832000000']],
    ['ten decimal payment', { amount: '0.1234567891' }, ['0.0987654313','0.0888888882']],
    ['tiny payment', { amount: '0.0000000001' }, ['0.0000000001','0.0000000001']],
    ['fractional percentage', { ceo_percent: '0.12345' }, ['800.0000000000','701.2400000000']]
]) {
    test('exact decimal arithmetic: ' + name, async ({ request }) => {
        const data = await payload(overrides);
        const response = await request.post('/api/public/closure_odt', { data });
        expect(response.status(), JSON.stringify(await response.json())).toBe(200);
        const result = await closure(data.id_odt);
        expect([result.gross_profit, result.taionca_profit]).toEqual(expected);
        const [sum] = await query(`SELECT sum(m.amount)=c.amount AS reconciled FROM closure_odts c
            JOIN balance_movements m ON m.id_movement_category=c.id_closure_odt AND m.type_movement_category='closure_odts'
            WHERE c.id_odt=$1 GROUP BY c.amount`, [data.id_odt]);
        expect(sum.reconciled).toBe(true);
    });
}

test('general expenses include conversion once and not quantity again', async ({ request }) => {
    const data = await payload();
    await query(`INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,100,2,'Total ya pagado',1,7)`, [data.id_account, data.id_odt]);
    expect((await request.post('/api/public/closure_odt', { data })).status()).toBe(200);
    const result = await closure(data.id_odt);
    expect(result.general_expense).toBe('200.0000000000');
    expect(result.gross_profit).toBe('600.0000000000');
    expect(result.taionca_profit).toBe('740.0000000000');
});

test('both inventory types, exchange rates and all commission groups reconcile', async ({ request }) => {
    const data = await payload({ amount: '10000', admin_users: [{ id_user: 201, profit_percent: '0.1' }],
        operative_users: [{ id_user: 202, profit_percent: '0.2' }], supervisor_users: [{ id_user: 203, profit_percent: '0.05' }] });
    await query(`INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,500,2,'Gasto',1,5)`, [data.id_account, data.id_odt]);
    const [supplier] = await query("INSERT INTO suppliers(name) VALUES('Proveedor de prueba') RETURNING id_supplier");
    for (const [type, price, quantity, rate] of [['spendable',100,3,2], ['no_spendable',50,4,1]]) {
        const [item] = await query(`INSERT INTO ${type}_items(cost,price,id_supplier) VALUES(10,$1,$2) RETURNING id_${type}_item AS id`, [price, supplier.id_supplier]);
        const [stock] = await query(`INSERT INTO ${type}_stocks(id_${type}_item,amount) VALUES($1,100) RETURNING id_${type}_stock AS id`, [item.id]);
        await query(`INSERT INTO ${type}_inv_odt_expenses(id_${type}_stock,id_odt,amount,description,rate) VALUES($1,$2,$3,'Test',$4)`, [stock.id, data.id_odt, quantity, rate]);
    }
    expect((await request.post('/api/public/closure_odt', { data })).status()).toBe(200);
    expect(await closure(data.id_odt)).toMatchObject({ general_expense:'1000.0000000000',inv_expense:'800.0000000000',gross_profit:'6200.0000000000',taionca_profit:'5210.0000000000' });
    const amounts = (await ledger(data.id_odt)).map(row => Number(row.amount)).sort((a,b) => a-b);
    expect(amounts).toEqual([310,620,620,1240,2000,5210]);
});

test('one person in multiple roles receives the sum of their commissions once', async ({ request }) => {
    const data = await payload({ admin_users: [{ id_user: 201, profit_percent: '0.1' }], operative_users: [{ id_user: 201, profit_percent: '0.2' }] });
    expect((await request.post('/api/public/closure_odt', { data })).status()).toBe(200);
    const [user] = await query('SELECT id_entity FROM users WHERE user_id=201');
    const movements = (await ledger(data.id_odt)).filter(row => row.id_entity === user.id_entity);
    expect(movements).toHaveLength(1);
    expect(movements[0].amount).toBe('240.0000000000');
});

test('loss-making closure is rejected without partially updating the ODT', async ({ request }) => {
    const data = await payload({ admin_percent: '0.9' });
    await query(`INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,500,1,'Gasto',1,1)`, [data.id_account, data.id_odt]);
    expect((await request.post('/api/public/closure_odt', { data })).status()).toBe(400);
    expect(await closure(data.id_odt)).toBeUndefined();
    expect((await query('SELECT admin_percent FROM odts WHERE id_odt=$1',[data.id_odt]))[0].admin_percent).toBe('0.20000');
});

test('transaction rolls back even if the ledger fails after creating the closure', async ({ request }) => {
    const data = await payload({ admin_percent:'0.3' });
    const name = 'test_odt_fail_' + data.id_odt;
    await query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.type_movement_category='closure_odts' AND NEW.id_balance IN (SELECT id_balance FROM balances WHERE id_account=${data.id_account} AND id_entity=2)
        THEN RAISE EXCEPTION 'Fallo de prueba'; END IF; RETURN NEW; END; $$;
        CREATE TRIGGER ${name} BEFORE INSERT ON balance_movements FOR EACH ROW EXECUTE PROCEDURE ${name}()`);
    const before = await query('SELECT id_balance,balance FROM balances WHERE id_account=$1 ORDER BY id_balance',[data.id_account]);
    try {
        expect((await request.post('/api/public/closure_odt',{data})).status()).toBe(400);
        expect(await closure(data.id_odt)).toBeUndefined();
        expect(await ledger(data.id_odt)).toEqual([]);
        expect(await query('SELECT id_balance,balance FROM balances WHERE id_account=$1 ORDER BY id_balance',[data.id_account])).toEqual(before);
        expect((await query('SELECT admin_percent FROM odts WHERE id_odt=$1',[data.id_odt]))[0].admin_percent).toBe('0.20000');
    } finally { await query(`DROP TRIGGER ${name} ON balance_movements; DROP FUNCTION ${name}()`); }
});

test('legacy SQL signature uses the same validated destination and cannot double-close', async () => {
    const data = await payload();
    const args = [data.id_account,data.id_odt,1,data.amount,'[]','[]','[]',data.admin_percent,data.ceo_percent];
    const sql='SELECT closure_odt($1,$2,$3,$4,$5,$6,$7,$8,$9)';
    expect((await query(sql,args))[0].closure_odt).toBe('success');
    await expect(query(sql,args)).rejects.toMatchObject({code:'23505'});
});
