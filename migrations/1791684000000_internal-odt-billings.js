exports.up=pgm=>{
    pgm.sql`
        CREATE TABLE odt_internal_billings (
            id_internal_odt_billing serial PRIMARY KEY,
            id_customer_odt integer NOT NULL REFERENCES odts(id_odt),
            id_supplier_odt integer NOT NULL REFERENCES odts(id_odt),
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_currency integer NOT NULL REFERENCES currencys(id_currency),
            amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
            id_odt_payment integer NOT NULL UNIQUE REFERENCES odt_payments(id_odt_payment),
            id_income integer NOT NULL UNIQUE REFERENCES incomes(id_income),
            id_general_expense integer NOT NULL UNIQUE REFERENCES general_expenses(id_general_expense),
            id_balance_movement integer NOT NULL UNIQUE REFERENCES balance_movements(id_balance_movement),
            id_actor_user integer NOT NULL REFERENCES users(user_id),
            description varchar(512) NOT NULL CHECK(length(trim(description))>0),
            source_key varchar(240) NOT NULL UNIQUE CHECK(length(trim(source_key))>0),
            credit_source_key varchar(240) NOT NULL UNIQUE CHECK(length(trim(credit_source_key))>0),
            source_evidence jsonb NOT NULL,
            occurred_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT current_timestamp,
            CHECK(id_customer_odt<>id_supplier_odt AND source_key<>credit_source_key)
        );
        CREATE FUNCTION reject_internal_odt_billing_mutation() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN RAISE EXCEPTION 'Internal ODT billing history is immutable.'; END;$body$;
        CREATE TRIGGER immutable_internal_odt_billings BEFORE UPDATE OR DELETE ON odt_internal_billings
            FOR EACH ROW EXECUTE FUNCTION reject_internal_odt_billing_mutation();
        CREATE TRIGGER immutable_truncate_internal_odt_billings BEFORE TRUNCATE ON odt_internal_billings
            FOR EACH STATEMENT EXECUTE FUNCTION reject_internal_odt_billing_mutation();

        CREATE FUNCTION register_internal_odt_billing(
            v_customer_odt integer,v_supplier_odt integer,v_account integer,v_payment integer,v_amount numeric,
            v_description text,v_measure integer,v_actor integer,v_source_key text,v_credit_source_key text,
            v_evidence jsonb,v_occurred_at timestamptz DEFAULT NULL
        ) RETURNS odt_internal_billings LANGUAGE plpgsql AS $body$
        DECLARE
            prior odt_internal_billings;
            result_row odt_internal_billings;
            customer odts;
            supplier odts;
            payment odt_payments;
            income incomes;
            selected_account accounts;
            company_balance balances;
            expense general_expenses;
            movement balance_movements;
            credits integer;
        BEGIN
            IF v_customer_odt IS NULL OR v_supplier_odt IS NULL OR v_customer_odt=v_supplier_odt
                OR v_account IS NULL OR v_payment IS NULL OR v_actor IS NULL OR v_measure IS NULL
                OR v_customer_odt<=0 OR v_supplier_odt<=0 OR v_account<=0 OR v_payment<=0 OR v_actor<=0 OR v_measure<=0 THEN
                RAISE EXCEPTION 'Select two different ODTs, a real account, an existing payment and a technical actor.';
            END IF;
            IF v_amount IS NULL OR NOT(v_amount>0 AND v_amount<1e20) OR v_amount<>round(v_amount,10)
                OR v_description IS NULL OR length(trim(v_description))=0 OR length(v_description)>512
                OR v_source_key IS NULL OR length(trim(v_source_key))=0 OR length(v_source_key)>240
                OR v_credit_source_key IS NULL OR length(trim(v_credit_source_key))=0 OR length(v_credit_source_key)>240
                OR v_source_key=v_credit_source_key OR v_evidence IS NULL OR jsonb_typeof(v_evidence)<>'object' THEN
                RAISE EXCEPTION 'Provide an exact positive total, description and two distinct auditable source keys.';
            END IF;
            IF NOT EXISTS(SELECT 1 FROM users WHERE user_id=v_actor) OR NOT EXISTS(SELECT 1 FROM measures WHERE id_measure=v_measure AND unit='und') THEN
                RAISE EXCEPTION 'The technical actor and existing financial unit und are required.';
            END IF;
            PERFORM pg_advisory_xact_lock(hashtext('internal-odt-billing'),hashtext(v_source_key));
            SELECT * INTO prior FROM odt_internal_billings WHERE source_key=v_source_key;
            IF FOUND THEN
                IF prior.id_customer_odt<>v_customer_odt OR prior.id_supplier_odt<>v_supplier_odt OR prior.id_account<>v_account
                    OR prior.id_odt_payment<>v_payment OR prior.amount<>v_amount OR prior.description<>v_description
                    OR prior.id_actor_user<>v_actor OR prior.credit_source_key<>v_credit_source_key
                    OR prior.source_evidence<>v_evidence OR prior.occurred_at IS DISTINCT FROM v_occurred_at THEN
                    RAISE EXCEPTION 'The internal billing source has already been used with different facts.';
                END IF;
                IF NOT EXISTS(SELECT 1 FROM general_expenses e WHERE e.id_general_expense=prior.id_general_expense
                    AND e.id_odt=v_customer_odt AND e.id_account=v_account AND e.amount=v_amount AND e.rate=1 AND e.quantity=1
                    AND e.id_measure=v_measure AND e.id_user=v_actor AND e.description=v_description) THEN
                    RAISE EXCEPTION 'The recorded internal expense changed.';
                END IF;
            END IF;
            IF prior.id_internal_odt_billing IS NULL THEN
                SELECT * INTO payment FROM odt_payments WHERE id_odt_payment=v_payment FOR UPDATE;
            ELSE
                SELECT * INTO payment FROM odt_payments WHERE id_odt_payment=v_payment;
            END IF;
            IF NOT FOUND THEN RAISE EXCEPTION 'The supplier payment must already exist.'; END IF;
            IF EXISTS(SELECT 1 FROM odt_internal_billings WHERE (id_odt_payment=v_payment OR credit_source_key=v_credit_source_key)
                AND (prior.id_internal_odt_billing IS NULL OR id_internal_odt_billing<>prior.id_internal_odt_billing)) THEN
                RAISE EXCEPTION 'The existing supplier credit is already linked to another internal billing.';
            END IF;
            SELECT * INTO customer FROM odts WHERE id_odt=v_customer_odt;
            SELECT * INTO supplier FROM odts WHERE id_odt=v_supplier_odt;
            SELECT * INTO selected_account FROM accounts WHERE id_account=v_account;
            SELECT * INTO income FROM incomes WHERE id_income=payment.id_income;
            IF customer.id_odt IS NULL OR supplier.id_odt IS NULL OR selected_account.id_account IS NULL OR income.id_income IS NULL
                OR customer.id_entity IS DISTINCT FROM 1 OR supplier.id_entity IS DISTINCT FROM 1 OR income.id_entity IS DISTINCT FROM 1
                OR selected_account.id_currency IS NULL OR customer.id_currency IS DISTINCT FROM selected_account.id_currency
                OR supplier.id_currency IS DISTINCT FROM selected_account.id_currency
                OR payment.id_currency IS DISTINCT FROM selected_account.id_currency
                OR payment.odt_currency IS DISTINCT FROM supplier.id_currency
                OR payment.id_odt IS DISTINCT FROM v_supplier_odt OR payment.id_account IS DISTINCT FROM v_account OR income.id_account IS DISTINCT FROM v_account
                OR payment.amount IS DISTINCT FROM v_amount OR payment.amount_odt IS DISTINCT FROM v_amount OR income.amount IS DISTINCT FROM v_amount THEN
                RAISE EXCEPTION 'Both ODTs and the existing native supplier credit must match the same company account, currency and exact total.';
            END IF;
            IF prior.id_internal_odt_billing IS NULL AND EXISTS(SELECT 1 FROM closure_odts WHERE id_odt=v_customer_odt) THEN
                RAISE EXCEPTION 'The customer ODT is closed; missing internal costs must be reviewed first.';
            END IF;
            SELECT count(*) INTO credits FROM balance_movements m JOIN balances b USING(id_balance)
                WHERE m.type_movement_category='incomes' AND m.id_movement_category=income.id_income
                AND b.id_account=v_account AND b.id_entity=1 AND m.amount=v_amount;
            IF credits<>1 OR (SELECT count(*) FROM balance_movements WHERE type_movement_category='incomes'
                AND id_movement_category=income.id_income)<>1 THEN
                RAISE EXCEPTION 'Exactly one already-posted cash credit is required; never generate another supplier income.';
            END IF;
            IF prior.id_internal_odt_billing IS NOT NULL THEN
                IF prior.id_currency IS DISTINCT FROM selected_account.id_currency OR prior.id_income IS DISTINCT FROM income.id_income THEN
                    RAISE EXCEPTION 'The recorded internal currency or existing income link changed.';
                END IF;
                IF NOT EXISTS(SELECT 1 FROM balance_movements m JOIN balances b USING(id_balance)
                    WHERE m.id_balance_movement=prior.id_balance_movement AND m.type_movement_category='general_expenses'
                    AND m.id_movement_category=prior.id_general_expense AND m.amount=-v_amount AND b.id_account=v_account AND b.id_entity=1)
                    OR (SELECT count(*) FROM balance_movements WHERE type_movement_category='general_expenses'
                        AND id_movement_category=prior.id_general_expense)<>1 THEN
                    RAISE EXCEPTION 'The recorded internal cash debit changed.';
                END IF;
                RETURN prior;
            END IF;
            SELECT * INTO company_balance FROM balances WHERE id_account=v_account AND id_entity=1 FOR UPDATE;
            IF company_balance.id_balance IS NULL OR company_balance.balance<v_amount THEN
                RAISE EXCEPTION 'Insufficient real company cash for the original internal cost.';
            END IF;
            INSERT INTO general_expenses(id_account,id_odt,amount,description,rate,id_measure,quantity,id_user)
                VALUES(v_account,v_customer_odt,v_amount,v_description,1,v_measure,1,v_actor) RETURNING * INTO expense;
            SELECT * INTO movement FROM alter_balance(company_balance.id_balance,-v_amount,expense.id_general_expense,'general_expenses');
            INSERT INTO odt_internal_billings(id_customer_odt,id_supplier_odt,id_account,id_currency,amount,id_odt_payment,id_income,
                id_general_expense,id_balance_movement,id_actor_user,description,source_key,credit_source_key,source_evidence,occurred_at)
                VALUES(v_customer_odt,v_supplier_odt,v_account,selected_account.id_currency,v_amount,v_payment,income.id_income,
                expense.id_general_expense,movement.id_balance_movement,v_actor,v_description,v_source_key,v_credit_source_key,v_evidence,v_occurred_at)
                RETURNING * INTO result_row;
            RETURN result_row;
        END;$body$;
    `;
};
exports.down=pgm=>{
    pgm.sql`
        DO $body$ BEGIN IF EXISTS(SELECT 1 FROM odt_internal_billings) THEN
            RAISE EXCEPTION 'Internal billing financial history exists; do not drop its source links.';END IF;END;$body$;
        DROP FUNCTION register_internal_odt_billing(integer,integer,integer,integer,numeric,text,integer,integer,text,text,jsonb,timestamptz);
        DROP TABLE odt_internal_billings;
        DROP FUNCTION reject_internal_odt_billing_mutation();
    `;
};
