exports.up = pgm => {
    pgm.sql(`
    ALTER TABLE odt_payments ALTER COLUMN exchange_rate DROP NOT NULL;
    ALTER TABLE closure_odts ADD COLUMN settlement_mode text NOT NULL DEFAULT 'legacy'
        CHECK(settlement_mode IN ('legacy','single','split'));
    ALTER TABLE closure_odts ALTER COLUMN admin_expense_percent DROP NOT NULL;
    CREATE TABLE closure_odt_parts(
        id_part serial PRIMARY KEY,
        id_closure_odt integer NOT NULL REFERENCES closure_odts(id_closure_odt),
        id_currency integer NOT NULL REFERENCES currencys(id_currency),
        amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
        admin_percent numeric(6,5) NOT NULL CHECK(admin_percent BETWEEN 0 AND 1),
        admin_amount numeric(30,10) NOT NULL CHECK(admin_amount>=0),
        general_expense numeric(30,10) NOT NULL CHECK(general_expense>=0),
        inv_expense numeric(30,10) NOT NULL CHECK(inv_expense>=0),
        gross_profit numeric(30,10) NOT NULL CHECK(gross_profit>=0),
        taionca_profit numeric(30,10) NOT NULL CHECK(taionca_profit>=0),
        UNIQUE(id_closure_odt,id_currency)
    );
    CREATE TABLE closure_odt_part_commissions(
        id_part integer NOT NULL REFERENCES closure_odt_parts(id_part),
        id_user integer NOT NULL REFERENCES users(user_id),
        id_entity integer NOT NULL REFERENCES entitys(id_entity),
        role text NOT NULL CHECK(role IN ('ceo','admin','operative','supervisor')),
        profit_percent numeric(6,5) NOT NULL CHECK(profit_percent BETWEEN 0 AND 1),
        profit numeric(30,10) NOT NULL CHECK(profit>=0),
        PRIMARY KEY(id_part,role,id_user)
    );
    CREATE TABLE closure_odt_expenses(
        id_closure_odt integer NOT NULL REFERENCES closure_odts(id_closure_odt),
        expense_key text NOT NULL,
        category text NOT NULL,
        source_currency integer REFERENCES currencys(id_currency),
        source_amount numeric(30,10),
        id_currency integer NOT NULL REFERENCES currencys(id_currency),
        amount numeric(30,10) NOT NULL CHECK(amount>=0 AND amount<1e20),
        description text NOT NULL,
        PRIMARY KEY(id_closure_odt,expense_key)
    );
    CREATE TABLE closure_odt_revenues(
        id_closure_odt integer NOT NULL REFERENCES closure_odts(id_closure_odt),
        source_currency integer NOT NULL REFERENCES currencys(id_currency),
        source_amount numeric(30,10) NOT NULL CHECK(source_amount>0),
        id_currency integer NOT NULL REFERENCES currencys(id_currency),
        amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
        valuation_source text NOT NULL CHECK(valuation_source IN ('native','payment_equivalent','manual')),
        PRIMARY KEY(id_closure_odt,source_currency)
    );
    CREATE TABLE closure_odt_exchanges(
        id_closure_odt integer NOT NULL REFERENCES closure_odts(id_closure_odt),
        id_exchange_currency integer NOT NULL REFERENCES exchange_currencys(id_exchange_currency),
        account_from integer NOT NULL REFERENCES accounts(id_account),
        account_to integer NOT NULL REFERENCES accounts(id_account),
        amount_from numeric(30,10) NOT NULL CHECK(amount_from>0 AND amount_from<1e20),
        amount_to numeric(30,10) NOT NULL CHECK(amount_to>0 AND amount_to<1e20),
        PRIMARY KEY(id_closure_odt,id_exchange_currency)
    );

    CREATE OR REPLACE FUNCTION protect_odt_payment_history() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            IF TG_TABLE_NAME='odt_payments' THEN
                RAISE EXCEPTION 'Los abonos registrados no se pueden modificar ni eliminar.';
            ELSIF TG_TABLE_NAME='accounts' THEN
                IF OLD.id_currency IS DISTINCT FROM NEW.id_currency AND (EXISTS(SELECT 1 FROM odt_payments WHERE id_account=OLD.id_account)
                    OR EXISTS(SELECT 1 FROM closure_odt_allocations WHERE id_account=OLD.id_account)
                    OR EXISTS(SELECT 1 FROM closure_odt_exchanges WHERE account_from=OLD.id_account OR account_to=OLD.id_account)) THEN
                    RAISE EXCEPTION 'No se puede cambiar la moneda de una cuenta con abonos o repartos registrados.';
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

    -- Inventory uses the actual original ledger currency and cost, never a current item price or an FX rate.
    CREATE FUNCTION odt_expense_sources(v_id_odt integer)
    RETURNS TABLE(expense_key text,category text,source_currency integer,source_amount numeric,description text)
    LANGUAGE sql STABLE AS $body$
        SELECT 'general:'||e.id_general_expense,'general',a.id_currency,e.amount,e.description::text
        FROM general_expenses e JOIN accounts a USING(id_account) WHERE e.id_odt=v_id_odt
        UNION ALL
        SELECT 'spendable:'||e.id_spendable_inv_odt_expense||':'||coalesce(c.id_currency::text,'unknown'),
            'inventory',c.id_currency,c.amount,e.description::text
        FROM spendable_inv_odt_expenses e LEFT JOIN LATERAL (
            SELECT a.id_currency,-sum(m.amount) AS amount FROM balance_movements m JOIN balances b USING(id_balance)
            JOIN accounts a USING(id_account) WHERE m.type_movement_category='spendable_inv_odt_expenses'
                AND m.id_movement_category=e.id_spendable_inv_odt_expense AND b.id_entity=1 GROUP BY a.id_currency
        ) c ON true WHERE e.id_odt=v_id_odt
        UNION ALL
        SELECT 'no_spendable:'||e.id_no_spendable_inv_odt_expense||':'||coalesce(c.id_currency::text,'unknown'),
            'inventory',c.id_currency,c.amount,e.description::text
        FROM no_spendable_inv_odt_expenses e LEFT JOIN LATERAL (
            SELECT a.id_currency,-sum(m.amount) AS amount FROM balance_movements m JOIN balances b USING(id_balance)
            JOIN accounts a USING(id_account) WHERE m.type_movement_category='no_spendable_inv_odt_expenses'
                AND m.id_movement_category=e.id_no_spendable_inv_odt_expense AND b.id_entity=1 GROUP BY a.id_currency
        ) c ON true WHERE e.id_odt=v_id_odt;
    $body$;

    -- Expenses share the ODT lock with payments and closure, including edits to existing expenses.
    CREATE FUNCTION guard_odt_expense_write() RETURNS trigger LANGUAGE plpgsql AS $body$
    DECLARE oid integer;
    BEGIN
        FOR oid IN SELECT DISTINCT x FROM unnest(ARRAY[
            CASE WHEN TG_OP<>'INSERT' THEN OLD.id_odt ELSE NULL END,
            CASE WHEN TG_OP<>'DELETE' THEN NEW.id_odt ELSE NULL END]) x WHERE x IS NOT NULL ORDER BY x
        LOOP
            PERFORM 1 FROM odts WHERE id_odt=oid FOR UPDATE;
            IF EXISTS(SELECT 1 FROM closure_odts WHERE id_odt=oid) THEN
                RAISE EXCEPTION 'No se pueden cambiar los gastos de una ODT cerrada.';
            END IF;
        END LOOP;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END;
    $body$;
    CREATE TRIGGER guard_general_odt_expense BEFORE INSERT OR UPDATE OR DELETE ON general_expenses FOR EACH ROW EXECUTE FUNCTION guard_odt_expense_write();
    CREATE TRIGGER guard_spendable_odt_expense BEFORE INSERT OR UPDATE OR DELETE ON spendable_inv_odt_expenses FOR EACH ROW EXECUTE FUNCTION guard_odt_expense_write();
    CREATE TRIGGER guard_no_spendable_odt_expense BEFORE INSERT OR UPDATE OR DELETE ON no_spendable_inv_odt_expenses FOR EACH ROW EXECUTE FUNCTION guard_odt_expense_write();

    CREATE TRIGGER guard_payroll_odt_hours BEFORE INSERT OR UPDATE OR DELETE ON payroll_odt_hours FOR EACH ROW EXECUTE FUNCTION guard_odt_expense_write();
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
            WHEN 'exchange_currency' THEN SELECT c.id_odt INTO result FROM closure_odt_exchanges e JOIN closure_odts c USING(id_closure_odt) WHERE e.id_exchange_currency=v_id_movement_category;
            ELSE RETURN 0;
        END CASE;
        RETURN coalesce(result,0);
    END;
    $body$;
    ALTER FUNCTION closure_odt(integer,integer,integer,numeric,integer,json,json,json,numeric,numeric) RENAME TO closure_odt_legacy;
    CREATE FUNCTION closure_odt(v_id_account integer,v_id_odt integer,v_id_user integer,v_amount numeric,
        v_id_user_ceo integer,admin_users json,operative_users json,supervisor_users json,
        admin_expense_percent numeric,president_profit_percent numeric) RETURNS text LANGUAGE plpgsql AS $body$
    BEGIN
        PERFORM 1 FROM odts WHERE id_odt=v_id_odt FOR UPDATE;
        IF EXISTS(SELECT 1 FROM odt_payments WHERE id_odt=v_id_odt AND exchange_rate IS NULL) THEN
            RAISE EXCEPTION 'Selecciona la modalidad y revisa los importes manuales del cierre por moneda.';
        END IF;
        RETURN closure_odt_legacy(v_id_account,v_id_odt,v_id_user,v_amount,v_id_user_ceo,admin_users,
            operative_users,supervisor_users,admin_expense_percent,president_profit_percent);
    END;
    $body$;
        CREATE FUNCTION register_odt_payment_amount(v_id_odt integer,v_id_account integer,v_id_user integer,
            v_amount numeric,v_amount_odt numeric,v_description text,v_request_key uuid)
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
                    AND prior.amount=v_amount AND prior.exchange_rate IS NULL AND prior.amount_odt=v_amount_odt AND prior.description=coalesce(v_description,'') THEN
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
            IF v_amount_odt IS NULL OR v_amount_odt::text IN ('NaN','Infinity','-Infinity') OR v_amount_odt<=0
                OR v_amount_odt>=1e20 OR round(v_amount_odt,10)<>v_amount_odt THEN
                RAISE EXCEPTION 'El equivalente en la moneda de la ODT debe ser positivo y tener hasta 10 decimales.';
            END IF;
            IF account_currency=selected_odt.id_currency AND v_amount_odt<>v_amount THEN
                RAISE EXCEPTION 'En la misma moneda el abono y su equivalente deben coincidir.';
            END IF;
            IF v_request_key IS NULL OR length(coalesce(v_description,''))>512 THEN
                RAISE EXCEPTION 'Revisa la referencia y la descripción del abono.';
            END IF;
            converted:=v_amount_odt;
            IF converted<=0 OR converted>=1e20 THEN RAISE EXCEPTION 'El equivalente del abono está fuera del rango permitido.'; END IF;
            SELECT coalesce(sum(amount_odt),0) INTO already_paid FROM odt_payments WHERE id_odt=v_id_odt;
            IF already_paid+converted>selected_odt.amount THEN
                RAISE EXCEPTION 'El abono supera el saldo pendiente de la ODT (%).', selected_odt.amount-already_paid;
            END IF;
            INSERT INTO incomes(id_user,id_account,id_entity,amount,description)
                VALUES(v_id_user,v_id_account,1,v_amount,'Abono ODT '||v_id_odt) RETURNING id_income INTO income_id;
            INSERT INTO odt_payments(id_odt,id_user,id_account,id_currency,odt_currency,amount,exchange_rate,amount_odt,description,request_key,id_income)
                VALUES(v_id_odt,v_id_user,v_id_account,account_currency,selected_odt.id_currency,v_amount,NULL,converted,
                    coalesce(v_description,''),v_request_key,income_id) RETURNING id_odt_payment INTO payment_id;
            INSERT INTO balances(id_account,id_entity) VALUES(v_id_account,1) ON CONFLICT(id_account,id_entity) DO NOTHING;
            PERFORM alter_balance(id_balance,v_amount,income_id,'incomes') FROM balances WHERE id_account=v_id_account AND id_entity=1;
            IF (SELECT coalesce(sum(amount),0) FROM balance_movements WHERE type_movement_category='incomes' AND id_movement_category=income_id)<>v_amount THEN
                RAISE EXCEPTION 'El ingreso contable no coincide con el abono.';
            END IF;
            RETURN payment_id;
        END;
        $body$;

    `);
};

exports.down = pgm => {
    pgm.sql(`DO $body$ BEGIN
        IF EXISTS(SELECT 1 FROM closure_odts WHERE settlement_mode<>'legacy') OR EXISTS(SELECT 1 FROM odt_payments WHERE exchange_rate IS NULL) THEN
            RAISE EXCEPTION 'No se puede revertir: existen abonos manuales o cierres por moneda.';
        END IF;
    END $body$;
    DROP FUNCTION closure_odt(integer,integer,integer,numeric,integer,json,json,json,numeric,numeric);
    ALTER FUNCTION closure_odt_legacy(integer,integer,integer,numeric,integer,json,json,json,numeric,numeric) RENAME TO closure_odt;
    DROP TRIGGER guard_general_odt_expense ON general_expenses;
    DROP TRIGGER guard_spendable_odt_expense ON spendable_inv_odt_expenses;
    DROP TRIGGER guard_no_spendable_odt_expense ON no_spendable_inv_odt_expenses;
    DROP TRIGGER guard_payroll_odt_hours ON payroll_odt_hours;
    DROP FUNCTION guard_odt_expense_write();
    DROP FUNCTION odt_expense_sources(integer);
    DROP FUNCTION register_odt_payment_amount(integer,integer,integer,numeric,numeric,text,uuid);
    DROP TABLE closure_odt_part_commissions,closure_odt_expenses,closure_odt_revenues,closure_odt_exchanges;
    DROP TABLE closure_odt_parts;
    ALTER TABLE closure_odts DROP COLUMN settlement_mode;
    ALTER TABLE closure_odts ALTER COLUMN admin_expense_percent SET NOT NULL;
    ALTER TABLE odt_payments ALTER COLUMN exchange_rate SET NOT NULL;`);
    require('./1790690000000_odt-payments').up({sql: sql => {
        pgm.sql(sql.match(/CREATE OR REPLACE FUNCTION get_odt_movement[\s\S]*?\$body\$;/)[0]);
        pgm.sql(sql.match(/CREATE FUNCTION protect_odt_payment_history[\s\S]*?\$body\$;/)[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
    }});
};
