// Server-only: one statement gives a consistent snapshot of totals and their payment history.
export async function paymentSummary(client, id, userId) {
    const { rows } = await client.query(`SELECT o.id_odt,o.amount,o.id_currency,upper(c.code) AS currency_code,c.symbol,
        EXISTS(SELECT 1 FROM closure_odts WHERE id_odt=o.id_odt) AS closed,
        coalesce(p.paid_amount,0)::numeric(30,10) AS paid_amount,
        (o.amount-coalesce(p.paid_amount,0))::numeric(30,10) AS remaining_amount,
        coalesce(p.payments,'[]'::jsonb) AS payments,
        coalesce((SELECT jsonb_agg(jsonb_build_object('account_name',a.name,'currency_code',upper(m.code),
            'entity_name',e.name,'amount',d.amount::text) ORDER BY d.id_account,d.id_entity)
            FROM closure_odt_allocations d JOIN closure_odts cl USING(id_closure_odt)
            JOIN accounts a ON a.id_account=d.id_account JOIN currencys m ON m.id_currency=a.id_currency
            JOIN entitys e USING(id_entity) WHERE cl.id_odt=o.id_odt),'[]'::jsonb) AS allocations
        FROM odts o JOIN currencys c USING(id_currency)
        LEFT JOIN LATERAL (SELECT sum(p.amount_odt) AS paid_amount,
            jsonb_agg(jsonb_build_object('id_odt_payment',p.id_odt_payment,'id_account',p.id_account,
                'account_name',a.name,'currency_code',upper(m.code),'symbol',m.symbol,
                'amount',p.amount::text,'exchange_rate',p.exchange_rate::text,'amount_odt',p.amount_odt::text,
                'description',p.description,'created_at',p.created_at,'user_name',u.name || ' ' || u.lastname)
                ORDER BY p.id_odt_payment) AS payments
            FROM odt_payments p JOIN accounts a USING(id_account) JOIN currencys m ON m.id_currency=p.id_currency
            JOIN users u ON u.user_id=p.id_user WHERE p.id_odt=o.id_odt) p ON true
        WHERE o.id_odt=$1 AND (o.id_user=$2 OR o.id_user=1 OR $2 IN (1,11))`, [id, userId]);
    if (!rows[0]) {
        const error = new Error('La ODT no existe o no tienes acceso a ella.');
        error.code = 'P0002';
        throw error;
    }
    return rows[0];
}

export function paymentError(res, error) {
    const codes = { P0002: 404, '42501': 403, '23505': 409, P0001: 400, '23503': 400, '23514': 400, '22P02': 400, '22003': 400 };
    res.statusCode = codes[error.code] || 500;
    const safe = ['P0001', 'P0002', '42501'].includes(error.code) || (error.code === '23505' && !error.constraint);
    return res.json({ error: safe ? error.message : res.statusCode < 500 ? 'Revisa los datos del abono. La operación no se registró.' : 'No se pudo confirmar el abono. Reintenta con la misma referencia.' });
}
