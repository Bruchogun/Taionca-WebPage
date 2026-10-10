const { randomUUID } = require('crypto');
const { expect } = require('@playwright/test');
const { query, createOdt } = require('./app');

async function setupPayments(overrides = {}) {
    const odt = await createOdt(overrides);
    const accounts = await query(`INSERT INTO accounts(id_currency,name) VALUES
        (1,$1),(1,$2),(3,$3) RETURNING *`, ['Abonos USD A '+odt.id_odt, 'Abonos USD B '+odt.id_odt, 'Abonos COP '+odt.id_odt]);
    return { odt, accounts };
}
function payment(odt, account, amount, rate = '1', overrides = {}) {
    return { id_odt: odt.id_odt, id_account: account.id_account, amount,
        exchange_rate: rate, description: 'Pago de prueba', request_key: randomUUID(), ...overrides };
}
async function pay(request, data) {
    const response = await request.post('/api/public/odt_payments', { data });
    const result = await response.json();
    expect(result.error).toBeUndefined();
    expect(response.status()).toBe(200);
    return result;
}
async function totals(accounts) {
    return query(`SELECT id_account,sum(balance)::numeric(30,10) AS total FROM balances
        WHERE id_account=ANY($1) GROUP BY id_account ORDER BY id_account`, [accounts.map(a=>a.id_account)]);
}
function settle(odt, overrides = {}) {
    return { id_odt: odt.id_odt, id_account: null, settle_payments: true, amount: odt.amount,
        admin_percent: '0.2', ceo_percent: '0.1', admin_users: [], operative_users: [], supervisor_users: [], ...overrides };
}
module.exports = { setupPayments, payment, pay, totals, settle };
