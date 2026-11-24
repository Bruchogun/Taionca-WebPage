import argon2 from 'argon2';
import { query } from '../../../db';
import { identity,regenerate,saveSession } from '../../../security/identity';
import { ACCOUNTING_ONLY_PASSWORD } from '../../../security/account';
import { clearLoginAttempt, loginOrigin, registerLoginAttempt } from '../../../security/login-attempts';

function invalidCredentials(res) {
    res.statusCode=401;
    return res.json({error:'Usuario o contraseña incorrecta.'});
}

export async function post(req,res) {
    const {username,password}=req.body;
    if(typeof username!=='string'||!username.trim()||typeof password!=='string'||!password||username.length>128||password.length>1024) {
        res.statusCode=400;return res.json({error:'Ingrese usuario y contraseña válidos.'});
    }
    const normalized=username.trim().toLowerCase();
    try {
        const attempt=await registerLoginAttempt(normalized,loginOrigin(req));
        if(attempt.blocked) {res.statusCode=429;res.setHeader('Retry-After','900');return res.json({error:'Demasiados intentos. Inténtalo en 15 minutos.'});}
        const user=(await query('SELECT user_id,password_hash,session_version FROM users WHERE username=$1',[normalized])).rows[0];
        if(!user || user.password_hash===ACCOUNTING_ONLY_PASSWORD || !await argon2.verify(user.password_hash,password)) return invalidCredentials(res);
        const current=await identity(user.user_id);
        if(!current || current.session_version!==user.session_version) return invalidCredentials(res);
        await regenerate(req);req.session.user=current;req.user=current;await saveSession(req);
        await clearLoginAttempt(attempt).catch(error => console.error('No se pudieron actualizar los intentos de acceso.', error.code));
        res.json({success:'Inicio de sesión exitoso',session:current,redirect:current.is_admin||current.capabilities.includes('finance.read')?'/':'/attendance'});
    }catch(error){res.statusCode=500;res.json({error:'No se pudo iniciar sesión.'});}
}
