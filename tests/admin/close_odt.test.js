const { test, expect } = require('@playwright/test');
const { query, login, createOdt, closure, ledger, selectOdt, selectAccount } = require('../helpers/app');

test.beforeEach(async ({ page }) => { await login(page.request); });

test('end to end: choose account, close, verify receipt, ledger, balances and history', async ({ page }) => {
    const errors=[]; page.on('pageerror', e => errors.push(e.message));
    const odt=await createOdt({amount:'2345.67'});
    await page.goto('/cerrar_odt');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await selectOdt(page,odt.id_odt);
    await expect(page.getByLabel('Monto pagado')).toHaveValue('2345.67');
    await selectAccount(page);
    await expect(page.getByText('Destino:',{exact:false})).toContainText('Destino ODT pruebas');
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Se registraron'})).toContainText('2,345.67');
    await expect(page.getByRole('status').filter({hasText:'Se registraron'})).toContainText('Destino ODT pruebas');
    const result=await closure(odt.id_odt);
    expect(result.amount).toBe('2345.6700000000');
    const movements=await ledger(odt.id_odt);
    expect(movements.every(m => m.id_account===result.id_account)).toBe(true);
    await page.getByPlaceholder('Odts abiertas...').fill(String(odt.id_odt));
    await expect(page.locator('.listContainer .item').filter({hasText:new RegExp('^'+odt.id_odt+' \\|')})).toHaveCount(0);
    await page.goto('/odts_review');
    await page.getByText('ODTs cerradas',{exact:true}).click();
    await page.getByPlaceholder('Odts cerradas...').fill(String(odt.id_odt));
    await page.locator('.listContainer .item').filter({hasText:new RegExp('^'+odt.id_odt+' \\|')}).click();
    await expect(page.getByText('Cuenta de destino: Destino ODT pruebas')).toBeVisible();
    await expect(page.getByText('Monto recibido: $2,345.67')).toBeVisible();
    await page.goto('/');
    await expect(page.locator('tr').filter({hasText:'Destino ODT pruebas'})).toBeVisible();
    expect(errors).toEqual([]);
});

test('switching ODT clears the account even with the same currency; currency filter updates', async ({ page }) => {
    const first=await createOdt(); const same=await createOdt(); const other=await createOdt({id_currency:2});
    await page.goto('/cerrar_odt'); await selectOdt(page,first.id_odt); await selectAccount(page);
    await selectOdt(page,same.id_odt);
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await selectAccount(page);
    await selectOdt(page,other.id_odt);
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await page.getByPlaceholder('Selecciona la cuenta de destino...').click();
    await expect(page.locator('.listContainer .item').filter({hasText:'Destino ODT pruebas'})).toHaveCount(0);
    await expect(page.locator('.listContainer .item').first()).toContainText('(Bs)');
});

test('editing percentages preserves the entered value and rejects excessive totals', async ({ page }) => {
    const odt=await createOdt(); await page.goto('/cerrar_odt'); await selectOdt(page,odt.id_odt); await selectAccount(page);
    await page.getByLabel('Porcentaje administrativo (%)').fill('12.345');
    await page.getByLabel('Porcentaje del presidente (%)').fill('100');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeEnabled();
    await page.getByLabel('Porcentaje del presidente (%)').fill('101');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await page.getByLabel('Porcentaje del presidente (%)').fill('10');
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Se registraron'})).toBeVisible();
    expect((await closure(odt.id_odt)).admin_expense_percent).toBe('0.12345');
});

test('commission rows can be added, cleared and removed without exceptions', async ({ page }) => {
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    const odt=await createOdt(); await page.goto('/cerrar_odt'); await selectOdt(page,odt.id_odt); await selectAccount(page);
    await page.getByRole('button',{name:'Agregar usuario'}).first().click();
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await page.getByRole('button',{name:'Borrar'}).click();
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeEnabled();
    expect(errors).toEqual([]);
});

test('server rejection preserves inputs and allows correction', async ({ page }) => {
    const odt=await createOdt();
    await query('INSERT INTO payroll_odt_hours(id_supervisor,id_user,id_odt,hours_spent) VALUES(1,201,$1,8)',[odt.id_odt]);
    await page.goto('/cerrar_odt'); await selectOdt(page,odt.id_odt); await selectAccount(page);
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.locator('form [role="alert"]')).toContainText('nómina');
    await expect(page.getByLabel('Monto pagado')).toHaveValue('1000');
    await expect(page.getByText('Destino:',{exact:false})).toContainText('Destino ODT pruebas');
    expect(await closure(odt.id_odt)).toBeUndefined();
    await query('UPDATE payroll_odt_hours SET is_paid=true WHERE id_odt=$1',[odt.id_odt]);
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Se registraron'})).toBeVisible();
});

test('no matching accounts shows an actionable message', async ({ page }) => {
    const [currency]=await query("INSERT INTO currencys(name_singular,name_plural,symbol,code) VALUES('prueba','pruebas','T','TST') RETURNING id_currency");
    const odt=await createOdt({id_currency:currency.id_currency});
    await page.goto('/cerrar_odt'); await selectOdt(page,odt.id_odt);
    await expect(page.getByRole('status').filter({hasText:'No hay cuentas'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
});

test('account load failure leaves closure disabled and shows the error', async ({ page }) => {
    const odt=await createOdt();
    await page.route('**/api/public/accounts',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Cuentas no disponibles'})}));
    await page.goto('/cerrar_odt'); await selectOdt(page,odt.id_odt);
    await expect(page.getByRole('alert').filter({hasText:'No se pudieron cargar las cuentas'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
});

test('mobile closure form stays within the viewport', async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    const odt=await createOdt(); await page.goto('/cerrar_odt'); await selectOdt(page,odt.id_odt); await selectAccount(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeVisible();
});


test('a commission selected in the page reaches the matching user ledger', async ({ page }) => {
    const odt=await createOdt(); await page.goto('/cerrar_odt'); await selectOdt(page,odt.id_odt); await selectAccount(page);
    await page.getByRole('button',{name:'Agregar usuario'}).first().click();
    const userInput=page.locator('form .selectContainer').nth(2).locator('input');
    await userInput.fill('Test');
    await page.locator('.listContainer .item').filter({hasText:'Test'}).first().click();
    await page.getByLabel('Porcentaje de comisión (%)',{exact:true}).fill('12.5');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeEnabled();
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'Se registraron'})).toBeVisible();
    const commissions=await query('SELECT a.profit FROM admin_closure_odts a JOIN closure_odts c USING(id_closure_odt) WHERE c.id_odt=$1',[odt.id_odt]);
    expect(commissions).toEqual([{profit:'100.0000000000'}]);
});
