function billingFunction() {
    let source = '';
    require('./1791684000000_internal-odt-billings').up({
        sql(parts) { source += Array.isArray(parts) ? parts.join('') : parts; }
    });
    const definition = source.match(/CREATE FUNCTION register_internal_odt_billing\([\s\S]*?\$body\$;/);
    if (!definition) throw new Error('Original internal billing function not found.');
    return definition[0].replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
}

exports.up = pgm => {
    const definition = billingFunction();
    const paymentLock = 'SELECT * INTO payment FROM odt_payments WHERE id_odt_payment=v_payment FOR UPDATE;';
    if (!definition.includes(paymentLock)) throw new Error('Original internal billing payment lock not found.');
    pgm.sql(definition.replace(paymentLock, `
                PERFORM 1 FROM odts WHERE id_odt IN (v_customer_odt,v_supplier_odt) ORDER BY id_odt FOR UPDATE;
                PERFORM 1 FROM accounts WHERE id_account=v_account FOR SHARE;
                ${paymentLock}`));
};

exports.down = pgm => {
    pgm.sql(billingFunction());
};
