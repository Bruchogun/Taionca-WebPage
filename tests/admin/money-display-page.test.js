const { test, expect } = require('@playwright/test');
const { createOdt, login, query } = require('../helpers/app');

test('open ODT, payments and account balances display five BTC decimals and two USD decimals', async ({ page }) => {
    await login(page.request);
    const [bitcoin] = await query("SELECT id_currency, symbol FROM currencys WHERE upper(code) = 'BTC'");
    const btc = await createOdt({ id_currency: bitcoin.id_currency, amount: '0.1234567890' });
    const usd = await createOdt({ amount: '30' });
    const [account] = await query('INSERT INTO accounts(id_currency, name) VALUES($1, $2) RETURNING id_account, name',
        [bitcoin.id_currency, 'Saldo BTC para prueba de formato']);
    await query('INSERT INTO balances(id_account, id_entity, balance) VALUES($1, 1, $2)', [account.id_account, btc.amount]);

    await page.goto('/odts_review');
    await page.getByPlaceholder('Odts abiertas...').fill(String(btc.id_odt));
    await page.locator('.listContainer .item').filter({ hasText: new RegExp(`^${btc.id_odt} \\|`) }).click();
    await expect(page.getByText(`Monto de contrato: 0.12346 ${bitcoin.symbol}`)).toBeVisible();
    await expect(page.getByText(/Abonado: 0\.00000 BTC.*Pendiente: 0\.12346 BTC/i)).toBeVisible();
    await page.getByRole('link', { name: 'Registrar abonos de esta ODT' }).click();
    await expect(page.getByTestId('payment-summary')).toContainText(/Pendiente: 0\.12346 BTC/i);

    await page.goto(`/abonos_odt?odt=${usd.id_odt}`);
    await expect(page.getByTestId('payment-summary')).toContainText('Abonado: 0.00 USD');
    await expect(page.getByTestId('payment-summary')).toContainText('Pendiente: 30.00 USD');

    await page.goto('/');
    await expect(page.getByRole('row').filter({ hasText: account.name })).toContainText('0.12346');
    const [stored] = await query('SELECT amount FROM odts WHERE id_odt = $1', [btc.id_odt]);
    expect(stored.amount).toBe('0.1234567890');
});
