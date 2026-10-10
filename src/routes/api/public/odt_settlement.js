import { pool } from '../../../db';
import { validId } from '../../../lib/odt-closure';
import { settleOdt } from '../../../lib/odt-settlement-data';
export async function post(req,res) {
    const user=req.session && req.session.user;
    res.setHeader('Cache-Control','no-store');
    const fail=(status,error)=>{res.statusCode=status;return res.json({error});};
    if (!user) return fail(401,'Debes iniciar sesión.');
    if (!req.authorized) return fail(403,'No tienes permiso para cerrar ODTs.');
    if (!req.body || !validId(req.body.id_odt)) return fail(400,'Selecciona una ODT válida.');
    let client;
    try {
        client=await pool.connect();await client.query('BEGIN');
        const data=await settleOdt(client,req.body,user.user_id);
        await client.query('COMMIT');return res.json({success:'ODT cerrada con sus importes por moneda.',data});
    } catch(err) {
        if(client)await client.query('ROLLBACK').catch(()=>{});
        if(['P0001','P0002','42501','23505'].includes(err.code)) return fail(({P0001:400,P0002:404,'42501':403,'23505':409})[err.code],err.message);
        if(['23503','23514','22P02','22003'].includes(err.code)) return fail(400,'Revisa los importes, las cuentas y los usuarios del cierre.');
        console.error('Currency settlement failed:',err.code || err.name);
        return fail(500,'No se pudo confirmar el cierre. Revisa su estado antes de volver a intentarlo.');
    } finally {if(client)client.release();}
}
