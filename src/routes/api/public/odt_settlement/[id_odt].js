import { pool } from '../../../../db';
import { validId } from '../../../../lib/odt-closure';
import { settlementSource } from '../../../../lib/odt-settlement-data';
import { paymentError } from '../../../../lib/odt-payment-data';
export async function get(req,res) {
    const user=req.session && req.session.user;
    res.setHeader('Cache-Control','no-store');
    if (!user) {res.statusCode=401;return res.json({error:'Debes iniciar sesión.'});}
    if (!req.authorized) {res.statusCode=403;return res.json({error:'No tienes permiso para preparar cierres.'});}
    if (!validId(req.params.id_odt)) {res.statusCode=400;return res.json({error:'Selecciona una ODT válida.'});}
    let client;
    try {
        client=await pool.connect();await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const data=await settlementSource(client,req.params.id_odt,user.user_id);
        await client.query('COMMIT');return res.json({data});
    } catch(err) {if(client)await client.query('ROLLBACK').catch(()=>{});return paymentError(res,err);}
    finally {if(client)client.release();}
}
