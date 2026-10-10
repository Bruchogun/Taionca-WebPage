const {test,expect}=require('@playwright/test');
const {query,login}=require('../helpers/app');
const {unique}=require('../helpers/audit');
const {workerUser,client,permission,role,assign}=require('../helpers/security');
test('panel gráfico: crear permiso y rol, asignarlo, revocarlo, editar y eliminar',async({page,playwright})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const user=await workerUser();await login(page.request);await page.goto('/administracion_permisos');
 await expect(page.getByRole('heading',{name:'Permisos y roles'})).toBeVisible();const pname=unique('Consulta cuentas'),rname=unique('Consulta financiera');
 await page.getByRole('button',{name:'Permisos',exact:true}).click();await page.getByLabel('Nombre del permiso',{exact:true}).fill(pname);await page.getByLabel('Descripción del permiso',{exact:true}).fill('Consultar saldos sin registrar movimientos');await page.getByLabel('Consultar saldos y movimientos',{exact:true}).check();await page.getByRole('button',{name:'Guardar permiso',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Permiso creado.'})).toBeVisible();
 await page.getByRole('button',{name:'Roles',exact:true}).click();await page.getByLabel('Nombre del rol',{exact:true}).fill(rname);await page.getByLabel('Filtrar permisos del rol',{exact:true}).fill(pname);
 await page.locator('label.check').filter({hasText:pname}).locator('input').check();await page.getByRole('button',{name:'Guardar rol',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Rol creado.'})).toBeVisible();
 await page.getByRole('button',{name:'Usuarios',exact:true}).click();await page.getByLabel('Usuario',{exact:true}).selectOption(String(user.user_id));await page.getByLabel(rname,{exact:true}).check();await page.getByRole('button',{name:'Guardar roles del usuario',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Roles actualizados'})).toBeVisible();
 const worker=await client(playwright);try{
 expect((await worker.get('/api/public/balances')).status()).toBe(200);expect((await worker.get('/api/admin/security')).status()).toBe(403);
 await page.getByLabel(rname,{exact:true}).uncheck();await page.getByRole('button',{name:'Guardar roles del usuario',exact:true}).click();await expect.poll(async()=>(await worker.get('/api/public/balances')).status()).toBe(403);
 }finally{await worker.dispose();}
 await page.getByRole('button',{name:'Permisos',exact:true}).click();const p=(await query('SELECT permission_id FROM permissions WHERE name=$1',[pname]))[0];await page.getByLabel('Permiso',{exact:true}).selectOption(String(p.permission_id));await page.getByLabel('Nombre del permiso',{exact:true}).fill(pname+' editado');await page.getByRole('button',{name:'Guardar permiso',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Permiso actualizado'})).toBeVisible();
 page.on('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Eliminar permiso',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Permiso eliminado'})).toBeVisible();
 await page.getByRole('button',{name:'Roles',exact:true}).click();const r=(await query('SELECT role_id FROM roles WHERE name=$1',[rname]))[0];await page.getByLabel('Rol',{exact:true}).selectOption(String(r.role_id));await page.getByRole('button',{name:'Eliminar rol',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Rol eliminado'})).toBeVisible();
 await page.getByRole('button',{name:'Historial',exact:true}).click();await expect(page.locator('.security')).toContainText('permission.delete');await expect(page.locator('.security')).toContainText('user.roles');expect(errors).toEqual([]);
});
test('usuario sin rol no ve el panel ni puede abrirlo mediante navegación de Sapper',async({page})=>{
 await workerUser();await login(page.request,'security-worker');await page.goto('/attendance');await expect(page.getByRole('link',{name:'Administrar permisos'})).toHaveCount(0);
 await page.evaluate(()=>{const a=document.createElement('a');a.href='/administracion_permisos';a.textContent='Ruta directa de prueba';document.querySelector('main').appendChild(a);});await page.getByRole('link',{name:'Ruta directa de prueba'}).click();
 await expect(page).toHaveURL(/sin_acceso/);await expect(page.getByRole('heading',{name:'Acceso restringido'})).toBeVisible();await expect(page.getByRole('heading',{name:'Permisos y roles'})).toHaveCount(0);
});
test('menú usa permisos actuales y desaparece el enlace después de revocar el rol',async({page,request})=>{
 const user=await workerUser();await login(request);const p=await permission(request,['finance.read']),r=await role(request,[p.permission_id]);await assign(request,user,[r]);await login(page.request,'security-worker');await page.goto('/attendance');await page.getByRole('button',{name:'Gestión monetaria',exact:true}).click();await expect(page.getByRole('link',{name:'Balance',exact:true})).toBeVisible();
 await assign(request,user,[]);await page.reload();await expect(page.getByRole('link',{name:'Balance',exact:true})).toHaveCount(0);expect((await page.request.get('/api/public/balances')).status()).toBe(403);
});
test('panel de administración funciona en pantalla móvil sin desbordamiento',async({page})=>{
 await page.setViewportSize({width:390,height:844});await login(page.request);await page.goto('/administracion_permisos');await page.getByRole('button',{name:'Permisos',exact:true}).click();await expect(page.getByLabel('Nombre del permiso',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
});
test('cerrar sesión desde el menú oculta permisos y permite iniciar otra sesión',async({page})=>{
 await login(page.request);await page.goto('/administracion_permisos');await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await expect(page).toHaveURL('/login');await expect(page.getByRole('link',{name:'Administrar permisos'})).toHaveCount(0);expect((await page.request.get('/api/admin/security')).status()).toBe(401);
 await page.getByPlaceholder('Ingrese su usuario...').fill('admin');await page.getByPlaceholder('Ingrese su contraseña...').fill('test-admin-odt');await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await expect(page).toHaveURL('/');await expect(page.getByRole('button',{name:'Cerrar sesión',exact:true})).toBeVisible();
});
test('fallo de verificación mantiene panel oculto y permite reintentar',async({page})=>{
 await login(page.request);await page.route('**/api/auth/access?path=*',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporal'})}));await page.goto('/administracion_permisos');await expect(page.getByRole('button',{name:'Reintentar acceso',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Permisos y roles'})).toHaveCount(0);
 await page.unroute('**/api/auth/access?path=*');await page.getByRole('button',{name:'Reintentar acceso',exact:true}).click();await expect(page.getByRole('heading',{name:'Permisos y roles'})).toBeVisible();
});
// Positive permission checks catch hidden dependencies between pages and their read APIs.
const policy=require('../../src/security/policy.json');
for(const [path,access] of Object.entries(policy.pages).filter(([,a])=>Array.isArray(a)||a==='authenticated'))test('rol mínimo carga página y sus consultas '+path,async({page,request})=>{
 const user=await workerUser();await login(request);if(Array.isArray(access)){const p=await permission(request,[access[0]]),r=await role(request,[p.permission_id]);await assign(request,user,[r]);}await login(page.request,'security-worker');
 const failures=[],errors=[],pending=new Set();page.on('request',r=>{if(r.url().includes('/api/'))pending.add(r);});page.on('requestfinished',r=>pending.delete(r));page.on('requestfailed',r=>{pending.delete(r);if(r.url().includes('/api/'))failures.push('Failed '+r.url());});
 page.on('response',response=>{if(response.url().includes('/api/')&&response.status()>=400)failures.push(response.status()+' '+response.url());});page.on('pageerror',error=>errors.push(error.message));
 const accessReady=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth/access');
 const response=await page.goto(path);expect(response.status()).toBeLessThan(400);await accessReady;await expect(page.getByText('Verificando acceso…',{exact:true})).toHaveCount(0);await expect.poll(()=>pending.size).toBe(0);await expect(page.locator('#main-content')).toBeAttached();expect(failures).toEqual([]);expect(errors).toEqual([]);
});
test('consulta financiera permite revisar ODT y abonos pero no modificar porcentaje ni registrar pagos',async({page,request})=>{
 const {createOdt}=require('../helpers/app'),odt=await createOdt(),user=await workerUser();await login(request);const p=await permission(request,['finance.read']),r=await role(request,[p.permission_id]);await assign(request,user,[r]);await login(page.request,'security-worker');await page.goto('/');
 await page.getByText('ODTs abiertas',{exact:true}).click();await page.getByPlaceholder('Odts abiertas...').fill(String(odt.id_odt));await page.locator('.listContainer .item').filter({hasText:new RegExp('^'+odt.id_odt+' \\|')}).click();await expect(page.getByText('Abonado:',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'Actualizar porcentaje',exact:true})).toBeDisabled();await expect(page.getByRole('link',{name:'Registrar abonos de esta ODT'})).toHaveCount(0);
 expect((await page.request.post('/api/public/update_admin_percent',{data:{id_odt:odt.id_odt,admin_percent:'0.9'}})).status()).toBe(403);
});
test('permiso de asistencia general muestra otras personas sin depender de special_user',async({page,request})=>{
 const user=await workerUser();await login(request);const p=await permission(request,['attendance.read_all']),r=await role(request,[p.permission_id]);await assign(request,user,[r]);
 await query("INSERT INTO attendances(id_user,entry_date,departure_date) VALUES(201,'2041-01-01 08:00:00','2041-01-01 12:00:00')");await login(page.request,'security-worker');await page.goto('/attendance');await expect(page.getByRole('columnheader',{name:'Usuario',exact:true})).toBeVisible();await expect(page.locator('tbody tr').filter({hasText:'Test'}).first()).toBeVisible();
});

test('usuario sin rol consulta su deuda en pantalla sin listar otros usuarios',async({page})=>{
 const user=await workerUser();await query('INSERT INTO loans(id_user,id_currency,amount) VALUES($1,1,123.45) ON CONFLICT(id_user,id_currency) DO UPDATE SET amount=excluded.amount',[user.user_id]);await login(page.request,'security-worker');await page.goto('/loans');await expect(page.getByText('Mis deudas',{exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'123.45 $',exact:true})).toBeVisible();await expect(page.locator('.selectContainer')).toHaveCount(0);expect((await page.request.get('/api/users')).status()).toBe(403);
});
