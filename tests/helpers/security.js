const {expect}=require('@playwright/test');
const {query,login}=require('./app');
const {unique}=require('./audit');
async function workerUser(){
 let user=(await query("SELECT * FROM users WHERE username='security-worker'"))[0];
 if(!user){
    const entity=(await query("INSERT INTO entitys(name) VALUES('Security worker') RETURNING id_entity"))[0];
    user=(await query("INSERT INTO users(username,password_hash,name,lastname,email,id_entity) SELECT 'security-worker',password_hash,'Usuario seguridad','Pruebas','security@test.invalid',$1 FROM users WHERE user_id=201 RETURNING *",[entity.id_entity]))[0];
 }
 await query('DELETE FROM join_users_roles WHERE user_id=$1',[user.user_id]);return user;
}
async function call(request,path,method='post',data){
 const response=await request[method](path,data===undefined?{}:{data});const result=await response.json();expect(response.status(),JSON.stringify(result)).toBe(200);return result;
}
async function permission(request,capabilities=['finance.read']){return (await call(request,'/api/admin/permissions','post',{name:unique('Permiso seguro'),description:'Prueba de permisos',capabilities})).data;}
async function role(request,ids=[]){return (await call(request,'/api/admin/roles','post',{name:unique('Rol seguro'),permission_ids:ids})).data.role_id;}
async function assign(request,user,roles){return call(request,'/api/admin/users/'+user.user_id+'/roles','put',{role_ids:roles});}
async function client(playwright){const r=await playwright.request.newContext({baseURL:process.env.PLAYWRIGHT_TEST_BASE_URL});await login(r,'security-worker');return r;}
module.exports={workerUser,call,permission,role,assign,client};
