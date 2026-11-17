exports.up = pgm => {
    pgm.sql`
        ALTER TYPE movement_category ADD VALUE IF NOT EXISTS 'company_savings_brought_forward';
        CREATE TABLE account_opening_adjustments (
            id_account_opening_adjustment serial PRIMARY KEY,
            id_account_opening integer NOT NULL REFERENCES account_openings(id_account_opening),
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_entity integer NOT NULL REFERENCES entitys(id_entity) CHECK(id_entity=1),
            id_currency integer NOT NULL REFERENCES currencys(id_currency),
            kind text NOT NULL CHECK(kind='company_savings_brought_forward'),
            amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
            source_key text NOT NULL UNIQUE CHECK(length(trim(source_key))>0),
            source_json jsonb NOT NULL CHECK(jsonb_typeof(source_json)='object' AND source_json ? 'source_key' AND source_json->>'source_key'=source_key),
            request_key uuid NOT NULL UNIQUE,
            id_user integer NOT NULL REFERENCES users(user_id) CHECK(id_user=1),
            balance_before numeric(30,10) NOT NULL CHECK(balance_before>=0),
            balance_after numeric(30,10) NOT NULL CHECK(balance_after=balance_before+amount),
            id_balance integer NOT NULL REFERENCES balances(id_balance),
            id_balance_movement integer NOT NULL UNIQUE REFERENCES balance_movements(id_balance_movement),
            id_balance_register integer NOT NULL UNIQUE REFERENCES balance_registers(id_balance_register),
            actual_event_date timestamptz CHECK(actual_event_date IS NULL),
            created_at timestamptz NOT NULL DEFAULT current_timestamp,
            UNIQUE(id_account_opening,kind)
        );
        CREATE FUNCTION protect_account_opening_adjustment() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN RAISE EXCEPTION 'El ajuste historico de ahorro empresarial es inmutable.'; END;$body$;
        CREATE TRIGGER immutable_account_opening_adjustments BEFORE UPDATE OR DELETE OR TRUNCATE ON account_opening_adjustments
            FOR EACH STATEMENT EXECUTE FUNCTION protect_account_opening_adjustment();
        CREATE FUNCTION protect_adjusted_original_opening() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            IF EXISTS(SELECT 1 FROM account_opening_adjustments WHERE id_account_opening=OLD.id_account_opening) THEN
                RAISE EXCEPTION 'La apertura original vinculada al ahorro historico se conserva inmutable.';
            END IF;
            RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
        END;$body$;
        CREATE TRIGGER immutable_adjusted_original_opening BEFORE UPDATE OR DELETE ON account_openings
            FOR EACH ROW EXECUTE FUNCTION protect_adjusted_original_opening();
        CREATE FUNCTION guard_account_opening_adjustment() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE opening account_openings%ROWTYPE; movement balance_movements%ROWTYPE; registered balance_registers%ROWTYPE; balance_row balances%ROWTYPE;
        BEGIN
            SELECT * INTO opening FROM account_openings WHERE id_account_opening=NEW.id_account_opening FOR SHARE;
            IF NOT FOUND OR opening.id_account<>NEW.id_account OR opening.id_entity<>1 OR opening.amount<>0
                OR opening.balance_before<>0 OR opening.balance_after<>0 OR opening.id_balance_movement IS NOT NULL THEN
                RAISE EXCEPTION 'El ajuste conserva una apertura empresarial previa de cero.';
            END IF;
            SELECT * INTO balance_row FROM balances WHERE id_balance=NEW.id_balance;
            SELECT * INTO movement FROM balance_movements WHERE id_balance_movement=NEW.id_balance_movement;
            SELECT * INTO registered FROM balance_registers WHERE id_balance_register=NEW.id_balance_register;
            IF balance_row.id_account IS DISTINCT FROM NEW.id_account OR balance_row.id_entity IS DISTINCT FROM 1
                OR (SELECT id_currency FROM accounts WHERE id_account=NEW.id_account) IS DISTINCT FROM NEW.id_currency
                OR movement.id_balance IS DISTINCT FROM NEW.id_balance OR movement.amount IS DISTINCT FROM NEW.amount
                OR movement.end_balance IS DISTINCT FROM NEW.balance_after OR movement.id_movement_category IS DISTINCT FROM NEW.id_account_opening_adjustment
                OR movement.type_movement_category::text IS DISTINCT FROM 'company_savings_brought_forward'
                OR registered.id_balance IS DISTINCT FROM NEW.id_balance OR registered.balance IS DISTINCT FROM NEW.balance_after THEN
                RAISE EXCEPTION 'El ajuste debe enlazar un unico credito patrimonial nativo y su registro.';
            END IF;
            RETURN NEW;
        END;$body$;
        CREATE TRIGGER guard_account_opening_adjustments BEFORE INSERT ON account_opening_adjustments
            FOR EACH ROW EXECUTE FUNCTION guard_account_opening_adjustment();
        CREATE FUNCTION record_company_savings_brought_forward(v_opening integer,v_amount numeric,v_source_key text,v_source jsonb,v_request uuid)
        RETURNS integer LANGUAGE plpgsql AS $body$
        DECLARE prior account_opening_adjustments%ROWTYPE; opening account_openings%ROWTYPE; balance_row balances%ROWTYPE;
            movement balance_movements%ROWTYPE; adjustment_id integer; registered_id integer; last_register integer; currency_id integer;
        BEGIN
            IF v_request IS NULL OR v_amount IS NULL OR v_amount<=0 OR v_amount>=1e20 OR round(v_amount,10)<>v_amount OR length(trim(coalesce(v_source_key,'')))=0
                OR jsonb_typeof(v_source) IS DISTINCT FROM 'object' OR v_source->>'source_key' IS DISTINCT FROM v_source_key THEN
                RAISE EXCEPTION 'Monto y evidencia exacta del ahorro empresarial son obligatorios.';
            END IF;
            SELECT * INTO opening FROM account_openings WHERE id_account_opening=v_opening FOR UPDATE;
            IF NOT FOUND OR opening.id_entity<>1 OR opening.amount<>0 OR opening.balance_before<>0 OR opening.balance_after<>0 OR opening.id_balance_movement IS NOT NULL THEN
                RAISE EXCEPTION 'No se reemplaza ni duplica la apertura original; se exige apertura empresarial previa cero.';
            END IF;
            SELECT * INTO prior FROM account_opening_adjustments WHERE request_key=v_request;
            IF FOUND THEN
                IF prior.id_account_opening<>v_opening OR prior.amount<>v_amount OR prior.source_key<>v_source_key OR prior.source_json<>v_source THEN
                    RAISE EXCEPTION 'La solicitud de ahorro ya existe con otra evidencia.';
                END IF;
                RETURN prior.id_account_opening_adjustment;
            END IF;
            IF EXISTS(SELECT 1 FROM account_opening_adjustments WHERE source_key=v_source_key OR id_account_opening=v_opening) THEN
                RAISE EXCEPTION 'La fuente de ahorro ya fue registrada.';
            END IF;
            SELECT * INTO balance_row FROM balances WHERE id_account=opening.id_account AND id_entity=1 FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'Falta el saldo empresarial de la cuenta original.'; END IF;
            SELECT id_currency INTO currency_id FROM accounts WHERE id_account=opening.id_account FOR SHARE;
            SELECT coalesce(max(id_balance_register),0) INTO last_register FROM balance_registers WHERE id_balance=balance_row.id_balance;
            adjustment_id:=nextval('account_opening_adjustments_id_account_opening_adjustment_seq');
            SELECT * INTO movement FROM alter_balance(balance_row.id_balance,v_amount,adjustment_id,'company_savings_brought_forward');
            SELECT id_balance_register INTO STRICT registered_id FROM balance_registers WHERE id_balance=balance_row.id_balance AND id_balance_register>last_register;
            INSERT INTO account_opening_adjustments(id_account_opening_adjustment,id_account_opening,id_account,id_entity,id_currency,kind,amount,source_key,source_json,
                request_key,id_user,balance_before,balance_after,id_balance,id_balance_movement,id_balance_register,actual_event_date)
            VALUES(adjustment_id,v_opening,opening.id_account,1,currency_id,'company_savings_brought_forward',v_amount,v_source_key,v_source,v_request,1,
                balance_row.balance,balance_row.balance+v_amount,balance_row.id_balance,movement.id_balance_movement,registered_id,NULL);
            RETURN adjustment_id;
        END;$body$;
    `;
};
exports.down = pgm => {
    pgm.sql`
        DO $body$ BEGIN IF EXISTS(SELECT 1 FROM account_opening_adjustments) THEN RAISE EXCEPTION 'No se retira un ahorro patrimonial ya registrado.'; END IF; END;$body$;
        DROP FUNCTION record_company_savings_brought_forward(integer,numeric,text,jsonb,uuid);
        DROP TRIGGER immutable_adjusted_original_opening ON account_openings;
        DROP TABLE account_opening_adjustments;
        DROP FUNCTION guard_account_opening_adjustment();
        DROP FUNCTION protect_account_opening_adjustment();
        DROP FUNCTION protect_adjusted_original_opening();
    `;
};
