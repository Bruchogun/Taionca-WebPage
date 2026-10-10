import argon2 from 'argon2';
import { createHash } from 'crypto';
import { query } from '../../../db';
import { identity,regenerate,saveSession } from '../../../security/identity';
export async function post(req,res) {
    const {username,password}=req.body;
    if(typeof username!=='string'||!username.trim()||typeof password!=='string'||!password||username.length>128||password.length>1024) {
        res.statusCode=400;return res.json({error:'Ingrese usuario y contraseña válidos.'});
    }
    const normalized=username.trim().toLowerCase();
    const key=createHash('sha256').update(normalized+'|'+(req.socket?.remoteAddress||'local')).digest('hex');
    try {
        const attempt=(await query(`INSERT INTO login_attempts(key,attempts) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET
            attempts=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
            window_start=CASE WHEN login_attempts.window_start < now()-interval '15 minutes' THEN now() ELSE login_attempts.window_start END
            RETURNING attempts`,[key])).rows[0];
        if(attempt.attempts>5) {res.statusCode=429;res.setHeader('Retry-After','900');return res.json({error:'Demasiados intentos. Inténtalo en 15 minutos.'});}
        const user=(await query('SELECT user_id,password_hash FROM users WHERE username=$1',[normalized])).rows[0];
        if(!user || !await argon2.verify(user.password_hash,password)) {res.statusCode=401;return res.json({error:'Usuario o contraseña incorrecta.'});}
        const current=await identity(user.user_id);
        await regenerate(req);req.session.user=current;req.user=current;await saveSession(req);
        await query('DELETE FROM login_attempts WHERE key=$1',[key]);
        res.json({success:'Inicio de sesión exitoso',session:current,redirect:current.is_admin||current.capabilities.includes('finance.read')?'/':'/attendance'});
    }catch(error){res.statusCode=500;res.json({error:'No se pudo iniciar sesión.'});}
}
