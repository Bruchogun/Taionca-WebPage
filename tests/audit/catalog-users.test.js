const {test,expect}=require('@playwright/test');
const {login,query}=require('../helpers/app');
const {unique,post,account}=require('../helpers/audit');
test.beforeEach(async({request})=>login(request));
for(const [kind,id,extra] of [['client','id_client',{legal_id:'J12345'}],['supplier','id_supplier',{}],['storage','id_storage',{location:'Taller norte'}]]){
 test('alta y consulta de '+kind,async({request})=>{
    const data={name:unique(kind),phone_number1:'1234567',phone_number2:'7654321',email:'audit@test.invalid',address:'Dirección',description:'Descripción de auditoría',...extra};
    const body=await post(request,'new_'+kind,data);expect(body.data[id]).toBeGreaterThan(0);
    const listed=await (await request.get('/api/public/'+kind+'s')).json();
    expect(listed[kind+'s'].find(row=>row[id]===body.data[id])).toMatchObject({name:data.name,description:data.description,...extra});
 });
}
test('crear cuenta inicializa saldo cero para cada entidad y conserva moneda',async({request})=>{
    const a=await account(request,3),rows=await query('SELECT * FROM balances WHERE id_account=$1',[a.id_account]);
    expect(rows.length).toBe((await query('SELECT count(*)::int n FROM entitys'))[0].n);
    expect(rows.every(row=>Number(row.balance)===0)).toBe(true);
    const {accounts}=await (await request.get('/api/public/accounts')).json();expect(accounts.find(row=>row.id_account===a.id_account)).toMatchObject({id_currency:3,code:'cop'});
});
test('alta de usuario, entidad, saldos, préstamos, contraseña y autenticación',async({request})=>{
    const username=unique('audituser').replace(/ /g,'').toLowerCase();
    const response=await request.post('/api/users',{data:{username,password:'Original-audit-123',name:'Usuario',lastname:'Auditoría',email:username+'@test.invalid'}});
    expect((await response.json()).error).toBeUndefined();
    const [user]=await query('SELECT * FROM users WHERE username=$1',[username]);expect(user).toBeTruthy();
    expect(user.password_hash).not.toContain('Original-audit-123');
    expect((await query('SELECT count(*)::int n FROM balances WHERE id_entity=$1',[user.id_entity]))[0].n).toBe((await query('SELECT count(*)::int n FROM accounts'))[0].n);
    expect((await query('SELECT count(*)::int n FROM loans WHERE id_user=$1',[user.user_id]))[0].n).toBe((await query('SELECT count(*)::int n FROM currencys'))[0].n);
    const signed=await request.post('/api/public/login',{data:{username:username.toUpperCase(),password:'Original-audit-123'}});expect((await signed.json()).session.user_id).toBe(user.user_id);
    expect((await (await request.patch('/api/user',{data:{old_password:'wrong',new_password:'Changed-audit-456'}})).json()).error).toBeTruthy();
    expect((await (await request.patch('/api/user',{data:{old_password:'Original-audit-123',new_password:'Changed-audit-456'}})).json()).success).toBeTruthy();
    await request.delete('/api/user');
    expect((await (await request.post('/api/public/login',{data:{username,password:'Original-audit-123'}})).json()).error).toBeTruthy();
    expect((await (await request.post('/api/public/login',{data:{username,password:'Changed-audit-456'}})).json()).session.user_id).toBe(user.user_id);
});
for(const field of ['username','password','name','lastname','email'])test('alta de usuario exige '+field,async({request})=>{
    const data={username:unique(),password:'Test-password',name:'Test',lastname:'Test',email:'test@test.invalid'};delete data[field];
    expect((await (await request.post('/api/users',{data})).json()).error).toBeTruthy();
});
test('usuario sin permiso no puede crear usuarios',async({request})=>{
    await login(request,'test-user-204');expect((await request.post('/api/users',{data:{}})).status()).toBe(403);
});
for(const permissions of [[],[6,22]])test('ciclo de roles y asignación de permisos '+permissions.join(','),async({request})=>{
    const name=unique('Rol');const response=await request.post('/api/roles',{data:{name,permissions}});const body=await response.json();
    expect(response.status(),JSON.stringify(body)).toBe(200);const id=body.data.role_id;expect(id).toBeGreaterThan(0);
    const list=await (await request.get('/api/roles')).json();expect(list.data.roles.find(r=>r.role_id===id).permissions.map(p=>p.permission_id).sort()).toEqual(permissions.slice().sort());
    await request.patch('/api/role/'+id,{data:{name:name+' editado',permissions:{add:[5],remove:permissions}}});
    const detail=await (await request.get('/api/role/'+id)).json();expect(detail.data.role.name).toBe(name+' editado');expect(detail.data.role.permissions).toEqual([{permission_id:5,name:'users_create'}]);
    await request.patch('/api/user/204',{data:{add:[id]}});
    const u=await (await request.get('/api/user/204')).json();expect(u.data.user.roles.some(r=>r.role_id===id)).toBe(true);
    await login(request,'test-user-204');expect((await (await request.get('/api/user/permissions')).json()).permissions.some(p=>p.permission_id===5)).toBe(true);
    await login(request);await request.patch('/api/user/204',{data:{remove:[id]}});await request.delete('/api/role/'+id);
    expect(await query('SELECT * FROM roles WHERE role_id=$1',[id])).toEqual([]);
});
test('nombre de usuario se normaliza; duplicado no deja entidades ni saldos huérfanos',async({request})=>{
 const username=unique('UPPER').replace(/ /g,'');const data={username:' '+username+' ',password:'Signup-test-123',name:'Normalizado',lastname:'Prueba',email:username+'@test.invalid'};
 expect((await request.post('/api/users',{data})).status()).toBe(200);
 const before=await query('SELECT (SELECT count(*) FROM entitys)::int entities,(SELECT count(*) FROM balances)::int balances');
 expect((await request.post('/api/users',{data:{...data,username:username.toLowerCase()}})).status()).toBe(409);
 expect(await query('SELECT (SELECT count(*) FROM entitys)::int entities,(SELECT count(*) FROM balances)::int balances')).toEqual(before);
 const signed=await (await request.post('/api/public/login',{data:{username,password:data.password}})).json();expect(signed.session.name).toBe('Normalizado');
});
test('editar rol con permiso inexistente revierte también el nombre',async({request})=>{
 const name=unique('Rol atómico');const created=await (await request.post('/api/roles',{data:{name,permissions:[6]}})).json();const id=created.data.role_id;
 expect((await request.patch('/api/role/'+id,{data:{name:'No debe persistir',permissions:{add:[999999],remove:[6]}}})).status()).toBe(400);
 const detail=await (await request.get('/api/role/'+id)).json();expect(detail.data.role.name).toBe(name);expect(detail.data.role.permissions.map(p=>p.permission_id)).toEqual([6]);
});
