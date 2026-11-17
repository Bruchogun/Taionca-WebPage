const legacySignature='integer,integer,integer,numeric,integer,json,json,json,numeric,numeric';
function sourceFunction(name){
    let sql='';require('./1790709000000_manual-currency-closures').up({sql(value){sql+=value;}});
    const match=sql.match(new RegExp('CREATE FUNCTION '+name+'\\([^]*?\\$body\\$;'));
    if(!match)throw new Error('Original native expense source function unavailable.');
    return match[0].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION');
}
exports.up=pgm=>{
    pgm.sql(`
        ALTER TABLE general_expenses ALTER COLUMN rate DROP NOT NULL;
        ALTER TABLE general_expenses ADD COLUMN historical_source jsonb;
        ALTER TABLE general_expenses ADD CONSTRAINT valid_general_expense_rate
            CHECK(rate IS NULL OR(rate>0 AND rate<1e20));
        ALTER TABLE general_expenses ADD CONSTRAINT unvalued_expense_requires_history
            CHECK((rate IS NOT NULL AND historical_source IS NULL) OR
                (rate IS NULL AND historical_source IS NOT NULL AND jsonb_typeof(historical_source)='object'));
        CREATE UNIQUE INDEX unique_historical_expense_source ON general_expenses((historical_source->>'source_key'))
            WHERE historical_source IS NOT NULL;
        CREATE FUNCTION guard_historical_general_expense() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE account_currency integer; contract_currency integer; financial_unit text;
        BEGIN
            IF TG_OP IN('UPDATE','DELETE') AND OLD.historical_source IS NOT NULL THEN
                RAISE EXCEPTION 'El coste historico, moneda y evidencia originales son inmutables; valora el cierre por separado.';
            END IF;
            IF TG_OP='DELETE' THEN RETURN OLD;END IF;
            IF NEW.rate IS NULL OR NEW.historical_source IS NOT NULL THEN
                IF TG_OP<>'INSERT' THEN
                    RAISE EXCEPTION 'No se reinterpreta un coste existente como historia de cambio desconocido.';
                END IF;
                SELECT id_currency INTO contract_currency FROM odts WHERE id_odt=NEW.id_odt FOR UPDATE;
                SELECT id_currency INTO account_currency FROM accounts WHERE id_account=NEW.id_account FOR SHARE;
                SELECT unit INTO financial_unit FROM measures WHERE id_measure=NEW.id_measure;
                IF NEW.rate IS NOT NULL OR jsonb_typeof(NEW.historical_source) IS DISTINCT FROM 'object'
                    OR NEW.historical_source->>'kind' IS DISTINCT FROM 'unknown_cross_currency_history'
                    OR length(trim(coalesce(NEW.historical_source->>'source_key','')))=0
                    OR length(NEW.historical_source->>'source_key')>256
                    OR NEW.id_user IS DISTINCT FROM 1 OR NEW.quantity IS DISTINCT FROM 1 OR financial_unit IS DISTINCT FROM 'und'
                    OR account_currency IS NULL OR contract_currency IS NULL OR account_currency=contract_currency
                    OR jsonb_typeof(NEW.historical_source->'native_currency_id') IS DISTINCT FROM 'number'
                    OR (NEW.historical_source->>'native_currency_id')::integer IS DISTINCT FROM account_currency
                    OR jsonb_typeof(NEW.historical_source->'contract_currency_id') IS DISTINCT FROM 'number'
                    OR (NEW.historical_source->>'contract_currency_id')::integer IS DISTINCT FROM contract_currency
                    OR NEW.amount IS NULL OR NEW.amount<=0 OR NEW.amount>=1e20 THEN
                    RAISE EXCEPTION 'Una tasa desconocida requiere historia de divisas distintas, coste nativo exacto y actor tecnico.';
                END IF;
            END IF;
            RETURN NEW;
        END;$body$;
        CREATE TRIGGER guard_historical_general_expenses BEFORE INSERT OR UPDATE OR DELETE ON general_expenses
            FOR EACH ROW EXECUTE FUNCTION guard_historical_general_expense();
        CREATE FUNCTION guard_historical_expense_truncate() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            IF EXISTS(SELECT 1 FROM general_expenses WHERE historical_source IS NOT NULL) THEN
                RAISE EXCEPTION 'Los costes historicos y su evidencia no se pueden eliminar.';
            END IF;
            RETURN NULL;
        END;$body$;
        CREATE TRIGGER guard_historical_general_expense_truncate BEFORE TRUNCATE ON general_expenses
            FOR EACH STATEMENT EXECUTE FUNCTION guard_historical_expense_truncate();
        CREATE FUNCTION protect_general_expense_currency() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            IF OLD.id_currency IS DISTINCT FROM NEW.id_currency THEN
                IF TG_TABLE_NAME='accounts' THEN
                    IF EXISTS(SELECT 1 FROM general_expenses WHERE id_account=OLD.id_account) THEN
                        RAISE EXCEPTION 'La moneda nativa de una cuenta con gastos contabilizados se conserva.';
                    END IF;
                ELSIF TG_TABLE_NAME='odts' THEN
                    IF EXISTS(SELECT 1 FROM general_expenses WHERE id_odt=OLD.id_odt AND historical_source IS NOT NULL) THEN
                        RAISE EXCEPTION 'La moneda original de una ODT con costes historicos se conserva.';
                    END IF;
                END IF;
            END IF;
            RETURN NEW;
        END;$body$;
        CREATE TRIGGER protect_expense_account_currency BEFORE UPDATE OF id_currency ON accounts
            FOR EACH ROW EXECUTE FUNCTION protect_general_expense_currency();
        CREATE TRIGGER protect_historical_expense_odt_currency BEFORE UPDATE OF id_currency ON odts
            FOR EACH ROW EXECUTE FUNCTION protect_general_expense_currency();
        CREATE FUNCTION require_valued_legacy_expenses(v_id_odt integer) RETURNS void LANGUAGE plpgsql AS $body$
        BEGIN
            PERFORM 1 FROM odts WHERE id_odt=v_id_odt FOR UPDATE;
            IF EXISTS(SELECT 1 FROM general_expenses WHERE id_odt=v_id_odt AND rate IS NULL) THEN
                RAISE EXCEPTION 'Hay costes historicos sin tasa: revisa su valor en el cierre nativo por moneda.';
            END IF;
            IF EXISTS(SELECT 1 FROM odt_payments WHERE id_odt=v_id_odt AND exchange_rate IS NULL) THEN
                RAISE EXCEPTION 'Los equivalentes manuales requieren el cierre nativo por moneda.';
            END IF;
        END;$body$;
        ALTER FUNCTION closure_odt_legacy(${legacySignature}) RENAME TO closure_odt_legacy_valued_impl;
        CREATE FUNCTION closure_odt_legacy(v_id_account integer,v_id_odt integer,v_id_user integer,v_amount numeric,
            v_id_user_ceo integer,admin_users json,operative_users json,supervisor_users json,
            admin_expense_percent numeric,president_profit_percent numeric) RETURNS text LANGUAGE plpgsql AS $body$
        BEGIN
            PERFORM require_valued_legacy_expenses(v_id_odt);
            RETURN closure_odt_legacy_valued_impl(v_id_account,v_id_odt,v_id_user,v_amount,v_id_user_ceo,admin_users,
                operative_users,supervisor_users,admin_expense_percent,president_profit_percent);
        END;$body$;
        CREATE FUNCTION guard_legacy_closure_valuation() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            IF NEW.settlement_mode='legacy' THEN PERFORM require_valued_legacy_expenses(NEW.id_odt);END IF;
            RETURN NEW;
        END;$body$;
        CREATE TRIGGER guard_legacy_closure_value BEFORE INSERT ON closure_odts
            FOR EACH ROW EXECUTE FUNCTION guard_legacy_closure_valuation();
    `);
    pgm.sql(sourceFunction('odt_expense_sources').replace('a.id_currency,e.amount,e.description::text',
        "coalesce((e.historical_source->>'native_currency_id')::integer,a.id_currency),e.amount,e.description::text"));
};
exports.down=pgm=>{
    pgm.sql(`DO $body$ BEGIN
        IF EXISTS(SELECT 1 FROM general_expenses WHERE rate IS NULL OR historical_source IS NOT NULL) THEN
            RAISE EXCEPTION 'No se retira una historia de costes nativos con conversion desconocida.';
        END IF;END;$body$;
        DROP TRIGGER guard_legacy_closure_value ON closure_odts;
        DROP FUNCTION guard_legacy_closure_valuation();
        DROP FUNCTION closure_odt_legacy(${legacySignature});
        ALTER FUNCTION closure_odt_legacy_valued_impl(${legacySignature}) RENAME TO closure_odt_legacy;
        DROP FUNCTION require_valued_legacy_expenses(integer);
        DROP TRIGGER protect_expense_account_currency ON accounts;
        DROP TRIGGER protect_historical_expense_odt_currency ON odts;
        DROP FUNCTION protect_general_expense_currency();
        DROP TRIGGER guard_historical_general_expenses ON general_expenses;
        DROP FUNCTION guard_historical_general_expense();
        DROP TRIGGER guard_historical_general_expense_truncate ON general_expenses;
        DROP FUNCTION guard_historical_expense_truncate();
        DROP INDEX unique_historical_expense_source;
        ALTER TABLE general_expenses DROP CONSTRAINT valid_general_expense_rate;
        ALTER TABLE general_expenses DROP CONSTRAINT unvalued_expense_requires_history;
        ALTER TABLE general_expenses ALTER COLUMN rate SET NOT NULL;
    `);
    pgm.sql(sourceFunction('odt_expense_sources'));
    pgm.sql('ALTER TABLE general_expenses DROP COLUMN historical_source;');
};
