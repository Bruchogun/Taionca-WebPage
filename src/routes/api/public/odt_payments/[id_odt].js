import { pool } from '../../../../db';
import { validId } from '../../../../lib/odt-closure';
import { paymentSummary, paymentError } from '../../../../lib/odt-payment-data';

export async function get(req, res) {
    const user = req.session && req.session.user;
    res.setHeader('Cache-Control', 'no-store');
    if (!user) { res.statusCode = 401; return res.json({ error: 'Debes iniciar sesión.' }); }
    if (!req.authorized) {
        res.statusCode = 403; return res.json({ error: 'No tienes permiso para consultar abonos.' });
    }
    if (!validId(req.params.id_odt)) { res.statusCode = 400; return res.json({ error: 'Selecciona una ODT válida.' }); }
    try { return res.json({ data: await paymentSummary(pool, req.params.id_odt, user.user_id) }); }
    catch (err) { return paymentError(res, err); }
}
