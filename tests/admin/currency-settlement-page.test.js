const {test,expect}=require('@playwright/test');
const {query,login,closure}=require('../helpers/app');
const {scenario,expense}=require('../helpers/settlement');
const {totals}=require('../helpers/payments');
test.beforeEach(async({page})=>{await login(page.request);});
async function openClose(page,odt) {
    await page.goto('/cerrar_odt?odt='+odt.id_odt);
    await expect(page.getByLabel('Forma de cierre')).toBeVisible();
}
async function manualExpense(page,key,currency,amount) {
    const row=page.locator('[data-expense="'+key+'"]');
    await row.getByRole('combobox').selectOption(String(currency));
    await row.getByLabel(new RegExp('Importe del gasto '+key)).fill(amount);
}

test('three mini closures are shown with native income, their own expenses and separate percentages',async({page})=>{
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const {odt,accounts}=await scenario(page.request);await expense(odt,accounts[0],'1000');await expense(odt,accounts[1],'1000000');await expense(odt,accounts[2],'1020080');
    await openClose(page,odt);
    await expect(page.getByTestId('part-summary-1')).toContainText('Ingresos: 5,000 USD');
    await expect(page.getByTestId('part-summary-3')).toContainText('Gastos generales: 1,000,000 COP');
    await expect(page.getByTestId('part-summary-2')).toContainText('Ingresos: 10,200,800 VES');
    await page.getByLabel('Presidente en COP (%)').fill('20');
    await expect(page.getByTestId('part-summary-3')).toContainText('Administración y comisiones a repartir: 3,400,000 COP');
    const before=await totals(accounts);
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'cerrada con sus abonos'})).toBeVisible();
    expect(await totals(accounts)).toEqual(before);
    await page.goto('/odts_review');await page.getByText('ODTs cerradas',{exact:true}).click();
    await page.getByPlaceholder('Odts cerradas...').fill(String(odt.id_odt));await page.locator('.listContainer .item').filter({hasText:new RegExp('^'+odt.id_odt+' \\|')}).click();
    const history=page.getByRole('region',{name:'Resultados del cierre por moneda'});
    await expect(history).toContainText('USD · Ingresos: 5,000');await expect(history).toContainText('COP · Ingresos: 10,000,000');
    await expect(history).toContainText('VES · Ingresos: 10,200,800');
    expect(errors).toEqual([]);
});

test('negative currency automatically opens expense assignment and requires an explicit converted amount',async({page})=>{
    const {odt,accounts}=await scenario(page.request,{amount:'1000',payments:[['900','900'],['100','100']]});
    const key=await expense(odt,accounts[1],'200','Todo el gasto en COP','200');
    await openClose(page,odt);
    await expect(page.getByRole('status').filter({hasText:'utilidad negativa'})).toBeVisible();
    const row=page.locator('[data-expense="'+key+'"]');await expect(row).toBeVisible();
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await row.getByRole('combobox').selectOption('1');
    await expect(row.getByLabel(new RegExp('Importe del gasto '+key))).toHaveValue('');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await row.getByLabel(new RegExp('Importe del gasto '+key)).fill('25');
    await expect(page.getByTestId('part-summary-1')).toContainText('Utilidad para comisiones: 695 USD');
    await expect(page.getByTestId('part-summary-3')).toContainText('Utilidad para comisiones: 80 COP');
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'cerrada con sus abonos'})).toBeVisible();
});

test('single original currency records manually entered bank debit and credit amounts from the page',async({page})=>{
    const {odt,accounts}=await scenario(page.request);
    const [destination]=await query("INSERT INTO accounts(id_currency,name) VALUES(1,'Reparto manual desde navegador') RETURNING *");
    await openClose(page,odt);
    await page.getByLabel('Forma de cierre').selectOption('original');
    await page.getByLabel('Cuenta para pagar el reparto').selectOption(String(destination.id_account));
    await expect(page.getByTestId('part-summary-1')).toContainText('Ingresos: 10,000 USD');
    await page.getByText('Cambios de moneda para disponer de saldo en la cuenta de reparto',{exact:true}).click();
    await page.getByRole('button',{name:'Agregar cambio manual'}).click();
    await page.getByLabel('Origen del cambio 1').selectOption(String(accounts[1].id_account));
    await page.getByLabel('Monto que sale en el cambio 1').fill('9000000');
    await page.getByLabel('Monto que llega en USD en el cambio 1').fill('2800');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await expect(page.getByText(/Se descontarán 9,000,000/)).toContainText('2,800 USD');
    await page.getByRole('checkbox',{name:/Confirmo los cambios/}).check();
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'cerrada con sus abonos'})).toContainText(destination.name);
    expect((await totals([destination]))[0].total).toBe('2800.0000000000');
    expect((await totals([accounts[1]]))[0].total).toBe('1000000.0000000000');
    expect((await query('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=1',[destination.id_account]))[0].balance).toBe('0.0000000000');
});

test('another received currency requires manual values and changing modes resets them',async({page})=>{
    const {odt,accounts}=await scenario(page.request);
    await openClose(page,odt);await page.getByLabel('Forma de cierre').selectOption('received');await page.getByLabel('Moneda del reparto').selectOption('3');
    await page.getByLabel('Cuenta para pagar el reparto').selectOption(String(accounts[1].id_account));
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    await page.getByLabel('¿Cuánto representan 5,000 USD en COP?').fill('17500000');
    await page.getByLabel('¿Cuánto representan 10,200,800 VES en COP?').fill('14000000');
    await expect(page.getByTestId('part-summary-3')).toContainText('Ingresos: 41,500,000 COP');
    await page.getByLabel('Forma de cierre').selectOption('split');
    await expect(page.getByTestId('part-summary-3')).toContainText('Ingresos: 10,000,000 COP');
    await page.getByLabel('Forma de cierre').selectOption('received');
    await expect(page.getByLabel('¿Cuánto representan 5,000 USD en COP?')).toHaveValue('');
});

test('stale preview preserves inputs and prompts refreshing before another close attempt',async({page})=>{
    const {odt,accounts}=await scenario(page.request);await openClose(page,odt);
    await expense(odt,accounts[0],'150','Gasto concurrente');
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.locator('form [role="alert"]')).toContainText('cambiaron');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeDisabled();
    expect(await closure(odt.id_odt)).toBeUndefined();
    await page.getByRole('button',{name:'Recargar cierre'}).click();
    await expect(page.getByTestId('part-summary-1')).toContainText('Gastos generales: 150 USD');
    await page.getByRole('button',{name:'Cerrar ODT',exact:true}).click();
    await expect(page.getByRole('status').filter({hasText:'cerrada con sus abonos'})).toBeVisible();
});

test('mobile currency settlement and expense reassignment fit the viewport',async({page})=>{
    await page.setViewportSize({width:390,height:844});
    const {odt,accounts}=await scenario(page.request,{amount:'1000',payments:[['900','900'],['100','100']]});
    const key=await expense(odt,accounts[1],'200','Referencia de gasto '.repeat(10),'200');
    await openClose(page,odt);await manualExpense(page,key,1,'25');
    await expect(page.getByRole('button',{name:'Cerrar ODT',exact:true})).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
