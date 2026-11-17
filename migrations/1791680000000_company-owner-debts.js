exports.up = pgm => {
    pgm.sql`
        ALTER TYPE movement_category ADD VALUE IF NOT EXISTS 'company_debts';

        CREATE TABLE company_debts (
            id_company_debt serial PRIMARY KEY,
            id_owner_user integer NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE,
            id_account integer NOT NULL REFERENCES accounts(id_account) ON UPDATE CASCADE,
            id_currency integer NOT NULL REFERENCES currencys(id_currency) ON UPDATE CASCADE,
            amount numeric(30,10) NOT NULL DEFAULT 0 CHECK(amount>=0 AND amount<1e20),
            created_at timestamptz NOT NULL DEFAULT current_timestamp,
            updated_at timestamptz NOT NULL DEFAULT current_timestamp,
            UNIQUE(id_owner_user,id_account)
        );

        CREATE TABLE company_debt_movements (
            id_company_debt_movement serial PRIMARY KEY,
            id_company_debt integer NOT NULL REFERENCES company_debts(id_company_debt),
            kind text NOT NULL CHECK(kind IN ('advance','repayment')),
            amount numeric(30,10) NOT NULL CHECK(amount<>0 AND abs(amount)<1e20),
            debt_after numeric(30,10) NOT NULL CHECK(debt_after>=0 AND debt_after<1e20),
            mode text NOT NULL CHECK(mode IN ('credit_cash','debit_cash','recognize_only')),
            cash_delta numeric(30,10) NOT NULL,
            description varchar(512) NOT NULL,
            source_key varchar(240) NOT NULL UNIQUE CHECK(length(trim(source_key))>0),
            occurred_at timestamptz,
            id_balance_movement integer REFERENCES balance_movements(id_balance_movement),
            created_at timestamptz NOT NULL DEFAULT current_timestamp,
            CHECK((kind='advance' AND amount>0 AND mode IN ('credit_cash','recognize_only'))
               OR (kind='repayment' AND amount<0 AND mode IN ('debit_cash','recognize_only'))),
            CHECK(cash_delta=CASE WHEN mode='recognize_only' THEN 0 ELSE amount END)
        );

        CREATE FUNCTION _register_company_debt_event(
            v_owner_user integer, v_account integer, v_amount numeric,
            v_description text, v_source_key text, v_occurred_at timestamptz,
            v_kind text, v_mode text, v_expected_currency integer
        ) RETURNS company_debt_movements LANGUAGE plpgsql AS $body$
        DECLARE
            account_currency integer;
            selected_debt company_debts;
            previous_event company_debt_movements;
            result_event company_debt_movements;
            selected_balance balances;
            signed_amount numeric(30,10);
            next_debt numeric(30,10);
            cash_change numeric(30,10);
            cash_movement balance_movements;
        BEGIN
            IF v_owner_user IS NULL OR v_owner_user<=0 OR v_account IS NULL OR v_account<=0 THEN
                RAISE EXCEPTION 'Seleccione el propietario y la cuenta.';
            END IF;
            IF v_amount IS NULL OR NOT (v_amount>0 AND v_amount<1e20)
                OR v_amount<>round(v_amount,10) THEN
                RAISE EXCEPTION 'El importe debe ser positivo y admitir hasta diez decimales.';
            END IF;
            IF v_description IS NULL OR length(trim(v_description))=0 OR length(v_description)>512
                OR v_source_key IS NULL OR length(trim(v_source_key))=0 OR length(v_source_key)>240 THEN
                RAISE EXCEPTION 'Indique una descripcion y una referencia de origen validas.';
            END IF;
            IF v_kind IS NULL OR v_kind NOT IN ('advance','repayment') OR v_mode IS NULL
                OR (v_kind='advance' AND v_mode NOT IN ('credit_cash','recognize_only'))
                OR (v_kind='repayment' AND v_mode NOT IN ('debit_cash','recognize_only')) THEN
                RAISE EXCEPTION 'El modo no corresponde al adelanto o la devolucion.';
            END IF;
            signed_amount:=CASE WHEN v_kind='advance' THEN v_amount ELSE -v_amount END;
            cash_change:=CASE WHEN v_mode='recognize_only' THEN 0 ELSE signed_amount END;

            -- Serialize repeated source keys before touching money or liability rows.
            PERFORM pg_advisory_xact_lock(1791680,hashtext(v_source_key));
            SELECT a.id_currency INTO account_currency FROM accounts a
                WHERE a.id_account=v_account FOR UPDATE;
            IF NOT FOUND OR account_currency IS NULL THEN
                RAISE EXCEPTION 'Cuenta no encontrada.';
            END IF;
            IF v_expected_currency IS NOT NULL AND v_expected_currency<>account_currency THEN
                RAISE EXCEPTION 'La moneda del importe no corresponde a la cuenta.';
            END IF;
            IF NOT EXISTS(SELECT 1 FROM users WHERE user_id=v_owner_user) THEN
                RAISE EXCEPTION 'Propietario no encontrado.';
            END IF;
            SELECT m.* INTO previous_event FROM company_debt_movements m
                WHERE m.source_key=v_source_key;
            IF FOUND THEN
                SELECT d.* INTO selected_debt FROM company_debts d
                    WHERE d.id_company_debt=previous_event.id_company_debt;
                IF selected_debt.id_owner_user<>v_owner_user OR selected_debt.id_account<>v_account
                    OR selected_debt.id_currency<>account_currency OR previous_event.kind<>v_kind
                    OR previous_event.mode<>v_mode OR previous_event.amount<>signed_amount
                    OR previous_event.description IS DISTINCT FROM v_description
                    OR previous_event.occurred_at IS DISTINCT FROM v_occurred_at THEN
                    RAISE EXCEPTION 'La referencia de origen ya existe con otros datos.';
                END IF;
                RETURN previous_event;
            END IF;

            INSERT INTO balances(id_account,id_entity) VALUES(v_account,1)
                ON CONFLICT(id_account,id_entity) DO NOTHING;
            SELECT b.* INTO STRICT selected_balance FROM balances b
                WHERE b.id_account=v_account AND b.id_entity=1 FOR UPDATE;
            IF v_kind='advance' THEN
                INSERT INTO company_debts(id_owner_user,id_account,id_currency)
                    VALUES(v_owner_user,v_account,account_currency)
                    ON CONFLICT(id_owner_user,id_account) DO NOTHING;
            END IF;
            SELECT d.* INTO selected_debt FROM company_debts d
                WHERE d.id_owner_user=v_owner_user AND d.id_account=v_account FOR UPDATE;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'Taionca no tiene una deuda con ese propietario en esta cuenta.';
            END IF;
            IF selected_debt.id_currency<>account_currency THEN
                RAISE EXCEPTION 'La moneda de la deuda no corresponde a la cuenta.';
            END IF;
            IF v_kind='repayment' AND selected_debt.amount<v_amount THEN
                RAISE EXCEPTION 'La devolucion supera la deuda de Taionca.';
            END IF;
            IF selected_balance.balance+cash_change<0 THEN
                RAISE EXCEPTION 'Saldo de Taionca insuficiente para devolver el adelanto.';
            END IF;
            next_debt:=selected_debt.amount+signed_amount;
            IF next_debt>=1e20 OR selected_balance.balance+cash_change>=1e20 THEN
                RAISE EXCEPTION 'La operacion supera el limite de importes.';
            END IF;
            UPDATE company_debts SET amount=next_debt,updated_at=current_timestamp
                WHERE id_company_debt=selected_debt.id_company_debt;
            INSERT INTO company_debt_movements(id_company_debt,kind,amount,debt_after,mode,
                cash_delta,description,source_key,occurred_at)
                VALUES(selected_debt.id_company_debt,v_kind,signed_amount,next_debt,v_mode,
                    cash_change,v_description,v_source_key,v_occurred_at)
                RETURNING * INTO result_event;
            IF v_mode<>'recognize_only' THEN
                SELECT * INTO cash_movement FROM alter_balance(selected_balance.id_balance,cash_change,
                    result_event.id_company_debt_movement,'company_debts');
                UPDATE company_debt_movements SET id_balance_movement=cash_movement.id_balance_movement
                    WHERE id_company_debt_movement=result_event.id_company_debt_movement;
                result_event.id_balance_movement:=cash_movement.id_balance_movement;
            END IF;
            RETURN result_event;
        END;
        $body$;

        CREATE FUNCTION register_company_advance(
            v_owner_user integer, v_account integer, v_amount numeric,
            v_description text, v_source_key text, v_occurred_at timestamptz DEFAULT NULL,
            v_mode text DEFAULT 'credit_cash', v_expected_currency integer DEFAULT NULL
        ) RETURNS company_debt_movements LANGUAGE sql AS $body$
            SELECT _register_company_debt_event(v_owner_user,v_account,v_amount,
                v_description,v_source_key,v_occurred_at,'advance',v_mode,v_expected_currency);
        $body$;

        CREATE FUNCTION register_company_repayment(
            v_owner_user integer, v_account integer, v_amount numeric,
            v_description text, v_source_key text, v_occurred_at timestamptz DEFAULT NULL,
            v_mode text DEFAULT 'debit_cash', v_expected_currency integer DEFAULT NULL
        ) RETURNS company_debt_movements LANGUAGE sql AS $body$
            SELECT _register_company_debt_event(v_owner_user,v_account,v_amount,
                v_description,v_source_key,v_occurred_at,'repayment',v_mode,v_expected_currency);
        $body$;
    `;
};

exports.down = pgm => {
    pgm.sql`
        DO $body$ BEGIN
            IF EXISTS(SELECT 1 FROM company_debt_movements) THEN
                RAISE EXCEPTION 'No se puede retirar el registro de deudas con movimientos contabilizados.';
            END IF;
        END $body$;
        DROP FUNCTION register_company_advance(integer,integer,numeric,text,text,timestamptz,text,integer);
        DROP FUNCTION register_company_repayment(integer,integer,numeric,text,text,timestamptz,text,integer);
        DROP FUNCTION _register_company_debt_event(integer,integer,numeric,text,text,timestamptz,text,text,integer);
        DROP TABLE company_debt_movements;
        DROP TABLE company_debts;
        -- PostgreSQL enum values cannot be removed without replacing the shared type.
    `;
};
