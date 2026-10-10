exports.up = pgm => {
    pgm.sql(`
        ALTER TABLE closure_odts ALTER COLUMN id_account DROP NOT NULL;
        ALTER TABLE closure_odts ADD COLUMN settled_from_payments boolean NOT NULL DEFAULT false;
        CREATE TABLE odt_payments (
            id_odt_payment serial PRIMARY KEY,
            id_odt integer NOT NULL REFERENCES odts(id_odt),
            id_user integer NOT NULL REFERENCES users(user_id),
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_currency integer NOT NULL REFERENCES currencys(id_currency),
            odt_currency integer NOT NULL REFERENCES currencys(id_currency),
            amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
            exchange_rate numeric(30,10) NOT NULL CHECK(exchange_rate>0 AND exchange_rate<1e20),
            amount_odt numeric(30,10) NOT NULL CHECK(amount_odt>0 AND amount_odt<1e20),
            description varchar(512) NOT NULL DEFAULT '',
            request_key uuid NOT NULL UNIQUE,
            id_income integer NOT NULL UNIQUE REFERENCES incomes(id_income),
            created_at timestamptz NOT NULL DEFAULT current_timestamp,
            CHECK(amount_odt=round(amount/exchange_rate,10)),
            CHECK(id_currency<>odt_currency OR exchange_rate=1)
        );
        CREATE INDEX odt_payments_odt ON odt_payments(id_odt,id_odt_payment);
        CREATE INDEX odt_payments_account ON odt_payments(id_account);
        CREATE TABLE closure_odt_allocations (
            id_closure_odt integer NOT NULL REFERENCES closure_odts(id_closure_odt),
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_entity integer NOT NULL REFERENCES entitys(id_entity),
            amount numeric(30,10) NOT NULL CHECK(amount>=0 AND amount<1e20),
            PRIMARY KEY(id_closure_odt,id_account,id_entity)
        );

        CREATE FUNCTION register_odt_payment(v_id_odt integer,v_id_account integer,v_id_user integer,
            v_amount numeric,v_exchange_rate numeric,v_description text,v_request_key uuid)
        RETURNS integer LANGUAGE plpgsql AS $body$
        DECLARE
            selected_odt odts%ROWTYPE;
            prior odt_payments%ROWTYPE;
            account_currency integer;
            converted numeric;
            already_paid numeric;
            income_id integer;
            payment_id integer;
        BEGIN
            SELECT * INTO selected_odt FROM odts WHERE id_odt=v_id_odt FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'La ODT no existe.' USING ERRCODE='P0002'; END IF;
            IF v_id_user IS NULL OR NOT (selected_odt.id_user=v_id_user OR selected_odt.id_user=1 OR v_id_user IN (1,11)) THEN
                RAISE EXCEPTION 'No tienes acceso a esta ODT.' USING ERRCODE='42501';
            END IF;
            SELECT * INTO prior FROM odt_payments WHERE request_key=v_request_key;
            IF FOUND THEN
                IF prior.id_odt=v_id_odt AND prior.id_account=v_id_account AND prior.id_user=v_id_user
                    AND prior.amount=v_amount AND prior.exchange_rate=v_exchange_rate AND prior.description=coalesce(v_description,'') THEN
                    RETURN prior.id_odt_payment;
                END IF;
                RAISE EXCEPTION 'La referencia de este abono ya se utilizó con otros datos.' USING ERRCODE='23505';
            END IF;
            IF EXISTS(SELECT 1 FROM closure_odts WHERE id_odt=v_id_odt) THEN
                RAISE EXCEPTION 'La ODT ya está cerrada. No se pueden agregar abonos.' USING ERRCODE='23505';
            END IF;
            SELECT id_currency INTO account_currency FROM accounts WHERE id_account=v_id_account FOR SHARE;
            IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta de destino no existe.' USING ERRCODE='P0002'; END IF;
            IF v_amount IS NULL OR v_amount::text IN ('NaN','Infinity','-Infinity') OR v_amount<=0 OR v_amount>=1e20 OR round(v_amount,10)<>v_amount THEN
                RAISE EXCEPTION 'El abono debe ser positivo y tener hasta 10 decimales.';
            END IF;
            IF v_exchange_rate IS NULL OR v_exchange_rate::text IN ('NaN','Infinity','-Infinity') OR v_exchange_rate<=0
                OR v_exchange_rate>=1e20 OR round(v_exchange_rate,10)<>v_exchange_rate THEN
                RAISE EXCEPTION 'La tasa debe ser positiva y tener hasta 10 decimales.';
            END IF;
            IF account_currency=selected_odt.id_currency AND v_exchange_rate<>1 THEN
                RAISE EXCEPTION 'La tasa debe ser 1 cuando la cuenta y la ODT tienen la misma moneda.';
            END IF;
            IF v_request_key IS NULL OR length(coalesce(v_description,''))>512 THEN
                RAISE EXCEPTION 'Revisa la referencia y la descripción del abono.';
            END IF;
            converted:=round(v_amount/v_exchange_rate,10);
            IF converted<=0 OR converted>=1e20 THEN RAISE EXCEPTION 'El equivalente del abono está fuera del rango permitido.'; END IF;
            SELECT coalesce(sum(amount_odt),0) INTO already_paid FROM odt_payments WHERE id_odt=v_id_odt;
            IF already_paid+converted>selected_odt.amount THEN
                RAISE EXCEPTION 'El abono supera el saldo pendiente de la ODT (%).', selected_odt.amount-already_paid;
            END IF;
            INSERT INTO incomes(id_user,id_account,id_entity,amount,description)
                VALUES(v_id_user,v_id_account,1,v_amount,'Abono ODT '||v_id_odt) RETURNING id_income INTO income_id;
            INSERT INTO odt_payments(id_odt,id_user,id_account,id_currency,odt_currency,amount,exchange_rate,amount_odt,description,request_key,id_income)
                VALUES(v_id_odt,v_id_user,v_id_account,account_currency,selected_odt.id_currency,v_amount,v_exchange_rate,converted,
                    coalesce(v_description,''),v_request_key,income_id) RETURNING id_odt_payment INTO payment_id;
            INSERT INTO balances(id_account,id_entity) VALUES(v_id_account,1) ON CONFLICT(id_account,id_entity) DO NOTHING;
            PERFORM alter_balance(id_balance,v_amount,income_id,'incomes') FROM balances WHERE id_account=v_id_account AND id_entity=1;
            IF (SELECT coalesce(sum(amount),0) FROM balance_movements WHERE type_movement_category='incomes' AND id_movement_category=income_id)<>v_amount THEN
                RAISE EXCEPTION 'El ingreso contable no coincide con el abono.';
            END IF;
            RETURN payment_id;
        END;
        $body$;

        -- Financial history is immutable; later changes must not reinterpret received money.
        CREATE FUNCTION protect_odt_payment_history() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            IF TG_TABLE_NAME='odt_payments' THEN
                RAISE EXCEPTION 'Los abonos registrados no se pueden modificar ni eliminar.';
            ELSIF TG_TABLE_NAME='accounts' THEN
                IF OLD.id_currency IS DISTINCT FROM NEW.id_currency AND EXISTS(SELECT 1 FROM odt_payments WHERE id_account=OLD.id_account) THEN
                    RAISE EXCEPTION 'No se puede cambiar la moneda de una cuenta con abonos registrados.';
                END IF;
            ELSIF TG_TABLE_NAME='odts' THEN
                IF EXISTS(SELECT 1 FROM odt_payments WHERE id_odt=OLD.id_odt) THEN
                    IF OLD.id_currency IS DISTINCT FROM NEW.id_currency THEN RAISE EXCEPTION 'No se puede cambiar la moneda de una ODT con abonos.'; END IF;
                    IF NEW.amount<(SELECT sum(amount_odt) FROM odt_payments WHERE id_odt=OLD.id_odt) THEN
                        RAISE EXCEPTION 'El monto de la ODT no puede ser menor que los abonos recibidos.';
                    END IF;
                    IF OLD.amount IS DISTINCT FROM NEW.amount AND EXISTS(SELECT 1 FROM closure_odts WHERE id_odt=OLD.id_odt) THEN
                        RAISE EXCEPTION 'No se puede cambiar el monto de una ODT cerrada con abonos.';
                    END IF;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER immutable_odt_payments BEFORE UPDATE OR DELETE ON odt_payments FOR EACH ROW EXECUTE FUNCTION protect_odt_payment_history();
        CREATE TRIGGER protect_payment_account_currency BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION protect_odt_payment_history();
        CREATE TRIGGER protect_paid_odt BEFORE UPDATE ON odts FOR EACH ROW EXECUTE FUNCTION protect_odt_payment_history();

        CREATE OR REPLACE FUNCTION get_odt_movement(v_id_movement_category integer,v_type_movement_category movement_category)
        RETURNS integer LANGUAGE plpgsql AS $body$
        DECLARE result integer;
        BEGIN
            CASE v_type_movement_category
                WHEN 'general_expenses' THEN SELECT id_odt INTO result FROM general_expenses WHERE id_general_expense=v_id_movement_category;
                WHEN 'spendable_inv_odt_expenses' THEN SELECT id_odt INTO result FROM spendable_inv_odt_expenses WHERE id_spendable_inv_odt_expense=v_id_movement_category;
                WHEN 'no_spendable_inv_odt_expenses' THEN SELECT id_odt INTO result FROM no_spendable_inv_odt_expenses WHERE id_no_spendable_inv_odt_expense=v_id_movement_category;
                WHEN 'incomes' THEN SELECT id_odt INTO result FROM odt_payments WHERE id_income=v_id_movement_category;
                WHEN 'closure_odts' THEN SELECT id_odt INTO result FROM closure_odts WHERE id_closure_odt=v_id_movement_category;
                ELSE RETURN 0;
            END CASE;
            RETURN coalesce(result,0);
        END;
        $body$;
        CREATE OR REPLACE FUNCTION closure_odt(
            v_id_account integer, v_id_odt integer, v_id_user integer, v_amount numeric,
            v_id_user_ceo integer, admin_users json, operative_users json, supervisor_users json,
            admin_expense_percent numeric, president_profit_percent numeric
        ) RETURNS text LANGUAGE plpgsql AS $body$
        DECLARE
            selected_odt odts%ROWTYPE;
            account_currency integer;
            paid_total numeric(30,10);
            payment_count integer;
            account_payment record;
            allocation record;
            recipients jsonb;
            cumulative_amount numeric;
            distributed_amount numeric;
            native_amount numeric;
            source_balance integer;
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
            SELECT count(*),coalesce(sum(amount_odt),0) INTO payment_count,paid_total
                FROM odt_payments WHERE id_odt=v_id_odt;
            IF v_id_account IS NULL THEN
                IF payment_count=0 THEN RAISE EXCEPTION 'Esta ODT todavía no tiene abonos registrados.'; END IF;
                IF paid_total <> selected_odt.amount THEN RAISE EXCEPTION 'La ODT debe estar completamente pagada antes de cerrarla.'; END IF;
                IF v_amount IS DISTINCT FROM paid_total THEN RAISE EXCEPTION 'El monto del cierre debe coincidir con los abonos registrados.'; END IF;
            ELSE
                IF payment_count>0 THEN RAISE EXCEPTION 'Esta ODT tiene abonos. Ciérrala con sus abonos registrados para evitar duplicar ingresos.'; END IF;
                SELECT id_currency INTO account_currency FROM accounts WHERE id_account = v_id_account FOR SHARE;
                IF NOT FOUND THEN RAISE EXCEPTION 'La cuenta de destino no existe.' USING ERRCODE = 'P0002'; END IF;
                IF account_currency <> selected_odt.id_currency THEN
                    RAISE EXCEPTION 'La cuenta de destino debe tener la misma moneda que la ODT.';
                END IF;
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

            INSERT INTO closure_odts(id_user,id_odt,id_account,amount,admin_expense_percent,general_expense,inv_expense,gross_profit,settled_from_payments)
                VALUES(v_id_user,v_id_odt,v_id_account,v_amount,admin_expense_percent,general_total,inventory_total,gross,v_id_account IS NULL)
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

            IF v_id_account IS NOT NULL THEN
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
            ELSE
                SELECT jsonb_agg(to_jsonb(r) ORDER BY id_entity) INTO recipients FROM (
                    SELECT id_entity,sum(amount) AS amount FROM (
                        SELECT 1 AS id_entity,company_amount AS amount
                        UNION ALL SELECT 2,administrative_amount
                        UNION ALL SELECT u.id_entity,c.profit FROM admin_closure_odts c JOIN users u ON u.user_id=c.id_user WHERE c.id_closure_odt=closure_id
                        UNION ALL SELECT u.id_entity,c.profit FROM operative_closure_odts c JOIN users u ON u.user_id=c.id_user WHERE c.id_closure_odt=closure_id
                        UNION ALL SELECT u.id_entity,c.profit FROM supervisor_closure_odts c JOIN users u ON u.user_id=c.id_user WHERE c.id_closure_odt=closure_id
                        UNION ALL SELECT ceo_entity,profit FROM ceo_closure_odts WHERE id_closure_odt=closure_id
                    ) shares GROUP BY id_entity
                ) r;
                FOR account_payment IN
                    SELECT id_account,sum(amount) AS amount FROM odt_payments
                    WHERE id_odt=v_id_odt GROUP BY id_account ORDER BY id_account
                LOOP
                    cumulative_amount:=0;
                    distributed_amount:=0;
                    -- Cumulative rounding preserves even the smallest native currency unit.
                    FOR recipient IN SELECT * FROM jsonb_to_recordset(recipients) AS r(id_entity integer,amount numeric)
                        WHERE id_entity<>1 ORDER BY id_entity
                    LOOP
                        cumulative_amount:=cumulative_amount+recipient.amount;
                        native_amount:=round(account_payment.amount*cumulative_amount/v_amount,10)-distributed_amount;
                        distributed_amount:=distributed_amount+native_amount;
                        INSERT INTO closure_odt_allocations(id_closure_odt,id_account,id_entity,amount)
                            VALUES(closure_id,account_payment.id_account,recipient.id_entity,native_amount);
                    END LOOP;
                    INSERT INTO closure_odt_allocations(id_closure_odt,id_account,id_entity,amount)
                        VALUES(closure_id,account_payment.id_account,1,account_payment.amount-distributed_amount);
                    FOR allocation IN SELECT * FROM closure_odt_allocations WHERE id_closure_odt=closure_id
                        AND id_account=account_payment.id_account ORDER BY id_entity
                    LOOP
                        INSERT INTO balances(id_account,id_entity) VALUES(allocation.id_account,allocation.id_entity)
                            ON CONFLICT(id_account,id_entity) DO NOTHING;
                        PERFORM 1 FROM balances WHERE id_account=allocation.id_account AND id_entity=allocation.id_entity FOR UPDATE;
                    END LOOP;
                    SELECT id_balance INTO source_balance FROM balances
                        WHERE id_account=account_payment.id_account AND id_entity=1 AND balance>=distributed_amount;
                    IF NOT FOUND THEN
                        RAISE EXCEPTION 'Saldo de Taionca insuficiente para repartir administración y comisiones en la cuenta %. Repón el saldo antes de cerrar.', account_payment.id_account;
                    END IF;
                    IF distributed_amount>0 THEN
                        PERFORM alter_balance(source_balance,-distributed_amount,closure_id,'closure_odts');
                    END IF;
                    FOR allocation IN SELECT * FROM closure_odt_allocations WHERE id_closure_odt=closure_id
                        AND id_account=account_payment.id_account AND id_entity<>1 AND amount>0 ORDER BY id_entity
                    LOOP
                        PERFORM alter_balance(id_balance,allocation.amount,closure_id,'closure_odts')
                            FROM balances WHERE id_account=allocation.id_account AND id_entity=allocation.id_entity;
                    END LOOP;
                    SELECT coalesce(sum(m.amount),0) INTO movement_total FROM balance_movements m JOIN balances b USING(id_balance)
                        WHERE m.type_movement_category='closure_odts' AND m.id_movement_category=closure_id
                        AND b.id_account=account_payment.id_account;
                    IF movement_total<>0 THEN RAISE EXCEPTION 'El reparto del cierre no conserva el saldo de la cuenta.'; END IF;
                END LOOP;
            END IF;
            RETURN 'success';
        END;
        $body$;

    `);
};

exports.down = pgm => {
    // Never discard received payments or their immutable conversion history.
    pgm.sql(`DO $body$ BEGIN
        IF EXISTS(SELECT 1 FROM odt_payments) THEN RAISE EXCEPTION 'No se puede revertir la migración: existen abonos registrados.'; END IF;
    END $body$;
    DROP TRIGGER protect_paid_odt ON odts;
    DROP TRIGGER protect_payment_account_currency ON accounts;
    DROP TABLE closure_odt_allocations;
    DROP TABLE odt_payments;
    DROP FUNCTION protect_odt_payment_history();
    DROP FUNCTION register_odt_payment(integer,integer,integer,numeric,numeric,text,uuid);
    ALTER TABLE closure_odts DROP COLUMN settled_from_payments;
    ALTER TABLE closure_odts ALTER COLUMN id_account SET NOT NULL;`);
    require('./1790632800000_safe-odt-closure').up(pgm);
    require('./1618249703424_sql-functions-odt-movements').up({ sql: strings => {
        pgm.sql(strings.join('').replace('CREATE FUNCTION get_odt_movement','CREATE OR REPLACE FUNCTION get_odt_movement'));
    }});
};
