export async function internalOdtRelations(client, id) {
    const exists = (await client.query("SELECT to_regclass('public.odt_internal_billings') AS name")).rows[0].name;
    if (!exists) return [];
    return (await client.query(`SELECT b.id_internal_odt_billing,b.id_customer_odt,b.id_supplier_odt,
        b.amount::text,upper(c.code) AS currency_code,b.id_odt_payment,b.id_general_expense,b.created_at
        FROM odt_internal_billings b JOIN currencys c USING(id_currency)
        WHERE b.id_customer_odt=$1 OR b.id_supplier_odt=$1
        ORDER BY b.id_internal_odt_billing`, [id])).rows;
}
