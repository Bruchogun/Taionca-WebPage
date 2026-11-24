export async function commissionSupplements(client, idOdt) {
    const { rows: [schema] } = await client.query(
        `SELECT CASE WHEN has_schema_privilege(to_regnamespace('ledger_import'),'USAGE') THEN
            has_table_privilege(to_regclass('ledger_import.mauro100_supplement16_outcomes'),'SELECT')
            AND has_table_privilege(to_regclass('ledger_import.mauro100_supplement16_runs'),'SELECT')
        END AS available,
        has_table_privilege(to_regclass('public.profit_supplement_credits'),'SELECT') AS historical_available`
    );
    const legacy = schema.available ? (await client.query(`SELECT s.id_odt,s.id_part,s.recipient_user_id,
        'legacy:' || s.id_part AS source_id,
        u.name || ' ' || u.lastname AS user_name,s.commission_percent::text AS percent,
        s.delta::text AS amount,upper(c.code) AS currency,a.name AS account,
        s.id_transfer_entity,r.technical_timestamp AS recorded_at,r.actual_event_date
        FROM ledger_import.mauro100_supplement16_outcomes s
        JOIN ledger_import.mauro100_supplement16_runs r USING(id_run)
        JOIN users u ON u.user_id=s.recipient_user_id
        JOIN currencys c USING(id_currency) JOIN accounts a USING(id_account)
        WHERE s.id_odt=$1 ORDER BY s.id_part`, [idOdt])).rows : [];
    const historical = schema.historical_available ? (await client.query(`SELECT s.id_odt,p.id_part,
        'historical:' || s.id_profit_supplement_credit AS source_id,s.id_user AS recipient_user_id,s.role,
        u.name || ' ' || u.lastname AS user_name,s.commission_percent::text AS percent,
        s.amount::text AS amount,upper(c.code) AS currency,a.name AS account,
        s.id_transfer_entity,s.technical_timestamp AS recorded_at,NULL::date AS actual_event_date
        FROM public.profit_supplement_credits s
        JOIN users u ON u.user_id=s.id_user
        JOIN currencys c USING(id_currency) JOIN accounts a USING(id_account)
        LEFT JOIN closure_odt_parts p ON p.id_closure_odt=s.id_closure_odt AND p.id_currency=s.id_currency
        WHERE s.id_odt=$1 ORDER BY s.id_profit_supplement_credit`, [idOdt])).rows : [];
    return [...legacy, ...historical];
}
