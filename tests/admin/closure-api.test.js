const { test, expect } = require('@playwright/test');
const { query, login, createOdt, payload, closure, ledger, destination } = require('../helpers/app');

test.beforeEach(async ({ request }) => { await login(request); });

for (const [name, change] of [
    ['missing account', { id_account: null }], ['invalid account ID', { id_account: '1 OR 1=1' }],
    ['missing ODT', { id_odt: null }], ['zero amount', { amount: '0' }], ['negative amount', { amount: '-1' }],
    ['NaN amount', { amount: 'NaN' }], ['infinite amount', { amount: 'Infinity' }],
    ['blank amount', { amount: '' }], ['boolean amount', { amount: true }],
    ['too many decimals', { amount: '1.12345678901' }], ['overflow amount', { amount: '100000000000000000000' }],
    ['negative administrative percent', { admin_percent: '-0.1' }], ['administrative percent over 100', { admin_percent: '1.01' }],
    ['missing CEO percent', { ceo_percent: null }], ['commission total over 100', { ceo_percent: '0.9', admin_users: [{ id_user: 201, profit_percent: '0.2' }] }],
    ['unselected commission user', { admin_users: [{ id_user: null, profit_percent: '0.1' }] }],
    ['duplicate commission user', { admin_users: [{ id_user: 201, profit_percent: '0.1' }, { id_user: 201, profit_percent: '0.1' }] }],
    ['invalid commission percent', { operative_users: [{ id_user: 201, profit_percent: '-0.1' }] }],
    ['non-array commission users', { supervisor_users: {} }]
]) {
    test('rejects ' + name + ' without changing money or percentages', async ({ request }) => {
        const data = await payload();
        const response = await request.post('/api/public/closure_odt', { data: { ...data, ...change } });
        expect(response.status()).toBe(400);
        expect((await response.json()).error).toBeTruthy();
        expect(await closure(data.id_odt)).toBeUndefined();
        expect((await query('SELECT admin_percent FROM odts WHERE id_odt=$1', [data.id_odt]))[0].admin_percent).toBe('0.20000');
        expect(await ledger(data.id_odt)).toEqual([]);
    });
}

test('deposits the complete payment only in the selected account and exposes the destination', async ({ request }) => {
    const data = await payload();
    const before = await query('SELECT id_balance,balance FROM balances ORDER BY id_balance');
    const response = await request.post('/api/public/closure_odt', { data });
    expect(response.status()).toBe(200);
    expect((await response.json()).data).toMatchObject({ id_account: data.id_account, account_name: 'Destino ODT pruebas', amount: '1000.0000000000' });
    const movements = await ledger(data.id_odt);
    expect(movements.map(row => row.id_account)).toEqual(movements.map(() => data.id_account));
    expect(movements.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(1000);
    expect(movements.find(row => row.id_entity === 1).amount).toBe('720.0000000000');
    expect(movements.find(row => row.id_entity === 2).amount).toBe('200.0000000000');
    const unaffected = await query('SELECT id_balance,balance FROM balances WHERE id_account<>$1 ORDER BY id_balance', [data.id_account]);
    expect(unaffected).toEqual(before.filter(row => unaffected.some(item => item.id_balance === row.id_balance)));
    const resume = await (await request.get('/api/public/odt_closure_resume/' + data.id_odt)).json();
    expect(resume.odt_closure_resume).toMatchObject({ account_name: 'Destino ODT pruebas', id_account: data.id_account, paid_amount: '1000.0000000000' });
    const open = await (await request.get('/api/public/odts')).json();
    expect(open.odts.some(odt => odt.id_odt === data.id_odt)).toBe(false);
});

test('rejects another currency and nonexistent accounts or ODTs', async ({ request }) => {
    const data = await payload();
    const [other] = await query('SELECT id_account FROM accounts WHERE id_currency=2 LIMIT 1');
    for (const [change, status] of [[{ id_account: other.id_account }, 400], [{ id_account: 2147483647 }, 404], [{ id_odt: 2147483647 }, 404]]) {
        const response = await request.post('/api/public/closure_odt', { data: { ...data, ...change } });
        expect(response.status()).toBe(status);
        expect(await closure(data.id_odt)).toBeUndefined();
    }
});

test('duplicate and concurrent requests credit the payment exactly once', async ({ request }) => {
    const data = await payload();
    const responses = await Promise.all([1, 2, 3].map(() => request.post('/api/public/closure_odt', { data })));
    expect(responses.map(r => r.status()).sort()).toEqual([200, 409, 409]);
    expect((await ledger(data.id_odt)).reduce((sum, row) => sum + Number(row.amount), 0)).toBe(1000);
});

test('new accounts receive all allocations even without preexisting balances', async ({ request }) => {
    const [account] = await query("INSERT INTO accounts(id_currency,name) VALUES(1,'Cuenta nueva sin saldos') RETURNING id_account");
    const data = await payload({ id_account: account.id_account, admin_users: [{ id_user: 201, profit_percent: '0.1' }] });
    expect((await request.post('/api/public/closure_odt', { data })).status()).toBe(200);
    expect((await ledger(data.id_odt)).length).toBe(4);
    expect((await query('SELECT sum(balance) AS total FROM balances WHERE id_account=$1', [account.id_account]))[0].total).toBe('1000.0000000000');
});

test('rejects users without a ledger entity and rolls back the complete operation', async ({ request }) => {
    const data = await payload({ admin_percent: '0.3', admin_users: [{ id_user: 1, profit_percent: '0.1' }] });
    expect((await request.post('/api/public/closure_odt', { data })).status()).toBe(400);
    expect(await closure(data.id_odt)).toBeUndefined();
    expect((await query('SELECT admin_percent FROM odts WHERE id_odt=$1', [data.id_odt]))[0].admin_percent).toBe('0.20000');
});

test('pending payroll prevents incomplete profit calculations', async ({ request }) => {
    const data = await payload();
    await query('INSERT INTO payroll_odt_hours(id_supervisor,id_user,id_odt,hours_spent) VALUES(1,201,$1,8)', [data.id_odt]);
    const response = await request.post('/api/public/closure_odt', { data });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('nómina');
    expect(await closure(data.id_odt)).toBeUndefined();
    await query('UPDATE payroll_odt_hours SET is_paid=true WHERE id_odt=$1', [data.id_odt]);
    expect((await request.post('/api/public/closure_odt', { data })).status()).toBe(200);
});

test('rejects unauthenticated and unauthorized closures', async ({ playwright }) => {
    const anonymous = await playwright.request.newContext({ baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL });
    const data = await payload();
    expect((await anonymous.post('/api/public/closure_odt', { data })).status()).toBe(401);
    await login(anonymous, 'test-user-204');
    expect((await anonymous.post('/api/public/closure_odt', { data })).status()).toBe(403);
    await anonymous.dispose();
    expect(await closure(data.id_odt)).toBeUndefined();
});

test('ODT ownership is enforced even for a user with closure permission', async ({ playwright }) => {
    const [role] = await query("INSERT INTO roles(name) VALUES('test-closer') RETURNING role_id");
    await query("INSERT INTO join_roles_permissions(role_id,permission_id) SELECT $1,permission_id FROM permissions WHERE name='odt_update'", [role.role_id]);
    await query('INSERT INTO join_users_roles(user_id,role_id) VALUES(204,$1)', [role.role_id]);
    const odt = await createOdt({ id_user: 201 });
    const data = await payload({ id_odt: odt.id_odt });
    const other = await playwright.request.newContext({ baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL });
    await login(other, 'test-user-204');
    expect((await other.post('/api/public/closure_odt', { data })).status()).toBe(403);
    await other.dispose();
    expect(await closure(data.id_odt)).toBeUndefined();
});
