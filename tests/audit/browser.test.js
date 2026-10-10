const {test,expect}=require('@playwright/test');
const {login,query,createOdt}=require('../helpers/app');
const {unique,post,account,income,balance,item}=require('../helpers/audit');
const errors=new WeakMap();
test.beforeEach(async({page})=>{errors.set(page,[]);page.on('pageerror',e=>errors.get(page).push(e.message));await login(page.request);});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
async function pick(page,index,label){
 await page.locator('#main-content .selectContainer input').nth(index).fill(label);
 await page.locator('.listContainer .item').filter({hasText:label}).first().click();
}
async function send(page,url,label='Enviar'){
 const result=page.waitForResponse(r=>r.url().endsWith(url)&&r.request().method()==='POST');
 await page.getByRole('button',{name:label,exact:true}).click();
 const response=await result;expect(response.status()).toBe(200);expect((await response.json()).error).toBeUndefined();
}
for(const [route,field,endpoint,table] of [['ingreso_clients','Cliente','new_client','clients'],['ingreso_suppliers','Proveedor','new_supplier','suppliers'],['ingreso_storages','Almacén','new_storage','storages']])test('formulario '+route+' guarda y limpia campos',async({page})=>{
 await page.goto('/'+route);const name=unique('Navegador');await page.getByLabel(field,{exact:true}).fill(name);
 await page.getByLabel('Descripción',{exact:true}).fill('Registro desde el navegador');
 if(route==='ingreso_storages')await page.getByLabel('Localización',{exact:true}).fill('Taller');
 await send(page,'/api/public/'+endpoint);expect((await query(`SELECT name FROM ${table} WHERE name=$1`,[name]))[0].name).toBe(name);await expect(page.getByLabel(field,{exact:true})).toHaveValue('');
});
test('formulario de cuenta conserva la moneda elegida',async({page})=>{
 await page.goto('/create_account');await page.getByRole('radio',{name:/Pesos/}).check({force:true});const name=unique('Cuenta navegador');await page.getByLabel('Cuenta',{exact:true}).fill(name);await send(page,'/api/public/create_account');
 expect((await query('SELECT id_currency FROM accounts WHERE name=$1',[name]))[0].id_currency).toBe(3);
});
test('alta de usuario exige confirmar contraseña y registra el formulario completo',async({page})=>{
 await page.goto('/signup');const username=unique('browseruser').replace(/ /g,'');
 for(const [label,value] of [['Nombre','Auditor'],['Apellido','Pruebas'],['Usuario',username],['Correo',username+'@test.invalid'],['Contraseña','Browser-test-123'],['Repita Contraseña','different']])await page.getByLabel(label,{exact:true}).fill(value);
 await expect(page.getByRole('button',{name:'Crear usuario',exact:true})).toBeDisabled();await page.getByLabel('Repita Contraseña',{exact:true}).fill('Browser-test-123');
 await send(page,'/api/users','Crear usuario');expect((await query('SELECT name FROM users WHERE username=$1',[username]))[0].name).toBe('Auditor');
});
test('cambio de contraseña no permite confirmación distinta',async({page})=>{
 await page.goto('/change_password');await page.getByLabel('Actual contraseña',{exact:true}).fill('test-admin-odt');await page.getByLabel('Nueva contraseña',{exact:true}).fill('Nueva-test-123');await page.getByLabel('Repita Contraseña',{exact:true}).fill('Distinta');await expect(page.getByRole('button',{name:'Cambiar contraseña',exact:true})).toBeDisabled();
});
test('asistencia actualiza el historial sin recargar y muestra salida pendiente',async({page})=>{
 await login(page.request,'test-user-203');await query('DELETE FROM attendances WHERE id_user=203');await page.goto('/attendance');await page.locator('#entry_time').fill('08:00');await send(page,'/api/public/attendance');
 await expect(page.getByRole('cell',{name:'Pendiente',exact:true})).toBeVisible();
 await page.getByRole('tab',{name:'Salida',exact:true}).click();await page.locator('#departure_time').fill('17:00');await send(page,'/api/public/attendance');await expect(page.getByRole('cell',{name:'Pendiente',exact:true})).toHaveCount(0);
});
test('ingreso de dinero se refleja en el reporte de balances de la entidad',async({page})=>{
 const a=await account(page.request);await page.goto('/money_incomes');await page.getByLabel('Ingreso total',{exact:true}).fill('123.45');await pick(page,0,'Taionca');await pick(page,1,a.name);await page.getByLabel('Descripción',{exact:true}).fill('Ingreso navegador');await send(page,'/api/public/money_incomes');expect(await balance(a)).toBe(123.45);
 await page.goto('/balances');await pick(page,0,'Taionca');const row=page.getByRole('row').filter({hasText:a.name});await expect(row).toContainText('123.45');
});
test('gasto administrativo registra el importe desde su formulario',async({page})=>{
 const a=await account(page.request);await income(page.request,a,100,2);await page.goto('/gasto_admin');await page.getByLabel('Monto',{exact:true}).fill('12.25');await pick(page,0,a.name);await page.getByLabel('Descripción',{exact:true}).fill('Compra oficina');await send(page,'/api/public/admin_expenses');expect(await balance(a,2)).toBe(87.75);
});
test('control de inventario filtra almacén y muestra los cinco niveles de stock',async({page})=>{
 const product=await item(page.request),sid=product.id_spendable_stock;
 const storage=(await query('SELECT name FROM storages WHERE id_storage=$1',[product.storage]))[0];
 for(const [stock,color] of [[0,'black'],[2,'red'],[5,'yellow'],[10,'green'],[11,'blue']]){
    await query('UPDATE spendable_stocks SET amount=$2 WHERE id_spendable_stock=$1',[sid,stock]);await page.goto('/control_inv');await pick(page,0,storage.name);
    const row=page.getByRole('row').filter({hasText:product.code});await expect(row.locator('.'+color)).toBeVisible();await expect(row).toContainText(stock.toFixed(2));
 }
 await page.goto('/inventory_review');await pick(page,0,product.code);await expect(page.getByRole('heading',{name:'Código del artículo: '+product.code,exact:true})).toBeVisible();await expect(page.locator('#main-content')).toContainText('Cantidad disponible: 11.00');
});
test('reposición de inventario selecciona artículo y cuenta y descuenta el costo',async({page})=>{
 const product=await item(page.request),a=await account(page.request);await income(page.request,a,100,3);await page.goto('/reposicion_inv');await pick(page,0,product.code);await page.getByLabel('Cantidad repuesta',{exact:true}).fill('5');await pick(page,1,a.name);await page.getByLabel('Monto total gastado',{exact:true}).fill('20');await send(page,'/api/public/spendable_inv_odt_incomes');expect(await balance(a,3)).toBe(80);
 expect(Number((await query('SELECT amount FROM spendable_stocks WHERE id_spendable_stock=$1',[product.id_spendable_stock]))[0].amount)).toBe(5);
});
test('nómina calcula y paga la selección mostrada; luego elimina las horas pagadas',async({page})=>{
 await query('INSERT INTO payroll_variables(base_salary,food_voucher,base_extra_salary,ivss_discount) VALUES(10,2,20,0.045)');await query("UPDATE payroll_records SET created_at=now()-interval '7 days'");
 const odt=await createOdt(),a=await account(page.request);await income(page.request,a,1000);const [h]=await query('INSERT INTO payroll_odt_hours(id_supervisor,id_user,id_odt,hours_spent) VALUES(1,204,$1,8) RETURNING *',[odt.id_odt]);
 await page.goto('/payroll');await page.getByRole('button',{name:'Agregar usuario',exact:true}).click();await pick(page,0,'ODT: '+odt.id_odt+' |');await pick(page,1,a.name);await send(page,'/api/public/payroll_preview','Calcular nómina');await expect(page.locator('#main-content')).toContainText('91.68 USD');await send(page,'/api/public/new_payroll_expense','Pagar nómina');expect(await balance(a)).toBe(908.32);await expect(page.getByRole('button',{name:'Pagar nómina',exact:true})).toBeDisabled();
 expect((await query('SELECT is_paid FROM payroll_odt_hours WHERE id_payroll_odt_hour=$1',[h.id_payroll_odt_hour]))[0].is_paid).toBe(true);
});
test('responsabilidades deja de mostrar una entrega después de enviar evidencia',async({page})=>{
 const created=await post(page.request,'new_recurrent_responsibility',{name:unique('Tarea UI'),description:'Completar',importance:50,time_frequency:{id_time_frequency:1}});
 await post(page.request,'assign_responsibility',{responsibility:created.data,user:{value:204},deadline:'2030-02-01',times_remaining:1});await login(page.request,'test-user-204');await page.goto('/responsabilities');await page.getByRole('radio').first().check({force:true});await page.getByPlaceholder('Anexe link de soporte y en caso de ser necesario anexe algún comentario').fill('https://test.invalid/evidencia');await send(page,'/api/public/new_awaiting_approval_responsibility');await expect(page.getByRole('radio')).toHaveCount(0);
});
for(const route of ['solicitud_prestamo','solicitud_cambio_moneda'])test('pantalla pendiente '+route+' informa que no registra solicitudes',async({page})=>{
 await page.goto('/'+route);await expect(page.getByRole('status').filter({hasText:'todavía no está implementada'})).toBeVisible();await expect(page.locator('#main-content button').last()).toBeDisabled();
});
test('blog de plantilla, artículo y página inexistente responden correctamente',async({page})=>{
 await page.goto('/blog');await expect(page.getByRole('link',{name:'What is Sapper?'})).toBeVisible();await page.getByRole('link',{name:'What is Sapper?'}).click();await expect(page.getByRole('heading',{name:'What is Sapper?'})).toBeVisible();
 expect((await page.request.get('/blog/no-existe')).status()).toBe(404);
});
test('crear ODT desde formulario y actualizar su límite refleja el nuevo valor en pantalla',async({page})=>{
 const a=await account(page.request);const description=unique('ODT navegador');
 const client=(await query('SELECT name FROM clients WHERE id_client=1'))[0];await page.goto('/nueva_odt');await page.getByLabel('Monto de contrato',{exact:true}).fill('2000');await page.getByRole('radio',{name:/Dólares/}).check({force:true});await pick(page,0,client.name);await page.getByLabel('Descripción',{exact:true}).fill(description);await send(page,'/api/public/nueva_odt');
 const odt=(await query('SELECT * FROM odts WHERE description=$1',[description]))[0];expect(Number(odt.amount)).toBe(2000);
 await page.goto('/limit_resources');await pick(page,0,odt.id_odt+' |');await pick(page,1,a.name);await page.getByPlaceholder('Ingrese el monto...').fill('75.50');await send(page,'/api/public/update_limit_resources','Actualizar');await expect(page.getByRole('row').filter({hasText:a.name})).toContainText('75.50');
});
test('asignación de horas desde el navegador descuenta las horas registradas',async({page})=>{
 await query("UPDATE users SET name='Operario horas auditoría' WHERE user_id=203");await query('INSERT INTO payroll_not_assign_hours(id_user,hours) VALUES(203,8) ON CONFLICT(id_user) DO UPDATE SET hours=8');const odt=await createOdt();
 await page.goto('/asign_hours_odt');await pick(page,0,'Operario horas auditoría');await pick(page,1,odt.id_odt+' |');await page.locator('#main-content input[type=number]').fill('3.5');await send(page,'/api/public/new_payroll_hours');expect((await query('SELECT hours FROM payroll_not_assign_hours WHERE id_user=203'))[0].hours).toBe(4.5);
});
test('transferencia entre cuentas desde el navegador conserva el total',async({page})=>{
 const a=await account(page.request),b=await account(page.request);await income(page.request,a,100);await page.goto('/money_transfer');await page.getByLabel('Monto a transferir',{exact:true}).fill('12.50');await pick(page,0,a.name);await pick(page,1,'Taionca');await pick(page,2,b.name);await pick(page,3,'Taionca');await page.getByLabel('Descripción',{exact:true}).fill('Transferencia navegador');await send(page,'/api/public/transfer_entitys');expect(await balance(a)).toBe(87.5);expect(await balance(b)).toBe(12.5);
});
test('cambio de moneda desde el navegador usa ambos importes explícitos',async({page})=>{
 const a=await account(page.request),b=await account(page.request,3);await income(page.request,a,100);await page.goto('/cambio_moneda');await page.getByLabel('Monto a cambiar',{exact:true}).fill('10');await page.getByLabel('Monto a cambiado',{exact:true}).fill('40000');await pick(page,0,a.name);await pick(page,1,b.name);await pick(page,2,'Taionca');await page.getByLabel('Descripción',{exact:true}).fill('Cambio navegador');await send(page,'/api/public/exchange_currency');expect(await balance(a)).toBe(90);expect(await balance(b)).toBe(40000);
});
test('préstamo y abono desde sus formularios concilian deuda',async({page})=>{
 await query("UPDATE users SET name='Usuario préstamo auditoría' WHERE user_id=202");const a=await account(page.request);await income(page.request,a,100);
 const before=Number((await query('SELECT amount FROM loans WHERE id_user=202 AND id_currency=1'))[0].amount);
 for(const [route,endpoint,amount] of [['give_loans','give_loan','30'],['pay_loans','pay_loan','10']]){
    await page.goto('/'+route);await pick(page,0,'Usuario préstamo auditoría');await page.getByLabel('Monto',{exact:true}).fill(amount);await pick(page,1,a.name);if(route==='give_loans')await page.getByLabel('Descripción',{exact:true}).fill('Préstamo navegador');await send(page,'/api/public/'+endpoint);
 }
 expect(await balance(a)).toBe(80);expect(Number((await query('SELECT amount FROM loans WHERE id_user=202 AND id_currency=1'))[0].amount)).toBe(before+20);
});
