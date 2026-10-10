const {test,expect}=require('@playwright/test');
const fs=require('fs'),path=require('path');
const {login,query}=require('../helpers/app');
const {unique}=require('../helpers/audit');
function endpoints(dir,prefix='') {
    return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?endpoints(path.join(dir,e.name),prefix+e.name+'/'):[prefix+e.name.replace(/\.js$/,'')]);
}
for(const endpoint of endpoints(path.resolve('src/routes/api/public')).filter(x=>x!=='login')) {
    test('sesión obligatoria: '+endpoint,async ({request})=>{
        const file=fs.readFileSync(path.join('src/routes/api/public',endpoint+'.js'),'utf8');
        const method=/export (?:const get|async function get)/.test(file)?'get':'post';
        const url='/api/public/'+endpoint.replace(/\[[^\]]+\]/g,'1');
        const response=await request[method](url,method==='post'?{data:{}}:{});
        expect(response.status()).toBe(401);
    });
}
for(const route of ['create_account','money_incomes','investments','exchange_currency','give_loan','pay_loan','new_storage','new_supplier','new_client','new_payroll_expense','new_payroll_hours','nueva_odt','update_limit_resources','update_admin_percent','new_recurrent_responsibility','assign_responsibility','new_approved_responsibility']){
    test('permiso de escritura: '+route,async ({request})=>{
        await query('DELETE FROM join_users_roles WHERE user_id=204');
        await login(request,'test-user-204');
        expect((await request.post('/api/public/'+route,{data:{}})).status()).toBe(403);
    });
}
test('perfil y permisos no exponen la contraseña; cerrar sesión invalida acceso',async ({request})=>{
    await login(request);
    const profile=await (await request.get('/api/user')).json();
    expect(profile.session.user_id).toBe(1);expect(profile.session.password_hash).toBeUndefined();
    const permissions=await (await request.get('/api/user/permissions')).json();expect(permissions.permissions.length).toBeGreaterThan(20);
    expect((await request.delete('/api/user')).status()).toBe(200);
    expect((await request.get('/api/user')).status()).toBe(401);
});
test('contraseñas anterior y nueva no se guardan en registros de solicitudes',async ({request})=>{
    await login(request,'test-user-204');
    const marker=unique('secret');
    await request.patch('/api/user',{data:{old_password:marker,new_password:marker}});
    const rows=await query("SELECT body,headers FROM logs WHERE path='/api/user' AND method='PATCH' ORDER BY id_log DESC LIMIT 1");
    expect(JSON.stringify(rows)).not.toContain(marker);
    expect(rows[0].headers.cookie).toBeUndefined();
});
for(const data of [{},{username:'admin'},{username:123,password:'x'}]) test('login inválido controlado '+JSON.stringify(data),async({request})=>{
    const response=await request.post('/api/public/login',{data});expect(response.status()).toBe(400);expect((await response.json()).error).toBeTruthy();
});
