export async function internalOdtRelations(client, id, userId) {
    const exists = (await client.query("SELECT to_regclass('public.odt_internal_billings') AS name")).rows[0].name;
    if (!exists) return [];
    return (await client.query(`SELECT b.id_internal_odt_billing,b.id_customer_odt,b.id_supplier_odt,
        b.amount::text,upper(c.code) AS currency_code,b.id_odt_payment,b.id_general_expense,b.created_at
        FROM odt_internal_billings b JOIN currencys c USING(id_currency)
        JOIN odts counterpart ON counterpart.id_odt=CASE
            WHEN b.id_customer_odt=$1 THEN b.id_supplier_odt ELSE b.id_customer_odt END
        WHERE (b.id_customer_odt=$1 OR b.id_supplier_odt=$1)
            AND (counterpart.id_user=$2 OR counterpart.id_user=1 OR $2 IN (1,11))
        ORDER BY b.id_internal_odt_billing`, [id, userId])).rows;
}
