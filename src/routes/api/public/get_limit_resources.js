import { query } from '../../../db';

export async function get(req, res) {
    const { rows: limit_resources } = await query(
        `SELECT l.amount,l.id_account,l.id_limit_resource,l.id_odt,a.id_currency,
            c.name_singular,c.name_plural,a.name,c.symbol,c.code
        FROM limit_resources l
        JOIN accounts a USING(id_account)
        JOIN currencys c USING(id_currency)
        JOIN odts o ON o.id_odt=l.id_odt
        WHERE (o.id_user=$1 OR o.id_user=1 OR $1 IN (1,11))
            AND NOT EXISTS (SELECT 1 FROM closure_odts cl WHERE cl.id_odt=o.id_odt)`,
        [req.user.user_id]
    );
    res.json({ limit_resources });
}
