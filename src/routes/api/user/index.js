import argon2 from 'argon2';
import { argon as config } from '../../../config';
import { query } from '../../../db';
import { identity,regenerate,saveSession,destroySession } from '../../../security/identity';
export async function get(req,res) {res.json({session:req.user});}
export async function patch(req,res) {
    const {old_password,new_password}=req.body;
    if(typeof old_password!=='string'||typeof new_password!=='string'||!new_password||new_password.length>1024) {res.statusCode=400;return res.json({error:'Ingrese las contraseñas anterior y nueva.'});}
    try {
        const current=(await query('SELECT password_hash FROM users WHERE user_id=$1',[req.user.user_id])).rows[0];
        if(!await argon2.verify(current.password_hash,old_password)) {res.statusCode=400;return res.json({error:'Contraseña incorrecta.'});}
        const hash=await argon2.hash(new_password,config);
        const changed=(await query('UPDATE users SET password_hash=$2,session_version=session_version+1 WHERE user_id=$1 AND password_hash=$3 RETURNING user_id',[req.user.user_id,hash,current.password_hash])).rows[0];
        if(!changed) {res.statusCode=409;return res.json({error:'La contraseña cambió durante esta solicitud. Vuelve a iniciar sesión.'});}
        const user=await identity(changed.user_id);await regenerate(req);req.session.user=user;await saveSession(req);
        res.json({success:'Contraseña actualizada. Las otras sesiones se cerraron.',session:user});
    }catch(error){res.statusCode=500;res.json({error:'No se pudo actualizar la contraseña.'});}
}
export async function del(req,res) {
    await destroySession(req);res.setHeader('Set-Cookie','sessionId=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    res.json({success:'Sesión cerrada.'});
}
