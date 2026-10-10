import { query } from '../db';
import { policy } from './access';
export async function identity(userId) {
    const user=(await query(`SELECT user_id,username,name,lastname,special_user,session_version,
        ARRAY(SELECT role_id FROM join_users_roles WHERE user_id=u.user_id ORDER BY role_id) roles
        FROM users u WHERE user_id=$1`,[userId])).rows[0];
    if(!user) return null;
    const permissions=(await query(`SELECT DISTINCT p.* FROM permissions p JOIN join_roles_permissions rp USING(permission_id)
        JOIN join_users_roles ur USING(role_id) WHERE ur.user_id=$1 AND p.deleted_at IS NULL ORDER BY permission_id`,[userId])).rows;
    user.is_admin=user.roles.includes(1);
    user.capabilities=user.is_admin?policy.capabilities.map(c=>c.key):[...new Set(permissions.flatMap(p=>p.capabilities))];
    user.permissions=permissions.map(p=>p.permission_id);
    return user;
}
export function regenerate(req) {return new Promise((resolve,reject)=>req.session.regenerate(error=>error?reject(error):resolve()));}
export function saveSession(req) {return new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));}
export function destroySession(req) {return new Promise((resolve,reject)=>req.session.destroy(error=>error?reject(error):resolve()));}
