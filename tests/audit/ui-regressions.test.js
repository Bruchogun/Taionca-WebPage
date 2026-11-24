const { test, expect } = require('@playwright/test');
const { login } = require('../helpers/app');

test.use({ locale: 'es-CO', timezoneId: 'America/Bogota' });

test('el inicio de sesión cabe a 320 px y el control de contraseña está en español', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es-CO');
    await expect(page.getByLabel('Contraseña', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
    await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Ocultar contraseña', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('el calendario permite filtrar una fecha colombiana y conserva los cierres de ese día', async ({ page }) => {
    await login(page.request);
    await page.route('**/api/public/closed_odts', route => route.fulfill({ json: {
        odts: [{ id_odt: 901, user_name: 'Operador', name: 'Cliente del último día', amount: '100',
            symbol: '$', created_at: '2030-12-01T16:30:00Z', closed_at: '2030-12-31T22:30:00Z' }]
    } }));
    await page.goto('/');
    const from = page.getByLabel('Fecha inicial', { exact: true });
    const to = page.getByLabel('Fecha final', { exact: true });
    await expect(from).toBeVisible();
    await from.fill('01/12/2030');
    await from.press('Tab');
    await to.fill('31/12/2030');
    await to.press('Tab');
    await expect(to).toHaveValue('31/12/2030');
    await page.getByRole('tab', { name: 'ODTs cerradas en el período', exact: true }).click();
    await page.getByLabel('Seleccionar ODT cerrada', { exact: true }).fill('Cliente del último día');
    await expect(page.locator('.listContainer .item').filter({ hasText: 'Cliente del último día' })).toBeVisible();
});

test('préstamos y deudas siguen visibles al fallar compras y se ordenan por fecha real', async ({ page }) => {
    await login(page.request);
    await page.setViewportSize({ width: 320, height: 720 });
    const companyDebt = { id_owner_user: 1, id_company_debt: 20, account_name: 'Cuenta de prueba',
        name_plural: 'dólares', amount: '20', symbol: '$' };
    await page.route('**/api/public/loans', route => route.fulfill({ json: {
        loan_users: [{ user_id: 1, name: 'Persona de prueba' }],
        loans: [
            { id_user: 1, id_loan: 31, name_plural: 'bitcoins', amount: '1234.567891', code: 'BTC', symbol: '₿' },
            { id_user: 1, id_loan: 30, name_plural: 'dólares', amount: '42.42', symbol: '$' }
        ],
        company_debts: [
            companyDebt,
            { ...companyDebt, id_company_debt: 21, account_name: 'Cuenta BTC',
                name_plural: 'bitcoins', amount: '0.5', code: 'BTC', symbol: '₿' }
        ],
        company_debt_registers: [
            { ...companyDebt, id_company_debt_movement: 101, occurred_at: '2026-02-09T15:00:00Z',
                created_at: '2026-03-17T15:00:00Z', kind: 'repayment', amount: '-0.5', code: 'BTC', symbol: '₿',
                name_plural: 'bitcoins', description: 'Devolución febrero' },
            { ...companyDebt, id_company_debt_movement: 102, occurred_at: '2026-01-12T15:00:00Z',
                created_at: '2026-03-18T15:00:00Z', kind: 'advance', description: 'Adelanto enero' }
        ]
    } }));
    await page.route('**/api/public/loans_registers', route => route.fulfill({ json: { loans_register: [] } }));
    await page.route('**/api/public/unassigned_company_purchases', route => route.fulfill({
        status: 503, json: { error: 'Compras temporalmente fuera de servicio.' }
    }));
    await page.goto('/loans');
    await page.getByLabel('Seleccionar usuario de deudas').fill('Persona de prueba');
    await page.locator('.listContainer .item').filter({ hasText: 'Persona de prueba' }).click();
    await expect(page.getByText('42.42 $', { exact: true })).toBeVisible();
    await expect(page.getByText('1,234.56789 ₿', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Taionca debe al usuario' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '0.50000 ₿', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '-0.50000 ₿', exact: true })).toBeVisible();
    const personalDebts = page.getByRole('table').first();
    await personalDebts.getByRole('button', { name: 'Saldo adeudado', exact: true }).click();
    await expect(personalDebts.locator('tbody tr').first()).toContainText('42.42 $');
    await expect(page.getByText('No se pudieron cargar las compras pendientes de ODT.', { exact: true })).toBeVisible();
    const register = page.locator('.company-history');
    await register.getByRole('button', { name: 'Fecha original', exact: true }).click();
    await expect(register.locator('tbody tr').first()).toContainText('Adelanto enero');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('deudas oculta saldos cero y distingue historial, compras y una persona sin registros', async ({ page }) => {
    await login(page.request);
    const users = [
        { user_id: 1, name: 'Persona sin registros' },
        { user_id: 2, name: 'Persona con historial' },
        { user_id: 3, name: 'Persona con compras' }
    ];
    const loans = users.map(({ user_id }) => ({
        id_loan: user_id, id_user: user_id, name_plural: 'dólares', amount: '0.00', symbol: '$'
    }));
    const companyDebts = users.map(({ user_id }) => ({
        id_company_debt: user_id, id_owner_user: user_id, account_name: 'Cuenta de prueba',
        name_plural: 'dólares', amount: '0.0000000000', symbol: '$'
    }));
    await page.route('**/api/public/loans', route => route.fulfill({ json: {
        loan_users: users, loans, company_debts: companyDebts,
        company_debt_registers: [{ ...companyDebts[1], id_company_debt_movement: 101,
            occurred_at: null, created_at: '2026-03-17T15:00:00Z', kind: 'repayment',
            amount: '20', description: 'Adelanto devuelto' }]
    } }));
    let releaseHistory;
    const pendingHistory = new Promise(resolve => { releaseHistory = resolve; });
    await page.route('**/api/public/loans_registers', async route => {
        await pendingHistory;
        await route.fulfill({ json: { loans_register: [{ ...loans[1], id_loans_register: 21,
            created_at: '2026-03-17T15:00:00Z', description: 'Préstamo saldado' }] } });
    });
    await page.route('**/api/public/unassigned_company_purchases', route => route.fulfill({ json: {
        unassigned_company_purchases: [
            { id_purchase: 'compra-1', owner_user_id: 3, owner_name: users[2].name,
                currency_code: 'USD', amount: '1234.5', description: 'Compra por conciliar',
                sheet_title: 'Hoja de prueba', source_cell: 'C6' },
            { id_purchase: 'compra-2', owner_user_id: 3, owner_name: users[2].name,
                currency_code: 'BTC', amount: '0.0500000002', description: 'Compra BTC mayor',
                sheet_title: 'Hoja de prueba', source_cell: 'C7' },
            { id_purchase: 'compra-3', owner_user_id: 3, owner_name: users[2].name,
                currency_code: 'BTC', amount: '0.0500000001', description: 'Compra BTC menor',
                sheet_title: 'Hoja de prueba', source_cell: 'C8' }
        ]
    } }));

    await page.goto('/loans');
    const selector = page.getByLabel('Seleccionar usuario de deudas');
    const empty = page.getByText('Sin saldos ni movimientos registrados.', { exact: true });
    const select = async name => {
        await selector.fill(name);
        await page.locator('.listContainer .item').filter({ hasText: name }).click();
    };
    await expect(selector).toBeVisible();
    await expect(empty).toHaveCount(0);

    try {
        await select(users[0].name);
        await expect(page.getByText('Cargando deudas…', { exact: true })).toBeVisible();
        await expect(empty).toHaveCount(0);
    } finally {
        releaseHistory();
    }

    await expect(empty).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    await select(users[1].name);
    await expect(page.getByText('Préstamo saldado', { exact: true })).toBeVisible();
    await expect(page.getByText('Adelanto devuelto', { exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(2);
    await expect(empty).toHaveCount(0);

    await select(users[2].name);
    await expect(page.getByText('Compra por conciliar', { exact: true })).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(1);
    await expect(page.getByRole('cell', { name: '1,234.50', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: '0.05000', exact: true })).toHaveCount(2);
    await page.getByRole('button', { name: 'Importe', exact: true }).click();
    await expect(page.locator('.purchase-history tbody tr').first()).toContainText('Compra BTC menor');
    await expect(empty).toHaveCount(0);
});

test('cambiar de ODT cerrada descarta movimientos viejos y muestra facturas e importe sin abonos', async ({ page }) => {
    await login(page.request);
    const odts = [920, 921].map(id => ({ id_odt: id, name: 'Cliente ' + id, user_name: 'Operario',
        amount: id === 921 ? '1.23456789' : '100', symbol: id === 921 ? '₿' : '$',
        created_at: '2026-01-02T12:00:00Z', closed_at: '2026-02-01T12:00:00Z' }));
    const summarize = id => ({ odt_closure_resume: { account_name: 'Destino ' + id, paid_amount: '100',
        admin_expense_percent: 0, admin_profit: '0', taionca_profit: '100', general_expenses: '0',
        inv_expenses: '0', ceo_commissions: [], admin_commissions: [], operative_commissions: [], supervisor_commissions: [] },
        payments: { id_odt: id, payments: [], allocations: [], currency_code: id === 921 ? 'BTC' : 'USD',
            settlement_amount: '0', original_contract_amount: id === 921 ? '1.23456789' : '100',
            internal_billings: [{ id_internal_odt_billing: 8, id_customer_odt: id,
                id_supplier_odt: 930, amount: '40', currency_code: 'USD', id_odt_payment: 15 }] } });
    const movement = id => ({ balance_movements: [{ id_balance: id, id_balance_movement: id, entity: 'Taionca',
        account: 'Cuenta ' + id, amount: id === 921 ? '-0.12345678' : '12', end_balance: '30',
        currency: id === 921 ? 'Bitcoins' : 'Dólares', currency_code: id === 921 ? 'BTC' : 'USD', symbol: id === 921 ? '₿' : '$',
        created_at: '2026-01-12T12:00:00Z' }] });

    let releaseOld;
    const oldResponse = new Promise(resolve => { releaseOld = resolve; });
    await page.route('**/api/public/closed_odts', route => route.fulfill({ json: { odts } }));
    await page.route('**/api/public/odt_closure_resume/*', route => route.fulfill({
        json: summarize(Number(new URL(route.request().url()).pathname.split('/').pop()))
    }));
    await page.route('**/api/public/odt_movements/*', async route => {
        const id = Number(new URL(route.request().url()).pathname.split('/').pop());
        if (id === 920) await oldResponse;
        const json = movement(id);
        if (id === 920) json.success = 'Respuesta anterior recibida.';
        await route.fulfill({ json });
    });
    try {
        await page.goto('/odts_review');
        await page.getByRole('tab', { name: 'ODTs cerradas', exact: true }).click();
        const selector = page.getByLabel('Seleccionar ODT cerrada', { exact: true });
        const started = page.waitForRequest('**/api/public/odt_movements/920');
        await selector.fill('Cliente 920');
        await page.locator('.listContainer .item').filter({ hasText: 'Cliente 920' }).click();
        await started;
        await selector.fill('Cliente 921');
        await page.locator('.listContainer .item').filter({ hasText: 'Cliente 921' }).click();
        await expect(page.getByText('Destino 921', { exact: false })).toBeVisible();
        const finished = page.waitForResponse('**/api/public/odt_movements/920');
        releaseOld();
        await (await finished).finished();
        await expect(page.getByText('Respuesta anterior recibida.', { exact: true })).toBeVisible();
        await expect(page.getByText('Cuenta 921', { exact: true })).toBeVisible();
        await expect(page.getByText('Cuenta 920', { exact: true })).toHaveCount(0);
        const history = page.getByRole('region', { name: 'Historial de abonos' });
        await expect(history).toContainText('Gasto por ODT 930');
        await expect(history).toContainText('Importe final: 0.00000 BTC');
        await expect(history).toContainText('Contrato original: 1.23457 BTC');
        await expect(history).toContainText('40.00 USD');
        await expect(page.getByText('Monto de contrato: ₿1.23457')).toBeVisible();
        await expect(page.getByRole('cell', { name: '₿ -0.12346', exact: true })).toBeVisible();
        await expect(page.getByRole('cell', { name: '-0.12346', exact: true })).toBeVisible();
    } finally {
        releaseOld();
    }
});

test('filtrar permisos del rol conserva los seleccionados que quedan ocultos', async ({ page }) => {
    await login(page.request);
    const role = { role_id: 8, name: 'Rol de prueba', permission_ids: [31, 32], revision: 'revision-original' };
    const permissions = [
        { permission_id: 31, name: 'Primer permiso', capabilities: [] },
        { permission_id: 32, name: 'Segundo permiso', capabilities: [] }
    ];
    await page.route('**/api/admin/security', route => route.fulfill({ json: {
        users: [], roles: [role], permissions, events: [], capabilities: []
    } }));
    let sent;
    await page.route('**/api/admin/roles/8', route => {
        sent = route.request().postDataJSON();
        role.permission_ids = sent.permission_ids;
        role.revision = 'revision-actualizada';
        return route.fulfill({ json: { success: 'Prueba guardada.', data: { role_id: 8 } } });
    });
    await page.goto('/administracion_permisos');
    await page.getByRole('button', { name: 'Roles', exact: true }).click();
    await page.getByLabel('Rol', { exact: true }).selectOption('8');
    await page.getByLabel('Filtrar permisos del rol').fill('Primer permiso');
    await page.getByRole('checkbox', { name: /Primer permiso/ }).uncheck();
    await page.getByRole('button', { name: 'Guardar rol', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Prueba guardada.' })).toBeVisible();
    expect(sent).toMatchObject({ permission_ids: [32], revision: 'revision-original' });
    await page.getByLabel('Filtrar permisos del rol').fill('');
    await expect(page.getByRole('checkbox', { name: /Segundo permiso/ })).toBeChecked();
});
