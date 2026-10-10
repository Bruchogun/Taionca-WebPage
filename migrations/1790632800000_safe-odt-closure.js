exports.up = pgm => {
    pgm.sql(`
        -- numeric(5,5) cannot store 1.00000 (100%). Keep the existing five decimal places.
        ALTER TABLE odts ALTER COLUMN admin_percent TYPE numeric(6,5);
        ALTER TABLE closure_odts ALTER COLUMN admin_expense_percent TYPE numeric(6,5);
        ALTER TABLE admin_closure_odts ALTER COLUMN profit_percent TYPE numeric(6,5);
        ALTER TABLE operative_closure_odts ALTER COLUMN profit_percent TYPE numeric(6,5);
        ALTER TABLE supervisor_closure_odts ALTER COLUMN profit_percent TYPE numeric(6,5);
        ALTER TABLE ceo_closure_odts ALTER COLUMN profit_percent TYPE numeric(6,5);

        CREATE OR REPLACE FUNCTION closure_odt(
            v_id_account integer, v_id_odt integer, v_id_user integer, v_amount numeric,
            v_id_user_ceo integer, admin_users json, operative_users json, supervisor_users json,
            admin_expense_percent numeric, president_profit_percent numeric
        ) RETURNS text LANGUAGE plpgsql AS $body$
        DECLARE
            selected_odt odts%ROWTYPE;
            account_currency integer;
            closure_id integer;
            ceo_entity integer;
            participant record;
            recipient record;
            group_users json;
            group_total numeric := 0;
            general_total numeric(30,10);
            inventory_total numeric(30,10);
            administrative_amount numeric(30,10);
            gross numeric(30,10);
            commissions numeric(30,10);
            company_amount numeric(30,10);
            movement_total numeric(30,10);
        BEGIN
            SELECT * INTO selected_odt FROM odts WHERE id_odt = v_id_odt FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'La ODT no existe.' USING ERRCODE = 'P0002'; END IF;
            IF v_id_user IS NULL OR NOT (selected_odt.id_user = v_id_user OR selected_odt.id_user = 1 OR v_id_user IN (1,11)) THEN
                RAISE EXCEPTION 'No tienes acceso a esta ODT.' USING ERRCODE = '42501';
            END IF;
            IF EXISTS (SELECT 1 FROM closure_odts WHERE id_odt = v_id_odt) THEN
                RAISE EXCEPTION 'La ODT ya está cerrada.' USING ERRCODE = '23505';
            END IF;
            SELECT id_currency INTO account_currency FROM accounts WHERE id_account = v_id_account FOR SHARE;
            IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta de destino no existe.' USING ERRCODE = 'P0002'; END IF;
            IF account_currency <> selected_odt.id_currency THEN
                RAISE EXCEPTION 'La cuenta de destino debe tener la misma moneda que la ODT.';
            END IF;
            IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount <= 0 OR v_amount >= 1e20 OR round(v_amount,10) <> v_amount THEN
                RAISE EXCEPTION 'El monto pagado debe ser mayor que cero, con hasta 10 decimales.';
            END IF;
            IF admin_expense_percent IS NULL OR president_profit_percent IS NULL
                OR admin_expense_percent NOT BETWEEN 0 AND 1 OR president_profit_percent NOT BETWEEN 0 AND 1
                OR round(admin_expense_percent,5) <> admin_expense_percent OR round(president_profit_percent,5) <> president_profit_percent THEN
                RAISE EXCEPTION 'Los porcentajes deben estar entre 0 y 100%%, con hasta 3 decimales porcentuales.';
            END IF;
            group_total := president_profit_percent;
            FOREACH group_users IN ARRAY ARRAY[admin_users, operative_users, supervisor_users] LOOP
                IF group_users IS NULL OR json_typeof(group_users) <> 'array' THEN
                    RAISE EXCEPTION 'Las comisiones deben ser listas de usuarios.';
                END IF;
                IF EXISTS (SELECT 1 FROM json_to_recordset(group_users) AS x(id_user integer, profit_percent numeric)
                    GROUP BY id_user HAVING count(*) > 1) THEN
                    RAISE EXCEPTION 'Un usuario no puede repetirse dentro del mismo grupo de comisiones.';
                END IF;
                FOR participant IN SELECT * FROM json_to_recordset(group_users) AS x(id_user integer, profit_percent numeric) LOOP
                    IF participant.profit_percent IS NULL OR participant.profit_percent NOT BETWEEN 0 AND 1
                        OR round(participant.profit_percent,5) <> participant.profit_percent THEN
                        RAISE EXCEPTION 'Cada comisión debe estar entre 0 y 100%%.';
                    END IF;
                    PERFORM 1 FROM users WHERE user_id = participant.id_user AND id_entity IS NOT NULL FOR SHARE;
                    IF NOT FOUND THEN RAISE EXCEPTION 'Un usuario de comisión no existe o no tiene entidad contable.'; END IF;
                    group_total := group_total + participant.profit_percent;
                END LOOP;
            END LOOP;
            IF group_total > 1 THEN RAISE EXCEPTION 'La suma de las comisiones, incluido el presidente, no puede superar el 100%%.'; END IF;
            SELECT id_entity INTO ceo_entity FROM users WHERE user_id = v_id_user_ceo FOR SHARE;
            IF ceo_entity IS NULL THEN RAISE EXCEPTION 'El presidente no tiene entidad contable.'; END IF;
            IF EXISTS (SELECT 1 FROM payroll_odt_hours WHERE id_odt = v_id_odt AND is_paid IS NOT TRUE AND hours_spent > 0) THEN
                RAISE EXCEPTION 'No se puede cerrar la ODT: hay horas de nómina pendientes de pago.';
            END IF;

            -- General expenses already contain the total paid; quantity must not multiply it again.
            SELECT coalesce(sum(e.amount * e.rate),0) INTO general_total FROM general_expenses e WHERE e.id_odt = v_id_odt;
            -- Use the originally booked inventory cost when available, even if its price later changes.
            SELECT coalesce(sum(cost),0) INTO inventory_total FROM (
                SELECT coalesce((SELECT -sum(m.amount) FROM balance_movements m JOIN balances b USING(id_balance)
                    WHERE m.type_movement_category='spendable_inv_odt_expenses'
                    AND m.id_movement_category=e.id_spendable_inv_odt_expense AND b.id_entity=1), e.amount * i.price) * e.rate AS cost FROM spendable_inv_odt_expenses e
                    JOIN spendable_stocks s USING(id_spendable_stock) JOIN spendable_items i USING(id_spendable_item) WHERE e.id_odt = v_id_odt
                UNION ALL
                SELECT coalesce((SELECT -sum(m.amount) FROM balance_movements m JOIN balances b USING(id_balance)
                    WHERE m.type_movement_category='no_spendable_inv_odt_expenses'
                    AND m.id_movement_category=e.id_no_spendable_inv_odt_expense AND b.id_entity=1), e.amount * i.price) * e.rate AS cost FROM no_spendable_inv_odt_expenses e
                    JOIN no_spendable_stocks s USING(id_no_spendable_stock) JOIN no_spendable_items i USING(id_no_spendable_item) WHERE e.id_odt = v_id_odt
            ) costs;
            administrative_amount := round(v_amount * admin_expense_percent,10);
            gross := v_amount - general_total - inventory_total - administrative_amount;
            IF gross < 0 THEN RAISE EXCEPTION 'El pago no cubre los gastos y el porcentaje administrativo. Revisa el monto y el porcentaje.'; END IF;

            INSERT INTO closure_odts(id_user,id_odt,id_account,amount,admin_expense_percent,general_expense,inv_expense,gross_profit)
                VALUES(v_id_user,v_id_odt,v_id_account,v_amount,admin_expense_percent,general_total,inventory_total,gross)
                RETURNING id_closure_odt INTO closure_id;
            INSERT INTO admin_closure_odts(id_closure_odt,id_user,profit_percent,profit)
                SELECT closure_id,id_user,profit_percent,round(gross * profit_percent,10)
                FROM json_to_recordset(admin_users) AS x(id_user integer,profit_percent numeric);
            INSERT INTO operative_closure_odts(id_closure_odt,id_user,profit_percent,profit)
                SELECT closure_id,id_user,profit_percent,round(gross * profit_percent,10)
                FROM json_to_recordset(operative_users) AS x(id_user integer,profit_percent numeric);
            INSERT INTO supervisor_closure_odts(id_closure_odt,id_user,profit_percent,profit)
                SELECT closure_id,id_user,profit_percent,round(gross * profit_percent,10)
                FROM json_to_recordset(supervisor_users) AS x(id_user integer,profit_percent numeric);
            INSERT INTO ceo_closure_odts(id_closure_odt,id_user,profit_percent,profit)
                VALUES(closure_id,v_id_user_ceo,president_profit_percent,round(gross * president_profit_percent,10));
            SELECT coalesce(sum(profit),0) INTO commissions FROM (
                SELECT profit FROM admin_closure_odts WHERE id_closure_odt=closure_id
                UNION ALL SELECT profit FROM operative_closure_odts WHERE id_closure_odt=closure_id
                UNION ALL SELECT profit FROM supervisor_closure_odts WHERE id_closure_odt=closure_id
                UNION ALL SELECT profit FROM ceo_closure_odts WHERE id_closure_odt=closure_id
            ) profits;
            -- Assign the rounding remainder to Taionca so the ledger sums to the exact payment.
            -- This preserves the existing rule: Taionca receives its profit plus recovered expenses.
            company_amount := v_amount - administrative_amount - commissions;
            IF company_amount < 0 THEN RAISE EXCEPTION 'El redondeo de las comisiones supera el monto disponible.'; END IF;
            UPDATE closure_odts SET taionca_profit=company_amount WHERE id_closure_odt=closure_id;
            UPDATE odts SET admin_percent=admin_expense_percent WHERE id_odt=v_id_odt;

            -- Group repeated entities across roles and lock balances in a consistent order.
            FOR recipient IN
                SELECT id_entity,sum(amount) AS amount FROM (
                    SELECT 1 AS id_entity,company_amount AS amount
                    UNION ALL SELECT 2,administrative_amount
                    UNION ALL SELECT u.id_entity,c.profit FROM admin_closure_odts c JOIN users u ON u.user_id=c.id_user WHERE c.id_closure_odt=closure_id
                    UNION ALL SELECT u.id_entity,c.profit FROM operative_closure_odts c JOIN users u ON u.user_id=c.id_user WHERE c.id_closure_odt=closure_id
                    UNION ALL SELECT u.id_entity,c.profit FROM supervisor_closure_odts c JOIN users u ON u.user_id=c.id_user WHERE c.id_closure_odt=closure_id
                    UNION ALL SELECT ceo_entity,profit FROM ceo_closure_odts WHERE id_closure_odt=closure_id
                ) allocations GROUP BY id_entity ORDER BY id_entity
            LOOP
                INSERT INTO balances(id_account,id_entity) VALUES(v_id_account,recipient.id_entity)
                    ON CONFLICT(id_account,id_entity) DO NOTHING;
                PERFORM alter_balance(id_balance,recipient.amount,closure_id,'closure_odts')
                    FROM balances WHERE id_account=v_id_account AND id_entity=recipient.id_entity;
            END LOOP;
            SELECT sum(amount) INTO movement_total FROM balance_movements
                WHERE type_movement_category='closure_odts' AND id_movement_category=closure_id;
            IF movement_total IS DISTINCT FROM v_amount THEN RAISE EXCEPTION 'El total contable no coincide con el pago. Se canceló el cierre.'; END IF;
            RETURN 'success';
        END;
        $body$;

        -- Route the legacy signature through the same validations and ledger calculation.
        CREATE OR REPLACE FUNCTION closure_odt(
            v_id_account integer,v_id_odt integer,v_id_user integer,v_amount numeric,
            admin_users json,operative_users json,supervisor_users json,
            admin_expense_percent numeric,president_profit_percent numeric
        ) RETURNS text LANGUAGE sql AS $body$
            SELECT closure_odt($1,$2,$3,$4,2,$5,$6,$7,$8,$9);
        $body$;
    `);
};

exports.down = pgm => {
    // Restore the previous functions; retain wider percentage columns to preserve any 100% records.
    for (const file of ['1629030793946_SQL-closure-odts', '1720296506624_SQL-closure-odts-2']) {
        require(`./${file}`).up({ sql: strings => {
            const sql = typeof strings === 'string' ? strings : strings.join('');
            pgm.sql(sql.match(/CREATE OR REPLACE FUNCTION closure_odt[\s\S]*?\$body\$;/)[0]);
        }});
    }
};
