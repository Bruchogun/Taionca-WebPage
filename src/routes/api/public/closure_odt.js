import { pool } from '../../../db';
import { validateClosure } from '../../../lib/odt-closure';

export async function post(req, res) {
    const user = req.session && req.session.user;
    const fail = (status, error) => {
        res.statusCode = status;
        return res.json({ error });
    };
    if (!user) return fail(401, 'Debes iniciar sesión para cerrar una ODT.');
    if (!req.authorized) {
        return fail(403, 'No tienes permiso para cerrar ODTs.');
    }
    const error = validateClosure(req.body);
    if (error) return fail(400, error);
    const { id_account, id_odt, amount, admin_users, operative_users,
        supervisor_users, admin_percent, ceo_percent } = req.body;
    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        // The function locks the ODT and updates the closure, percentages and ledger atomically.
        await client.query('SELECT closure_odt($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [
            req.body.settle_payments ? null : id_account, id_odt, user.user_id, amount, 2,
            JSON.stringify(admin_users), JSON.stringify(operative_users),
            JSON.stringify(supervisor_users), admin_percent, ceo_percent
        ]);
        const { rows } = await client.query(`
            SELECT c.id_closure_odt, c.id_odt, c.id_account, c.amount, c.settled_from_payments,
                   coalesce(a.name,(SELECT string_agg(DISTINCT ac.name, ', ')
                       FROM odt_payments p JOIN accounts ac USING(id_account) WHERE p.id_odt=c.id_odt)) AS account_name,
                   m.code AS currency_code, m.symbol
            FROM closure_odts c LEFT JOIN accounts a USING (id_account)
            JOIN odts o USING(id_odt) JOIN currencys m ON m.id_currency = o.id_currency
            WHERE c.id_odt = $1`, [id_odt]);
        await client.query('COMMIT');
        return res.json({ success: 'ODT cerrada exitosamente', data: rows[0] });
    } catch (err) {
        if (client) await client.query('ROLLBACK').catch(() => {});
        if (err.code === '23505') return fail(409, 'La ODT ya está cerrada. El ingreso no se ha duplicado.');
        if (err.code === 'P0002') return fail(404, err.message);
        if (err.code === '42501') return fail(403, err.message);
        if (err.code === 'P0001') return fail(400, err.message);
        if (['23503', '23514', '22P02', '22003'].includes(err.code)) {
            return fail(400, 'Revisa la cuenta, los usuarios, los porcentajes y el monto del cierre.');
        }
        console.error('ODT closure failed:', err.code || 'connection error');
        return fail(500, 'No se pudo cerrar la ODT. No se registró ningún ingreso.');
    } finally {
        if (client) client.release();
    }
}
