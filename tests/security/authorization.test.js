const {test,expect}=require('@playwright/test');
const policy=require('../../src/security/policy.json');
const {query,login}=require('../helpers/app');
const {workerUser,call,permission,role,assign,client}=require('../helpers/security');
let user;
test.beforeEach(async({request})=>{user=await workerUser();await login(request);});
for(const route of policy.api.filter(r=>r.access!=='public'&&r.access!=='authenticated'))test('API protegida sin privilegios '+route.method+' '+route.path,async({request})=>{
 await login(request,'security-worker');const path=route.path.replace(/:[^/]+/g,'1');
 const response=await request[route.method.toLowerCase()](path,['GET','DELETE'].includes(route.method)?{}:{data:{}});expect(response.status()).toBe(403);
});
for(const [path,access] of Object.entries(policy.pages).filter(([,a])=>Array.isArray(a)||a==='admin'))test('URL protegida sin privilegios '+path,async({request})=>{
 await login(request,'security-worker');const response=await request.get(path);expect(response.status()).toBe(403);expect(await response.text()).toContain('Acceso restringido');
});
test('permiso personalizado habilita solo su operación y revocar rol bloquea sesión abierta',async({request,playwright})=>{
 const p=await permission(request),r=await role(request,[p.permission_id]),w=await client(playwright);
 try{
 expect((await w.get('/api/public/balances')).status()).toBe(403);await assign(request,user,[r]);expect((await w.get('/api/public/balances')).status()).toBe(200);
 expect((await w.post('/api/public/money_incomes',{data:{}})).status()).toBe(403);
 await assign(request,user,[]);expect((await w.get('/api/public/balances')).status()).toBe(403);expect((await w.get('/balances')).status()).toBe(403);
 }finally{await w.dispose();}
});
test('editar capacidades y eliminar permiso afecta de inmediato a roles y sesiones',async({request,playwright})=>{
 const p=await permission(request),r=await role(request,[p.permission_id]);await assign(request,user,[r]);const w=await client(playwright);
 try{
 expect((await w.get('/api/public/balances')).status()).toBe(200);
 await call(request,'/api/admin/permissions/'+p.permission_id,'patch',{name:'Permiso editado '+p.permission_id,description:'Solo inventario',capabilities:['inventory.read']});
 expect((await w.get('/api/public/balances')).status()).toBe(403);expect((await w.get('/api/public/all_items')).status()).toBe(200);
 await call(request,'/api/admin/permissions/'+p.permission_id,'delete');expect((await w.get('/api/public/all_items')).status()).toBe(403);
 expect(await query('SELECT * FROM join_roles_permissions WHERE permission_id=$1',[p.permission_id])).toEqual([]);
 }finally{await w.dispose();}
});
test('roles acumulan permisos y al eliminar un rol solo se retiran sus accesos',async({request,playwright})=>{
 const a=await permission(request,['finance.read']),b=await permission(request,['inventory.read']),ra=await role(request,[a.permission_id]),rb=await role(request,[b.permission_id]);await assign(request,user,[ra,rb]);const w=await client(playwright);
 try{
 expect((await w.get('/api/public/balances')).status()).toBe(200);expect((await w.get('/api/public/all_items')).status()).toBe(200);await call(request,'/api/admin/roles/'+ra,'delete');expect((await w.get('/api/public/balances')).status()).toBe(403);expect((await w.get('/api/public/all_items')).status()).toBe(200);
 }finally{await w.dispose();}
});
test('no se puede elevar privilegios con cuerpo, cookie, permisos heredados o API antigua',async({request})=>{
 const p=await permission(request,['users.create']),r=await role(request,[p.permission_id]);await assign(request,user,[r]);await login(request,'security-worker');
 for(const path of ['/api/admin/users/'+user.user_id+'/roles','/api/user/'+user.user_id]){
 const method=path.startsWith('/api/admin')?'put':'patch';expect((await request[method](path,{data:{role_ids:[1],add:[1],is_admin:true,permissions:[1,2,3,41]}})).status()).toBe(403);
 }
 const profile=await (await request.get('/api/user')).json();expect(profile.session.is_admin).toBe(false);expect(profile.session.roles).toEqual([r]);
});
test('administrador protegido y última asignación no se pueden eliminar',async({request})=>{
 expect((await request.delete('/api/admin/roles/1')).status()).toBe(409);
 expect((await request.put('/api/admin/users/1/roles',{data:{role_ids:[]}})).status()).toBe(409);
 expect((await request.patch('/api/user/1',{data:{remove:[1]}})).status()).toBe(409);
 expect((await request.get('/api/admin/security')).status()).toBe(200);
});
test('revocaciones simultáneas conservan al menos un administrador',async({request,playwright})=>{
 await assign(request,user,[1]);const w=await client(playwright);
 try{
 const results=await Promise.all([request.put('/api/admin/users/1/roles',{data:{role_ids:[]}}),w.put('/api/admin/users/'+user.user_id+'/roles',{data:{role_ids:[]}})]);
 expect(results.map(r=>r.status()).sort()).toEqual([200,409]);
 const admins=await query('SELECT user_id FROM join_users_roles WHERE role_id=1');expect(admins.length).toBe(1);
 // Restore the test administrator using whichever administrator remains authorized.
 if(admins[0].user_id!==1){await call(w,'/api/admin/users/1/roles','put',{role_ids:[1]});}
 await assign(request,user,[]);
 }finally{await w.dispose();}
});
test('una cuenta exclusivamente contable no puede ser administradora ni contar como último administrador',async({request,playwright})=>{
 const worker=await client(playwright);
 try{
  await query('UPDATE users SET password_hash=$2 WHERE user_id=$1',[user.user_id,'!accounting-only!']);
  expect((await worker.get('/api/user')).status()).toBe(401);
  const snapshot=await (await request.get('/api/admin/security')).json();
  expect(snapshot.users.find(account=>account.user_id===user.user_id).can_login).toBe(false);
  const assignment='/api/admin/users/'+user.user_id+'/roles';
  expect((await request.put(assignment,{data:{role_ids:[1]}})).status()).toBe(409);
  // An installation may already contain an assignment created before this check.
  await query('INSERT INTO join_users_roles(user_id,role_id) VALUES($1,1)',[user.user_id]);
  expect((await request.put('/api/admin/users/1/roles',{data:{role_ids:[]}})).status()).toBe(409);
  expect((await request.put(assignment,{data:{role_ids:[]}})).status()).toBe(200);
  expect((await request.get('/api/admin/security')).status()).toBe(200);
 }finally{
  await query('DELETE FROM join_users_roles WHERE user_id=$1',[user.user_id]);
  await query('UPDATE users SET password_hash=$2 WHERE user_id=$1',[user.user_id,user.password_hash]);
  await worker.dispose();
 }
});
test('una revisión antigua no sobrescribe permisos, roles ni asignaciones recientes',async({request})=>{
 const p=await permission(request),r=await role(request,[p.permission_id]);
 const snapshot=await (await request.get('/api/admin/security')).json();
 const permissionRevision=snapshot.permissions.find(item=>item.permission_id===p.permission_id).revision;
 const roleRevision=snapshot.roles.find(item=>item.role_id===r).revision;
 const userRevision=snapshot.users.find(item=>item.user_id===user.user_id).revision;
 const permissionUrl='/api/admin/permissions/'+p.permission_id;
 const roleUrl='/api/admin/roles/'+r;
 const userUrl='/api/admin/users/'+user.user_id+'/roles';
 await call(request,permissionUrl,'patch',{revision:permissionRevision,name:p.name,capabilities:['inventory.read']});
 await call(request,roleUrl,'patch',{revision:roleRevision,name:'Rol actualizado '+r,permission_ids:[]});
 await call(request,userUrl,'put',{revision:userRevision,role_ids:[r]});
 expect((await request.delete(permissionUrl,{data:{revision:permissionRevision}})).status()).toBe(409);
 expect((await request.patch(roleUrl,{data:{revision:roleRevision,name:'Otra edición',permission_ids:[p.permission_id]}})).status()).toBe(409);
 expect((await request.put(userUrl,{data:{revision:userRevision,role_ids:[]}})).status()).toBe(409);
 const updated=await (await request.get('/api/admin/security')).json();
 expect(updated.permissions.find(item=>item.permission_id===p.permission_id).capabilities).toEqual(['inventory.read']);
 expect(updated.roles.find(item=>item.role_id===r).permission_ids).toEqual([]);
 expect(updated.users.find(item=>item.user_id===user.user_id).role_ids).toEqual([r]);
});
test('validación rechaza capacidades y roles inexistentes sin cambios parciales',async({request})=>{
 expect((await request.post('/api/admin/permissions',{data:{name:'Inválido',capabilities:['invented.superadmin']}})).status()).toBe(400);
 expect((await request.put('/api/admin/users/'+user.user_id+'/roles',{data:{role_ids:[999999]}})).status()).toBe(400);
 expect(await query('SELECT * FROM join_users_roles WHERE user_id=$1',[user.user_id])).toEqual([]);
});
test('historial registra actor, cambios previos y nuevos sin información de autenticación',async({request})=>{
 const p=await permission(request);await call(request,'/api/admin/permissions/'+p.permission_id,'patch',{name:p.name,description:'Nueva descripción',capabilities:['inventory.read']});await call(request,'/api/admin/permissions/'+p.permission_id,'delete');
 const snapshot=await (await request.get('/api/admin/security')).json();const events=snapshot.events.filter(e=>e.target_type==='permission'&&e.target_id===p.permission_id);expect(events.map(e=>e.action)).toEqual(['permission.delete','permission.update','permission.create']);expect(events.every(e=>e.actor_user_id===1)).toBe(true);expect(events[1].before_data.capabilities).toEqual(['finance.read']);expect(events[1].after_data.capabilities).toEqual(['inventory.read']);expect(JSON.stringify(snapshot)).not.toContain('password_hash');
});
test('asistencia y deudas de otra persona no se exponen a usuarios sin privilegios',async({request})=>{
 await login(request,'security-worker');for(const [endpoint,key] of [['loans','loans'],['loans_registers','loans_register'],['get_attendance','attendances']]){
 const body=await (await request.get('/api/public/'+endpoint)).json();expect(body[key].every(row=>row.id_user===user.user_id)).toBe(true);
 }
});
test('todas las páginas y APIs de negocio tienen una política explícita',()=>{
 const fs=require('fs'),path=require('path');
 for(const file of fs.readdirSync('src/routes').filter(f=>f.endsWith('.svelte')&&!f.startsWith('_'))){const route=file==='index.svelte'?'/':'/'+file.slice(0,-7);expect(policy.pages[route],route).toBeTruthy();}
 function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
 for(const file of walk('src/routes/api').filter(f=>f.endsWith('.js'))){let route='/'+file.replace(/\\/g,'/').replace(/^src\/routes\//,'').replace(/\/index\.js$/, '').replace(/\.js$/,'').replace(/\[[^\]]+\]/g,':id');expect(policy.api.some(p=>p.path.replace(/:[^/]+/g,':id')===route),file).toBe(true);}
});
test('permisos personalizados de abonos y cierre son independientes y ejecutan la operación permitida',async({request,playwright})=>{
 const {createOdt,destination}=require('../helpers/app');const odt=await createOdt(),a=await destination();
 const pay=await permission(request,['odts.payments']),close=await permission(request,['odts.close']),pr=await role(request,[pay.permission_id]),cr=await role(request,[close.permission_id]);await assign(request,user,[pr]);const w=await client(playwright);
 try{
 const receipt=await w.post('/api/public/odt_payments',{data:{id_odt:odt.id_odt,id_account:a.id_account,amount:'1000',amount_odt:'1000',description:'Permiso personalizado',request_key:require('crypto').randomUUID()}});expect(receipt.status(),await receipt.text()).toBe(200);
 expect((await w.post('/api/public/closure_odt',{data:{}})).status()).toBe(403);expect((await w.get('/api/public/odt_settlement/'+odt.id_odt)).status()).toBe(403);
 await assign(request,user,[cr]);expect((await w.post('/api/public/odt_payments',{data:{}})).status()).toBe(403);expect((await w.get('/api/public/odt_settlement/'+odt.id_odt)).status()).toBe(200);
 const {planFor,closePlan}=require('../helpers/settlement');const {plan}=await planFor(w,odt);await closePlan(w,plan);
 const direct=await createOdt();const result=await w.post('/api/public/closure_odt',{data:{id_odt:direct.id_odt,id_account:a.id_account,amount:'1000',admin_percent:'0.2',ceo_percent:'0',admin_users:[],operative_users:[],supervisor_users:[]}});expect(result.status(),await result.text()).toBe(200);
 }finally{await w.dispose();}
});
