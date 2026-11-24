const closureHeader = `
    CREATE OR REPLACE FUNCTION closure_odt(
        v_id_account integer,v_id_odt integer,v_id_user integer,v_amount numeric,
        v_id_user_ceo integer,admin_users json,operative_users json,supervisor_users json,
        admin_expense_percent numeric,president_profit_percent numeric
    ) RETURNS text LANGUAGE plpgsql AS $body$
`;

const legacyClosure = `
    PERFORM 1 FROM odts WHERE id_odt=v_id_odt FOR UPDATE;
    IF EXISTS(SELECT 1 FROM odt_payments WHERE id_odt=v_id_odt AND exchange_rate IS NULL) THEN
        RAISE EXCEPTION 'Selecciona la modalidad y revisa los importes manuales del cierre por moneda.';
    END IF;
    RETURN closure_odt_legacy(v_id_account,v_id_odt,v_id_user,v_amount,v_id_user_ceo,admin_users,
        operative_users,supervisor_users,admin_expense_percent,president_profit_percent);
`;

exports.up = pgm => {
    pgm.sql(`
        ${closureHeader}
        DECLARE selected odts%ROWTYPE;
        BEGIN
            IF v_amount IS DISTINCT FROM 0 THEN
                ${legacyClosure}
            END IF;

            SELECT * INTO selected FROM odts WHERE id_odt=v_id_odt FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'La ODT no existe.' USING ERRCODE='P0002';
            END IF;
            IF v_id_user IS NULL OR NOT(selected.id_user=v_id_user OR selected.id_user=1 OR v_id_user IN (1,11)) THEN
                RAISE EXCEPTION 'No tienes acceso a esta ODT.' USING ERRCODE='42501';
            END IF;
            IF EXISTS(SELECT 1 FROM closure_odts WHERE id_odt=v_id_odt) THEN
                RAISE EXCEPTION 'La ODT ya está cerrada.' USING ERRCODE='23505';
            END IF;
            IF selected.settlement_amount IS DISTINCT FROM 0 THEN
                RAISE EXCEPTION 'El cierre sin ingreso requiere un importe final acordado de cero.';
            END IF;
            IF v_id_account IS NOT NULL
                OR admin_expense_percent IS DISTINCT FROM 0 OR president_profit_percent IS DISTINCT FROM 0
                OR admin_users::jsonb IS DISTINCT FROM '[]'::jsonb
                OR operative_users::jsonb IS DISTINCT FROM '[]'::jsonb
                OR supervisor_users::jsonb IS DISTINCT FROM '[]'::jsonb THEN
                RAISE EXCEPTION 'El cierre sin ingreso no lleva cuenta, administración ni comisiones.';
            END IF;
            IF EXISTS(SELECT 1 FROM odt_payments WHERE id_odt=v_id_odt) THEN
                RAISE EXCEPTION 'No se puede cerrar sin ingreso una ODT con abonos.';
            END IF;
            IF EXISTS(SELECT 1 FROM odt_expense_sources(v_id_odt)) THEN
                RAISE EXCEPTION 'La ODT tiene gastos registrados y requiere conciliación antes de cerrarse sin ingreso.';
            END IF;
            IF EXISTS(SELECT 1 FROM payroll_odt_hours WHERE id_odt=v_id_odt AND is_paid IS NOT TRUE AND hours_spent>0) THEN
                RAISE EXCEPTION 'No se puede cerrar la ODT: hay horas de nómina pendientes de pago.';
            END IF;
            INSERT INTO closure_odts(id_user,id_odt,id_account,amount,admin_expense_percent,
                general_expense,inv_expense,gross_profit,taionca_profit,settled_from_payments)
                VALUES(v_id_user,v_id_odt,NULL,0,0,0,0,0,0,false);
            RETURN 'success';
        END;
        $body$;
    `);
};

exports.down = pgm => {
    pgm.sql(`
        ${closureHeader}
        BEGIN
            ${legacyClosure}
        END;
        $body$;
    `);
};
