import { pool } from '../../../db';
import { validatePayment } from '../../../lib/odt-payments';
import { paymentSummary, paymentError } from '../../../lib/odt-payment-data';

export async function post(req, res) {
    const user = req.session && req.session.user;
    res.setHeader('Cache-Control', 'no-store');
    if (!user) { res.statusCode = 401; return res.json({ error: 'Debes iniciar sesión para registrar abonos.' }); }
    if (!req.authorized) { res.statusCode = 403; return res.json({ error: 'No tienes permiso para registrar abonos.' }); }
    const error = validatePayment(req.body);
    if (error) { res.statusCode = 400; return res.json({ error }); }
    const { id_odt, id_account, amount, amount_odt, exchange_rate, description, request_key } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const statement = amount_odt === undefined
            ? 'SELECT register_odt_payment($1,$2,$3,$4,$5,$6,$7) AS id_odt_payment'
            : 'SELECT register_odt_payment_amount($1,$2,$3,$4,$5,$6,$7) AS id_odt_payment';
        const { rows } = await client.query(statement,
            [id_odt, id_account, user.user_id, amount, amount_odt === undefined ? exchange_rate : amount_odt, description, request_key]);
        const data = await paymentSummary(client, id_odt, user.user_id);
        await client.query('COMMIT');
        return res.json({ success: 'Abono registrado en la cuenta seleccionada.', id_odt_payment: rows[0].id_odt_payment, data });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        return paymentError(res, err);
    } finally { if (client) client.release(); }
}
