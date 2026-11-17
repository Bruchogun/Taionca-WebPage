export async function commissionSupplements(client, idOdt) {
    const { rows: [schema] } = await client.query(
        "SELECT to_regclass('ledger_import.mauro100_supplement16_outcomes') AS outcomes"
    );
    if (!schema.outcomes) return [];
    return (await client.query(`SELECT s.id_odt,s.id_part,s.recipient_user_id,
        u.name || ' ' || u.lastname AS user_name,s.commission_percent::text AS percent,
        s.delta::text AS amount,upper(c.code) AS currency,a.name AS account,
        s.id_transfer_entity,r.technical_timestamp::text AS recorded_at,r.actual_event_date
        FROM ledger_import.mauro100_supplement16_outcomes s
        JOIN ledger_import.mauro100_supplement16_runs r USING(id_run)
        JOIN users u ON u.user_id=s.recipient_user_id
        JOIN currencys c USING(id_currency) JOIN accounts a USING(id_account)
        WHERE s.id_odt=$1 ORDER BY s.id_part`, [idOdt])).rows;
}
