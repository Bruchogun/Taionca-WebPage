const { test, expect } = require('@playwright/test');
const { randomUUID } = require('crypto');
const { createOdt, destination, login, payload, query } = require('../helpers/app');
const { assign, client, permission, role, workerUser } = require('../helpers/security');
const { account, income, item } = require('../helpers/audit');

test('los límites y el porcentaje respetan titularidad y cierre de la ODT', async ({ request, playwright }) => {
    await login(request);
    const user = await workerUser();
    const grant = await permission(request, ['odts.limits']);
    await assign(request, user, [await role(request, [grant.permission_id])]);
    const worker = await client(playwright);
    const [own, other, common] = await Promise.all([
        createOdt({ id_user: user.user_id }), createOdt({ id_user: 201 }), createOdt()
    ]);
    const { id_account } = await destination();
    const limit = '/api/public/update_limit_resources';
    const admin = '/api/public/update_admin_percent';
    const limitFor = odt => ({ data: { id_odt: odt.id_odt, id_account, amount: '1.1234567890' } });
    const percentFor = odt => ({ data: { id_odt: odt.id_odt, admin_percent: '0.12345' } });
    try {
        const response = await worker.get('/api/public/get_limit_resources');
        expect(response.status()).toBe(200);
        const visible = (await response.json()).limit_resources.map(row => row.id_odt);
        expect(visible).toEqual(expect.arrayContaining([own.id_odt, common.id_odt]));
        expect(visible).not.toContain(other.id_odt);
        expect((await worker.post(limit, limitFor(own))).status()).toBe(200);
        expect((await worker.post(admin, percentFor(own))).status()).toBe(200);
        expect((await worker.post(limit, limitFor(other))).status()).toBe(403);
        expect((await worker.post(admin, percentFor(other))).status()).toBe(403);
        expect((await request.post('/api/public/closure_odt', { data: await payload({ id_odt: own.id_odt }) })).status()).toBe(200);
        expect((await worker.post(limit, limitFor(own))).status()).toBe(409);
        expect((await worker.post(admin, percentFor(own))).status()).toBe(409);
        expect((await query('SELECT amount FROM limit_resources WHERE id_odt=$1 AND id_account=$2',
            [own.id_odt, id_account]))[0].amount).toBe('1.1234567890');
        expect((await query('SELECT admin_percent FROM odts WHERE id_odt=$1', [other.id_odt]))[0].admin_percent).toBe('0.20000');
    } finally {
        await worker.dispose();
    }
});

test('el historial de facturación interna exige acceso a las dos ODT', async ({ request, playwright }) => {
    await login(request);
    const user = await workerUser();
    const grant = await permission(request, ['odts.read']);
    await assign(request, user, [await role(request, [grant.permission_id])]);
    const worker = await client(playwright);
    const customer = await createOdt({ id_user: user.user_id });
    const supplier = await createOdt({ id_user: 201 });
    const { id_account } = await destination();
    const [{ id_payment }] = await query(
        'SELECT register_odt_payment_amount($1,$2,1,25,25,$3,$4) AS id_payment',
        [supplier.id_odt, id_account, 'Abono interno de prueba', randomUUID()]
    );
    await query(`SELECT register_internal_odt_billing($1,$2,$3,$4,25,
        'Costo interno de prueba',1,1,$5,$6,'{}'::jsonb,NULL)`,
        [customer.id_odt, supplier.id_odt, id_account, id_payment, 'test-cost:' + customer.id_odt, 'test-credit:' + supplier.id_odt]);
    const route = '/api/public/odt_payments/' + customer.id_odt;
    try {
        const response = await worker.get(route);
        expect(response.status()).toBe(200);
        expect((await response.json()).data.internal_billings).toEqual([]);
        const admin = await request.get(route);
        expect(admin.status()).toBe(200);
        expect((await admin.json()).data.internal_billings).toEqual([expect.objectContaining({
            id_customer_odt: customer.id_odt, id_supplier_odt: supplier.id_odt
        })]);
    } finally {
        await worker.dispose();
    }
});

test('un gasto de inventario respeta titularidad y ODT cerrada', async ({ request, playwright }) => {
    await login(request);
    const operator = await workerUser();
    const grant = await permission(request, ['expenses.inventory']);
    await assign(request, operator, [await role(request, [grant.permission_id])]);
    const [own, other] = await Promise.all([
        createOdt({ id_user: operator.user_id }), createOdt({ id_user: 201 })
    ]);
    const source = await account(request);
    await income(request, source, 100);
    const stock = await item(request);
    await query('UPDATE spendable_stocks SET amount=2 WHERE id_spendable_stock=$1', [stock.id_spendable_stock]);
    const worker = await client(playwright);
    const route = '/api/public/spendable_inv_odt_expenses';
    const expense = odt => ({ data: { id_odt: odt.id_odt, id_spendable_stock: stock.id_spendable_stock, amount: '1', description: 'Consumo' } });
    try {
        expect((await worker.post(route, expense(other))).status()).toBe(403);
        expect((await worker.post(route, expense(own))).status()).toBe(200);
        expect((await request.post('/api/public/closure_odt', { data: await payload({ id_odt: own.id_odt }) })).status()).toBe(200);
        expect((await worker.post(route, expense(own))).status()).toBe(409);
        expect((await query('SELECT amount FROM spendable_stocks WHERE id_spendable_stock=$1',
            [stock.id_spendable_stock]))[0].amount).toBe('1.0000000000');
    } finally {
        await worker.dispose();
    }
});
