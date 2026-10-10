const { test, expect } = require('@playwright/test');
const { query, login, closure, selectOdt, selectAccount } = require('../helpers/app');
const { setupPayments, payment, pay, totals } = require('../helpers/payments');

test.beforeEach(async ({page})=>{await login(page.request);});

async function fillPayment(page, account, amount, equivalent) {
    await selectAccount(page,account.name);
    await page.getByLabel(/Monto del abono/).fill(amount);
    if(equivalent) await page.getByLabel(/Equivalente del abono en /).fill(equivalent);
}
async function submitPayment(page) {
    await page.getByRole('button',{name:'Registrar abono',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'El dinero ya está disponible'})).toBeVisible();
}

test('browser receives progressive USD/COP payments, displays balances and closes without another deposit', async ({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {odt,accounts}=await setupPayments();
    await page.goto('/abonos_odt');await selectOdt(page,odt.id_odt);
    await fillPayment(page,accounts[0],'200');await submitPayment(page);
    await expect(page.getByTestId('payment-summary')).toContainText('Abonado: 200.00 USD');
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'200.0000000000'}]);
    await fillPayment(page,accounts[1],'300');await submitPayment(page);
    await fillPayment(page,accounts[2],'1500000','375');
    await expect(page.getByLabel('Equivalente del abono en USD')).toHaveValue('375');
    await page.getByLabel('Referencia o descripción del abono').fill('Transferencia de Colombia');
    await submitPayment(page);
    await expect(page.getByTestId('payment-summary')).toContainText('Pendiente: 125.00 USD');
    await expect(page.getByRole('region',{name:'Historial de abonos'})).toContainText('1,500,000 COP');
    await expect(page.getByRole('region',{name:'Historial de abonos'})).toContainText('Importe indicado manualmente');
    await page.getByRole('link',{name:'Revisar y cerrar esta ODT'}).click();
    await expect(page.getByTestId('closure-payment-summary')).toContainText('Pendiente: 125.00 USD');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await page.getByRole('link',{name:'Registrar abonos en una o varias cuentas'}).click();
    await expect(page.getByTestId('payment-summary')).toContainText('875.00 USD');
    await fillPayment(page,accounts[0],'125');await submitPayment(page);
    await expect(page.getByRole('status').filter({hasText:'completamente pagada'})).toBeVisible();
    const before=await totals(accounts);
    await page.getByRole('link',{name:'Revisar y cerrar esta ODT'}).click();
    await expect(page.getByTestId('closure-payment-summary')).toContainText('Pendiente: 0.00 USD');
    await expect(page.getByLabel('Monto pagado')).toHaveCount(0);
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'cerrada con sus abonos'})).toContainText('1,000.00');
    expect(await totals(accounts)).toEqual(before);
    expect((await closure(odt.id_odt)).settled_from_payments).toBe(true);
    await page.goto('/odts_review');await page.getByText('ODTs cerradas',{exact:true}).click();
    await page.getByPlaceholder('Odts cerradas...').fill(String(odt.id_odt));
    await page.locator('.listContainer .item').filter({hasText:new RegExp('^'+odt.id_odt+' \\|')}).click();
    await expect(page.getByRole('region',{name:'Historial de abonos'})).toContainText('Transferencia de Colombia');
    await expect(page.getByRole('heading',{name:'Distribución del cierre'})).toBeVisible();
    await expect(page.getByText('Monto de contrato: $1,000.00')).toBeVisible();
    await page.goto('/');await expect(page.locator('tr').filter({hasText:accounts[2].name})).toBeVisible();
    expect(errors).toEqual([]);
});

test('a lost response and page reload retry the same payment key exactly once', async ({page})=>{
    const {odt,accounts}=await setupPayments();
    let posts=0;
    await page.route('**/api/public/odt_payments',async route=>{
        posts++;
        if(posts===1){await route.fetch();await route.abort('failed');}
        else await route.continue();
    });
    await page.goto('/abonos_odt?odt='+odt.id_odt);
    await fillPayment(page,accounts[0],'200');await page.getByRole('button',{name:'Registrar abono',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('sin duplicarla');
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'200.0000000000'}]);
    await page.reload();
    await expect(page.getByRole('button',{name:'Reintentar abono'})).toBeEnabled();
    await page.getByRole('button',{name:'Reintentar abono'}).click();
    await expect(page.getByRole('status').filter({hasText:'El dinero ya está disponible'})).toBeVisible();
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'200.0000000000'}]);
    expect((await query('SELECT count(*)::int AS count FROM odt_payments WHERE id_odt=$1',[odt.id_odt]))[0].count).toBe(1);
    expect(await page.evaluate(id=>sessionStorage.getItem('odt-payment-'+id),odt.id_odt)).toBeNull();
});

test('changing accounts or ODT clears manual equivalents and form amounts', async ({page})=>{
    const first=await setupPayments();const second=await setupPayments();
    await page.goto('/abonos_odt');await selectOdt(page,first.odt.id_odt);
    await fillPayment(page,first.accounts[0],'200');
    await selectAccount(page,first.accounts[2].name);
    await expect(page.getByLabel(/Equivalente del abono en /)).toHaveValue('');
    await expect(page.getByRole('button',{name:'Registrar abono',exact:true})).toBeDisabled();
    await page.getByLabel(/Equivalente del abono en /).fill('375');
    await selectOdt(page,second.odt.id_odt);
    await expect(page.getByLabel(/Monto del abono/)).toHaveValue('');
    await expect(page.getByLabel(/Equivalente del abono en /)).toHaveCount(0);
    await expect(page.getByRole('button',{name:'Registrar abono',exact:true})).toBeDisabled();
});

test('overpayment rejection preserves entered amount and allows correcting it', async ({page})=>{
    const {odt,accounts}=await setupPayments();await page.goto('/abonos_odt?odt='+odt.id_odt);
    await fillPayment(page,accounts[0],'1001');await page.getByRole('button',{name:'Registrar abono',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('supera el saldo');
    await expect(page.getByLabel(/Monto del abono/)).toHaveValue('1001');
    expect(await totals(accounts)).toEqual([]);
    await page.getByLabel(/Monto del abono/).fill('1000');await submitPayment(page);
    expect(await totals(accounts)).toEqual([{id_account:accounts[0].id_account,total:'1000.0000000000'}]);
});

test('summary load failures cannot enable a payment or an unsafe direct closure', async ({page})=>{
    const {odt}=await setupPayments();
    await page.route('**/api/public/odt_payments/*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Abonos no disponibles'})}));
    await page.goto('/abonos_odt?odt='+odt.id_odt);
    await expect(page.locator('form [role="alert"]')).toBeVisible();
    await expect(page.getByRole('button',{name:'Registrar abono',exact:true})).toBeDisabled();
    await page.goto('/cerrar_odt?odt='+odt.id_odt);
    await expect(page.locator('form [role="alert"]')).toContainText('Abonos no disponibles');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
});

test('open ODT review shows received payments separately from expenses', async ({page})=>{
    const {odt,accounts}=await setupPayments();await pay(page.request,payment(odt,accounts[2],'1500000','4000'));
    await page.goto('/odts_review');await page.getByPlaceholder('Odts abiertas...').fill(String(odt.id_odt));
    await page.locator('.listContainer .item').filter({hasText:new RegExp('^'+odt.id_odt+' \\|')}).click();
    await expect(page.getByRole('region',{name:'Historial de abonos'})).toContainText('375 USD');
    await expect(page.getByRole('link',{name:'Registrar abonos de esta ODT'})).toHaveAttribute('href','/abonos_odt?odt='+odt.id_odt);
    await expect(page.getByText('Gastos de la ODT',{exact:true})).toHaveCount(0);
});

test('mobile payment form and history fit the viewport', async ({page})=>{
    await page.setViewportSize({width:390,height:844});
    const {odt,accounts}=await setupPayments();await page.goto('/abonos_odt?odt='+odt.id_odt);
    await fillPayment(page,accounts[2],'1500000','375');
    await page.getByLabel('Referencia o descripción del abono').fill('REFERENCIA'.repeat(40));await submitPayment(page);
    await expect(page.getByRole('region',{name:'Historial de abonos'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
