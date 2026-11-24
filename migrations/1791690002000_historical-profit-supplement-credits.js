'use strict';

const originalMigration = require('./1791687000000_profit-withdrawals.js');

function originalTrigger(name) {
    let original;
    originalMigration.up({ sql(statement) { original = statement; } });
    const start = original.indexOf('CREATE FUNCTION ' + name + '()');
    const end = original.indexOf('$body$;', original.indexOf('AS $body$', start) + 9);
    if (start < 0 || end < 0) throw new Error('No se encontro la funcion nativa de retiros: ' + name);
    return original.slice(start, end + 7).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
}

function extendTrigger(name, guard) {
    const fn = originalTrigger(name);
    if (!fn.includes('BEGIN\n')) throw new Error('No se encontro el cuerpo de la funcion: ' + name);
    return fn.replace('BEGIN\n', 'BEGIN\n' + guard);
}

const journalTrigger = 'verify_profit_credit_journal';
const linkTrigger = 'verify_profit_withdrawal_credit_source';

exports.up = pgm => {
    pgm.sql(`
        CREATE TABLE profit_supplement_credits (
            id_profit_supplement_credit serial PRIMARY KEY,
            id_odt integer NOT NULL REFERENCES odts(id_odt),
            id_closure_odt integer NOT NULL REFERENCES closure_odts(id_closure_odt),
            role text NOT NULL CHECK((role='operative' AND id_user=5) OR (role='admin' AND id_user=4)),
            commission_percent numeric(5,5) GENERATED ALWAYS AS
                (CASE role WHEN 'operative' THEN 0.10 WHEN 'admin' THEN 0.05 END) STORED,
            id_user integer NOT NULL REFERENCES users(user_id),
            id_entity integer NOT NULL REFERENCES entitys(id_entity) CHECK(id_entity>3),
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_currency integer NOT NULL REFERENCES currencys(id_currency),
            id_transfer_entity integer NOT NULL UNIQUE REFERENCES transfer_entitys(id_transfer_entity),
            id_credit_movement integer NOT NULL UNIQUE REFERENCES balance_movements(id_balance_movement),
            id_debit_movement integer NOT NULL UNIQUE REFERENCES balance_movements(id_balance_movement),
            amount numeric NOT NULL CHECK(amount>0 AND amount<1e20 AND amount=round(amount,10)),
            source_key varchar(240) NOT NULL UNIQUE CHECK(length(trim(source_key))>0),
            evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[0-9a-f]{64}$'),
            technical_timestamp timestamptz NOT NULL DEFAULT current_timestamp,
            UNIQUE(id_odt,role,id_user,id_account),
            CHECK(id_credit_movement<>id_debit_movement)
        );

        CREATE FUNCTION verify_profit_supplement_credit() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE
            closure closure_odts;
            credit balance_movements;
            debit balance_movements;
        BEGIN
            PERFORM pg_advisory_xact_lock(1791690002,NEW.id_transfer_entity);
            SELECT c.* INTO STRICT closure FROM closure_odts c WHERE c.id_closure_odt=NEW.id_closure_odt FOR SHARE;
            IF closure.id_odt IS DISTINCT FROM NEW.id_odt OR NOT (
                (closure.settled_from_payments IS NOT TRUE AND closure.id_account IS NOT DISTINCT FROM NEW.id_account)
                OR EXISTS(SELECT 1 FROM odt_payments p WHERE p.id_odt=NEW.id_odt AND p.id_account=NEW.id_account
                    AND p.id_currency=NEW.id_currency)) THEN
                RAISE EXCEPTION 'El complemento debe corresponder a la ODT cerrada y a su cuenta de cobro original.';
            END IF;
            PERFORM 1 FROM users u WHERE u.user_id=NEW.id_user FOR SHARE;
            IF (SELECT u.id_entity FROM users u WHERE u.user_id=NEW.id_user) IS DISTINCT FROM NEW.id_entity
                OR (SELECT count(*) FROM users u WHERE u.id_entity=NEW.id_entity)<>1 THEN
                RAISE EXCEPTION 'La cartera del complemento no pertenece exclusivamente al usuario indicado.';
            END IF;
            PERFORM 1 FROM accounts a JOIN currencys c USING(id_currency)
                WHERE a.id_account=NEW.id_account AND a.id_currency=NEW.id_currency AND c.code IS NOT NULL FOR SHARE OF a,c;
            IF NOT FOUND THEN RAISE EXCEPTION 'La moneda del complemento no coincide con la cuenta.'; END IF;
            PERFORM 1 FROM transfer_entitys t WHERE t.id_transfer_entity=NEW.id_transfer_entity FOR SHARE;
            SELECT m.* INTO STRICT credit FROM balance_movements m WHERE m.id_balance_movement=NEW.id_credit_movement FOR SHARE;
            SELECT m.* INTO STRICT debit FROM balance_movements m WHERE m.id_balance_movement=NEW.id_debit_movement FOR SHARE;
            PERFORM 1 FROM balances b WHERE b.id_balance IN (credit.id_balance,debit.id_balance) ORDER BY b.id_balance FOR SHARE;
            IF credit.type_movement_category IS DISTINCT FROM 'transfer_entities' OR debit.type_movement_category IS DISTINCT FROM 'transfer_entities'
                OR credit.id_movement_category IS DISTINCT FROM NEW.id_transfer_entity OR debit.id_movement_category IS DISTINCT FROM NEW.id_transfer_entity
                OR credit.amount IS DISTINCT FROM NEW.amount OR debit.amount IS DISTINCT FROM -NEW.amount
                OR NOT EXISTS(SELECT 1 FROM balances b WHERE b.id_balance=credit.id_balance AND b.id_account=NEW.id_account AND b.id_entity=NEW.id_entity)
                OR NOT EXISTS(SELECT 1 FROM balances b WHERE b.id_balance=debit.id_balance AND b.id_account=NEW.id_account AND b.id_entity=1)
                OR (SELECT count(*) FROM balance_movements m WHERE m.type_movement_category='transfer_entities'
                    AND m.id_movement_category=NEW.id_transfer_entity)<>2 THEN
                RAISE EXCEPTION 'El complemento exige dos movimientos exactos desde Taionca al beneficiario en la misma cuenta.';
            END IF;
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER verify_profit_supplement_credit BEFORE INSERT ON profit_supplement_credits
            FOR EACH ROW EXECUTE FUNCTION verify_profit_supplement_credit();

        ${extendTrigger(journalTrigger, `
            IF EXISTS(SELECT 1 FROM profit_supplement_credits s JOIN balance_movements m ON m.id_balance_movement=s.id_credit_movement
                JOIN currencys c ON c.id_currency=s.id_currency
                WHERE s.id_credit_movement=NEW.id_balance_movement AND s.id_closure_odt=NEW.id_closure_odt
                AND m.id_balance=NEW.id_balance AND s.id_account=NEW.id_account AND s.id_currency=NEW.id_currency AND upper(c.code)='USD'
                AND s.id_user=NEW.id_user AND s.id_entity=NEW.id_entity AND s.amount=NEW.amount) THEN
                RETURN NEW;
            END IF;
        `)}

        ${extendTrigger(linkTrigger, `
            -- xmin may identify a savepoint. Extend it to the epoch nearest the current transaction.
            IF EXISTS(SELECT 1 FROM profit_supplement_credits s WHERE s.id_credit_movement=NEW.id_balance_movement
                AND txid_status(txid_current() + mod(s.xmin::text::bigint - mod(txid_current(),4294967296)
                    + 6442450944,4294967296) - 2147483648)='in progress') THEN
                RAISE EXCEPTION 'El complemento de utilidad debe proceder de una transaccion ya comprometida.';
            END IF;
        `)}

        CREATE FUNCTION register_profit_supplement_journal() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            INSERT INTO profit_credit_journals(id_balance_movement,id_closure_odt,id_balance,id_account,id_currency,id_user,id_entity,amount)
                SELECT NEW.id_credit_movement,NEW.id_closure_odt,m.id_balance,NEW.id_account,NEW.id_currency,NEW.id_user,NEW.id_entity,NEW.amount
                FROM balance_movements m JOIN currencys c ON c.id_currency=NEW.id_currency
                WHERE m.id_balance_movement=NEW.id_credit_movement AND upper(c.code)='USD';
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER register_profit_supplement_journal AFTER INSERT ON profit_supplement_credits
            FOR EACH ROW EXECUTE FUNCTION register_profit_supplement_journal();

        CREATE FUNCTION protect_profit_supplement_history() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE protected boolean := false;
        BEGIN
            IF TG_TABLE_NAME='profit_supplement_credits' THEN
                IF TG_OP<>'TRUNCATE' OR EXISTS(SELECT 1 FROM profit_supplement_credits) THEN
                    RAISE EXCEPTION 'El historial de complementos de utilidad es inmutable.';
                END IF;
                RETURN NULL;
            ELSIF TG_TABLE_NAME='balance_movements' THEN
                IF TG_OP<>'DELETE' AND NEW.type_movement_category='transfer_entities' THEN
                    PERFORM pg_advisory_xact_lock(1791690002,NEW.id_movement_category);
                    protected:=EXISTS(SELECT 1 FROM profit_supplement_credits WHERE id_transfer_entity=NEW.id_movement_category);
                END IF;
                IF TG_OP<>'INSERT' AND OLD.type_movement_category='transfer_entities' THEN
                    protected:=protected OR EXISTS(SELECT 1 FROM profit_supplement_credits WHERE id_transfer_entity=OLD.id_movement_category);
                END IF;
            ELSIF TG_TABLE_NAME='transfer_entitys' THEN
                protected:=EXISTS(SELECT 1 FROM profit_supplement_credits WHERE id_transfer_entity=OLD.id_transfer_entity);
            ELSIF TG_TABLE_NAME='closure_odts' THEN
                protected:=EXISTS(SELECT 1 FROM profit_supplement_credits WHERE id_closure_odt=OLD.id_closure_odt);
            ELSIF TG_TABLE_NAME='accounts' THEN
                protected:=OLD.id_currency IS DISTINCT FROM NEW.id_currency AND
                    EXISTS(SELECT 1 FROM profit_supplement_credits WHERE id_account=OLD.id_account);
            ELSIF TG_TABLE_NAME='currencys' THEN
                protected:=OLD.code IS DISTINCT FROM NEW.code AND
                    EXISTS(SELECT 1 FROM profit_supplement_credits WHERE id_currency=OLD.id_currency);
            ELSIF TG_TABLE_NAME='users' THEN
                protected:=OLD.id_entity IS DISTINCT FROM NEW.id_entity AND
                    EXISTS(SELECT 1 FROM profit_supplement_credits WHERE id_user=OLD.user_id);
            ELSIF TG_TABLE_NAME='balances' THEN
                protected:=(OLD.id_account IS DISTINCT FROM NEW.id_account OR OLD.id_entity IS DISTINCT FROM NEW.id_entity) AND
                    EXISTS(SELECT 1 FROM profit_supplement_credits s JOIN balance_movements m
                        ON m.id_balance_movement IN (s.id_credit_movement,s.id_debit_movement) WHERE m.id_balance=OLD.id_balance);
            END IF;
            IF protected THEN RAISE EXCEPTION 'El historial de complementos de utilidad es inmutable.'; END IF;
            IF TG_OP='DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER protect_profit_supplement_history BEFORE UPDATE OR DELETE ON profit_supplement_credits
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_truncate BEFORE TRUNCATE ON profit_supplement_credits
            FOR EACH STATEMENT EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_history BEFORE INSERT OR UPDATE OR DELETE ON balance_movements
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_history BEFORE UPDATE OR DELETE ON transfer_entitys
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_history BEFORE UPDATE OR DELETE ON closure_odts
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_history BEFORE UPDATE OF id_currency ON accounts
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_history BEFORE UPDATE OF code ON currencys
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_history BEFORE UPDATE OF id_entity ON users
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
        CREATE TRIGGER protect_profit_supplement_history BEFORE UPDATE OF id_account,id_entity ON balances
            FOR EACH ROW EXECUTE FUNCTION protect_profit_supplement_history();
    `);
};

exports.down = pgm => {
    pgm.sql(`
        DO $body$ BEGIN
            IF EXISTS(SELECT 1 FROM profit_supplement_credits) THEN
                RAISE EXCEPTION 'No se puede retirar un historial de complementos contabilizado.';
            END IF;
        END $body$;
        ${originalTrigger(journalTrigger)}
        ${originalTrigger(linkTrigger)}
        DROP TRIGGER protect_profit_supplement_history ON balance_movements;
        DROP TRIGGER protect_profit_supplement_history ON transfer_entitys;
        DROP TRIGGER protect_profit_supplement_history ON closure_odts;
        DROP TRIGGER protect_profit_supplement_history ON accounts;
        DROP TRIGGER protect_profit_supplement_history ON currencys;
        DROP TRIGGER protect_profit_supplement_history ON users;
        DROP TRIGGER protect_profit_supplement_history ON balances;
        DROP TABLE profit_supplement_credits;
        DROP FUNCTION protect_profit_supplement_history();
        DROP FUNCTION register_profit_supplement_journal();
        DROP FUNCTION verify_profit_supplement_credit();
    `);
};
