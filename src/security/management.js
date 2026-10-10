import { randomBytes } from 'crypto';
import { transaction,invalid } from '../lib/api-transaction';
import { policy } from './access';
import { query } from '../db';
const capabilityKeys=new Set(policy.capabilities.map(c=>c.key));
function ids(values,label) {
    if(!Array.isArray(values)||values.some(v=>!Number.isInteger(v)||v<=0)) invalid('Seleccione '+label+' válidos.');
    return [...new Set(values)];
}
function nameOf(value) {
    if(typeof value!=='string'||!value.trim()||value.trim().length>64) invalid('El nombre debe tener entre 1 y 64 caracteres.');
    return value.trim();
}
async function audit(client,req,action,type,id,before,after) {
    await client.query('INSERT INTO security_events(actor_user_id,action,target_type,target_id,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',[req.user.user_id,action,type,id,before,after]);
}
function adminTransaction(handler) {
    return transaction(async(req,client)=>{
        if(!req.user?.is_admin) invalid('Solo el administrador puede gestionar permisos.',403);
        // Serialize privilege changes so two concurrent revocations cannot remove the last administrator.
        await client.query('SELECT pg_advisory_xact_lock(84719203)');
        const current=await client.query('SELECT 1 FROM join_users_roles WHERE user_id=$1 AND role_id=1',[req.user.user_id]);
        if(!current.rows.length) invalid('Tu rol de administrador fue revocado.',403);
        return handler(req,client);
    });
}
async function existingPermissions(client,values) {
    const selected=ids(values,'permisos');
    const rows=(await client.query('SELECT permission_id FROM permissions WHERE permission_id=ANY($1) AND deleted_at IS NULL',[selected])).rows;
    if(rows.length!==selected.length) invalid('Uno de los permisos no existe o fue eliminado.');
    return selected;
}
async function roleRecord(client,id) {
    return (await client.query(`SELECT r.*,ARRAY(SELECT permission_id FROM join_roles_permissions WHERE role_id=r.role_id ORDER BY permission_id) permission_ids FROM roles r WHERE role_id=$1`,[id])).rows[0];
}
export const createPermission=adminTransaction(async(req,client)=>{
    const name=nameOf(req.body.name),description=String(req.body.description||'').slice(0,2048),capabilities=req.body.capabilities;
    if(!Array.isArray(capabilities)||capabilities.some(c=>!capabilityKeys.has(c))) invalid('Seleccione operaciones válidas.');
    const row=(await client.query('INSERT INTO permissions(name,code,description,capabilities) VALUES($1,$2,$3,$4) RETURNING *',[name,'custom_'+randomBytes(12).toString('hex'),description,[...new Set(capabilities)]])).rows[0];
    await audit(client,req,'permission.create','permission',row.permission_id,null,row);
    return {success:'Permiso creado.',data:row};
});
export const updatePermission=adminTransaction(async(req,client)=>{
    const id=Number(req.params.id),before=(await client.query('SELECT * FROM permissions WHERE permission_id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
    if(!before) invalid('Permiso no encontrado.',404);
    const name=nameOf(req.body.name),description=String(req.body.description||'').slice(0,2048),capabilities=req.body.capabilities;
    if(!Array.isArray(capabilities)||capabilities.some(c=>!capabilityKeys.has(c))) invalid('Seleccione operaciones válidas.');
    const after=(await client.query('UPDATE permissions SET name=$2,description=$3,capabilities=$4 WHERE permission_id=$1 RETURNING *',[id,name,description,[...new Set(capabilities)]])).rows[0];
    await audit(client,req,'permission.update','permission',id,before,after);
    return {success:'Permiso actualizado. El cambio ya se aplica a sus roles.',data:after};
});
export const deletePermission=adminTransaction(async(req,client)=>{
    const id=Number(req.params.id),before=(await client.query('SELECT * FROM permissions WHERE permission_id=$1 AND deleted_at IS NULL FOR UPDATE',[id])).rows[0];
    if(!before) invalid('Permiso no encontrado.',404);
    await client.query('DELETE FROM join_roles_permissions WHERE permission_id=$1',[id]);
    await client.query("UPDATE permissions SET deleted_at=now(),name=left(name,40)||' (eliminado #'||permission_id||')' WHERE permission_id=$1",[id]);
    await audit(client,req,'permission.delete','permission',id,before,null);
    return {success:'Permiso eliminado y retirado de sus roles.'};
});
export const createRole=adminTransaction(async(req,client)=>{
    const name=nameOf(req.body.name),permissions=await existingPermissions(client,req.body.permission_ids||req.body.permissions||[]);
    const row=(await client.query('INSERT INTO roles(name) VALUES($1) RETURNING *',[name])).rows[0];
    await client.query('INSERT INTO join_roles_permissions(role_id,permission_id) SELECT $1,unnest($2::int[])',[row.role_id,permissions]);
    await audit(client,req,'role.create','role',row.role_id,null,{...row,permission_ids:permissions});
    return {success:'Rol creado.',data:{role_id:row.role_id}};
});
export const updateRole=adminTransaction(async(req,client)=>{
    const id=Number(req.params.id||req.params.role_id),before=await roleRecord(client,id);
    if(!before) invalid('Rol no encontrado.',404);
    let selected=req.body.permission_ids;
    if(!selected) {
        const {add=[],remove=[]}=req.body.permissions||{};
        selected=[...new Set([...before.permission_ids,...ids(add,'permisos')])].filter(p=>!ids(remove,'permisos').includes(p));
    }
    const permissions=await existingPermissions(client,selected),name=nameOf(req.body.name||before.name);
    await client.query('UPDATE roles SET name=$2 WHERE role_id=$1',[id,name]);
    await client.query('DELETE FROM join_roles_permissions WHERE role_id=$1',[id]);
    await client.query('INSERT INTO join_roles_permissions(role_id,permission_id) SELECT $1,unnest($2::int[])',[id,permissions]);
    await audit(client,req,'role.update','role',id,before,{...before,name,permission_ids:permissions});
    return {success:'Rol actualizado.'};
});
export const deleteRole=adminTransaction(async(req,client)=>{
    const id=Number(req.params.id||req.params.role_id);if(id===1) invalid('El rol administrador del sistema no puede eliminarse.',409);
    const before=await roleRecord(client,id);if(!before) invalid('Rol no encontrado.',404);
    await client.query('DELETE FROM roles WHERE role_id=$1',[id]);
    await audit(client,req,'role.delete','role',id,before,null);
    return {success:'Rol eliminado y retirado de sus usuarios.'};
});
export const assignRoles=adminTransaction(async(req,client)=>{
    const id=Number(req.params.id||req.params.user_id);
    const user=(await client.query('SELECT user_id,name FROM users WHERE user_id=$1 FOR UPDATE',[id])).rows[0];if(!user) invalid('Usuario no encontrado.',404);
    const before=(await client.query('SELECT role_id FROM join_users_roles WHERE user_id=$1 ORDER BY role_id',[id])).rows.map(r=>r.role_id);
    let selected=req.body.role_ids;
    if(!selected) selected=[...new Set([...before,...ids(req.body.add||[],'roles')])].filter(r=>!ids(req.body.remove||[],'roles').includes(r));
    const roles=ids(selected,'roles');
    if((await client.query('SELECT role_id FROM roles WHERE role_id=ANY($1)',[roles])).rows.length!==roles.length) invalid('Uno de los roles no existe.');
    await client.query('DELETE FROM join_users_roles WHERE user_id=$1',[id]);
    await client.query('INSERT INTO join_users_roles(user_id,role_id) SELECT $1,unnest($2::int[])',[id,roles]);
    if(!(await client.query('SELECT 1 FROM join_users_roles WHERE role_id=1 LIMIT 1')).rows.length) invalid('Debe quedar al menos un administrador. Asigna primero el rol a otra persona.',409);
    await audit(client,req,'user.roles','user',id,{role_ids:before},{role_ids:roles});
    return {success:'Roles actualizados. Los accesos se aplican inmediatamente.'};
});
export async function snapshot(req,res) {
    const [users,roles,permissions,events]=await Promise.all([
        query(`SELECT u.user_id,u.username,u.name,u.lastname,ARRAY(SELECT role_id FROM join_users_roles WHERE user_id=u.user_id ORDER BY role_id) role_ids FROM users u ORDER BY user_id`),
        query(`SELECT r.*,ARRAY(SELECT permission_id FROM join_roles_permissions rp JOIN permissions p USING(permission_id) WHERE role_id=r.role_id AND p.deleted_at IS NULL ORDER BY permission_id) permission_ids FROM roles r ORDER BY role_id`),
        query('SELECT * FROM permissions WHERE deleted_at IS NULL ORDER BY permission_id'),
        query('SELECT e.*,u.name actor_name FROM security_events e LEFT JOIN users u ON u.user_id=e.actor_user_id ORDER BY id_security_event DESC LIMIT 100')
    ]);
    res.json({users:users.rows,roles:roles.rows,permissions:permissions.rows,events:events.rows,capabilities:policy.capabilities});
}
