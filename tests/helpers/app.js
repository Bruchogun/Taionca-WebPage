const { Client } = require('pg');
const { expect } = require('@playwright/test');

function assertTestDatabase() {
    const name = process.env.TAIONCA_TEST_DATABASE;
    if (!name || !/^taionca_test_odt_\d+$/.test(name) || new URL(process.env.DATABASE_URL).pathname !== '/' + name) {
        throw new Error('Refusing to run tests outside the isolated database.');
    }
}
async function query(sql, params) {
    assertTestDatabase();
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try { return (await client.query(sql, params)).rows; }
    finally { await client.end(); }
}
async function login(request, username = 'admin') {
    const response = await request.post('/api/public/login', { data: { username, password: 'test-admin-odt' } });
    const body = await response.json();
    expect(body.error).toBeUndefined();
    return body.session;
}
async function createOdt(overrides = {}) {
    const [odt] = await query(`INSERT INTO odts(id_client,id_user,id_currency,id_entity,amount,description,admin_percent)
        VALUES(1,$1,$2,1,$3,'ODT de prueba automatizada',$4) RETURNING *`,
        [overrides.id_user || 1, overrides.id_currency || 1, overrides.amount || '1000', overrides.admin_percent === undefined ? '0.2' : overrides.admin_percent]);
    return odt;
}
async function destination() {
    return (await query("SELECT * FROM accounts WHERE name='Destino ODT pruebas'"))[0];
}
async function payload(overrides = {}) {
    const odt = await createOdt();
    const account = await destination();
    return { id_odt: odt.id_odt, id_account: account.id_account, amount: '1000',
        admin_percent: '0.2', ceo_percent: '0.1', admin_users: [], operative_users: [], supervisor_users: [], ...overrides };
}
async function closure(id) {
    return (await query('SELECT * FROM closure_odts WHERE id_odt=$1', [id]))[0];
}
async function ledger(id) {
    return query(`SELECT m.*, b.id_account,b.id_entity FROM balance_movements m JOIN balances b USING(id_balance)
        JOIN closure_odts c ON c.id_closure_odt=m.id_movement_category
        WHERE m.type_movement_category='closure_odts' AND c.id_odt=$1 ORDER BY b.id_entity`, [id]);
}
async function selectOdt(page, id) {
    const input = page.locator('form .selectContainer input').first();
    await input.fill(String(id));
    await page.locator('.listContainer .item').filter({ hasText: new RegExp('^' + id + ' \\|') }).click();
}
async function selectAccount(page, name = 'Destino ODT pruebas') {
    await page.locator('form .selectContainer').nth(1).locator('input').fill(name);
    await page.locator('.listContainer .item').filter({ hasText: name }).click();
}
module.exports = { query, login, createOdt, destination, payload, closure, ledger, selectOdt, selectAccount };
