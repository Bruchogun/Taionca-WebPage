exports.up = pgm => {
    pgm.sql(`
        CREATE TABLE profit_withdrawals (
            id_profit_withdrawal serial PRIMARY KEY,
            external_uuid uuid NOT NULL UNIQUE,
            source_namespace varchar(240) NOT NULL,
            source_key varchar(240) NOT NULL,
            source_evidence_hash text NOT NULL CHECK(source_evidence_hash ~ '^[0-9a-f]{64}$'),
            request_digest text NOT NULL CHECK(request_digest ~ '^[0-9a-f]{64}$'),
            request_body jsonb NOT NULL CHECK(jsonb_typeof(request_body)='object'),
            id_actor_user integer NOT NULL REFERENCES users(user_id),
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_currency integer NOT NULL REFERENCES currencys(id_currency),
            amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
            description varchar(512) NOT NULL,
            documentary_odt integer CHECK(documentary_odt>0),
            occurred_at timestamptz,
            technical_timestamp timestamptz NOT NULL DEFAULT current_timestamp,
            UNIQUE(source_namespace,source_key),
            CHECK(length(trim(source_namespace))>0 AND length(trim(source_key))>0 AND length(trim(description))>0)
        );
        CREATE TABLE profit_credit_journals (
            id_balance_movement integer PRIMARY KEY REFERENCES balance_movements(id_balance_movement),
            id_closure_odt integer NOT NULL REFERENCES closure_odts(id_closure_odt),
            id_balance integer NOT NULL REFERENCES balances(id_balance),
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_currency integer NOT NULL REFERENCES currencys(id_currency),
            id_user integer NOT NULL REFERENCES users(user_id),
            id_entity integer NOT NULL REFERENCES entitys(id_entity),
            amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
            technical_timestamp timestamptz NOT NULL DEFAULT current_timestamp
        );
        CREATE INDEX profit_credit_journals_wallet ON profit_credit_journals(id_balance);
        CREATE TABLE profit_withdrawal_parts (
            id_profit_withdrawal_part serial PRIMARY KEY,
            id_profit_withdrawal integer NOT NULL REFERENCES profit_withdrawals(id_profit_withdrawal),
            id_user integer NOT NULL REFERENCES users(user_id),
            id_entity integer NOT NULL REFERENCES entitys(id_entity),
            id_balance integer NOT NULL REFERENCES balances(id_balance),
            amount numeric(30,10) NOT NULL CHECK(amount>0 AND amount<1e20),
            earned_before numeric(30,10) NOT NULL CHECK(earned_before>=amount),
            earned_after numeric(30,10) NOT NULL CHECK(earned_after=earned_before-amount),
            id_balance_movement integer NOT NULL UNIQUE REFERENCES balance_movements(id_balance_movement),
            UNIQUE(id_profit_withdrawal,id_user), UNIQUE(id_profit_withdrawal,id_entity)
        );
        CREATE INDEX profit_withdrawal_parts_wallet ON profit_withdrawal_parts(id_balance);
        -- These links prove aggregate available rights, not a historical payment allocation to an ODT.
        CREATE TABLE profit_withdrawal_credit_sources (
            id_profit_withdrawal integer NOT NULL REFERENCES profit_withdrawals(id_profit_withdrawal),
            id_balance_movement integer NOT NULL REFERENCES profit_credit_journals(id_balance_movement),
            PRIMARY KEY(id_profit_withdrawal,id_balance_movement)
        );

        CREATE FUNCTION verify_profit_credit_journal() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE
            movement balance_movements;
            wallet balances;
            account_currency integer;
            user_entity integer;
            currency_code text;
            allocation numeric;
            journal_total numeric;
            native_profit numeric;
            allocated_profit numeric;
            closure_mode text;
            closure_currency integer;
        BEGIN
            SELECT m.* INTO STRICT movement FROM balance_movements m
                WHERE m.id_balance_movement=NEW.id_balance_movement FOR SHARE;
            SELECT b.* INTO STRICT wallet FROM balances b WHERE b.id_balance=movement.id_balance FOR SHARE;
            SELECT a.id_currency,upper(c.code) INTO account_currency,currency_code FROM accounts a
                JOIN currencys c USING(id_currency) WHERE a.id_account=wallet.id_account FOR SHARE OF a,c;
            SELECT u.id_entity INTO user_entity FROM users u WHERE u.user_id=NEW.id_user FOR SHARE;
            IF movement.type_movement_category<>'closure_odts' OR movement.amount<=0
                OR movement.id_movement_category<>NEW.id_closure_odt OR movement.id_balance<>NEW.id_balance
                OR movement.amount<>NEW.amount OR wallet.id_account<>NEW.id_account OR wallet.id_entity<>NEW.id_entity
                OR NEW.id_currency IS DISTINCT FROM account_currency OR currency_code IS DISTINCT FROM 'USD' OR user_entity IS DISTINCT FROM NEW.id_entity
                OR NEW.id_entity<=3 OR (SELECT count(*) FROM users WHERE id_entity=NEW.id_entity)<>1 THEN
                RAISE EXCEPTION 'La prueba no corresponde a una comision positiva real del usuario en esa cuenta USD.';
            END IF;
            IF EXISTS(SELECT 1 FROM balance_movements m WHERE m.id_balance_movement=NEW.id_balance_movement
                AND m.xmin::text::bigint=mod(txid_current(),4294967296)) THEN
                RAISE EXCEPTION 'La comision debe proceder de una transaccion ya comprometida.';
            END IF;
            SELECT c.settlement_mode,o.id_currency INTO closure_mode,closure_currency FROM closure_odts c
                JOIN odts o USING(id_odt) WHERE c.id_closure_odt=NEW.id_closure_odt AND c.settled_from_payments IS TRUE FOR SHARE OF c;
            IF NOT FOUND THEN RAISE EXCEPTION 'La comision no corresponde a un cierre nativo de abonos.'; END IF;
            SELECT a.amount INTO allocation FROM closure_odt_allocations a WHERE a.id_closure_odt=NEW.id_closure_odt
                AND a.id_account=NEW.id_account AND a.id_entity=NEW.id_entity FOR SHARE;
            SELECT sum(m.amount) INTO journal_total FROM balance_movements m WHERE m.type_movement_category='closure_odts'
                AND m.id_movement_category=NEW.id_closure_odt AND m.id_balance=NEW.id_balance;
            IF allocation IS NULL OR allocation<=0 OR journal_total IS DISTINCT FROM allocation THEN
                RAISE EXCEPTION 'Los journals no coinciden exactamente con el reparto nativo del cierre.';
            END IF;
            IF closure_mode IN ('single','split') THEN
                SELECT sum(c.profit) INTO native_profit FROM closure_odt_part_commissions c
                    JOIN closure_odt_parts p USING(id_part) WHERE p.id_closure_odt=NEW.id_closure_odt
                    AND p.id_currency=NEW.id_currency AND c.id_user=NEW.id_user AND c.id_entity=NEW.id_entity;
            ELSIF closure_mode='legacy' AND closure_currency=NEW.id_currency THEN
                SELECT sum(profit) INTO native_profit FROM (
                    SELECT profit FROM admin_closure_odts WHERE id_closure_odt=NEW.id_closure_odt AND id_user=NEW.id_user
                    UNION ALL SELECT profit FROM operative_closure_odts WHERE id_closure_odt=NEW.id_closure_odt AND id_user=NEW.id_user
                    UNION ALL SELECT profit FROM supervisor_closure_odts WHERE id_closure_odt=NEW.id_closure_odt AND id_user=NEW.id_user
                    UNION ALL SELECT profit FROM ceo_closure_odts WHERE id_closure_odt=NEW.id_closure_odt AND id_user=NEW.id_user
                ) commissions;
            END IF;
            SELECT sum(a.amount) INTO allocated_profit FROM closure_odt_allocations a JOIN accounts ac USING(id_account)
                WHERE a.id_closure_odt=NEW.id_closure_odt AND a.id_entity=NEW.id_entity AND ac.id_currency=NEW.id_currency;
            IF native_profit IS NULL OR native_profit<=0 OR allocated_profit IS DISTINCT FROM native_profit THEN
                RAISE EXCEPTION 'El reparto del usuario no coincide con sus comisiones nativas en USD.';
            END IF;
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER verify_profit_credit_journal BEFORE INSERT ON profit_credit_journals
            FOR EACH ROW EXECUTE PROCEDURE verify_profit_credit_journal();

        CREATE FUNCTION verify_profit_withdrawal_part() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE
            withdrawal profit_withdrawals;
            wallet balances;
            movement balance_movements;
            rights numeric;
        BEGIN
            SELECT * INTO STRICT withdrawal FROM profit_withdrawals WHERE id_profit_withdrawal=NEW.id_profit_withdrawal FOR SHARE;
            SELECT * INTO STRICT wallet FROM balances WHERE id_balance=NEW.id_balance FOR UPDATE;
            SELECT * INTO STRICT movement FROM balance_movements WHERE id_balance_movement=NEW.id_balance_movement FOR SHARE;
            SELECT coalesce((SELECT sum(amount) FROM profit_credit_journals WHERE id_balance=NEW.id_balance),0)
                -coalesce((SELECT sum(amount) FROM profit_withdrawal_parts WHERE id_balance=NEW.id_balance),0) INTO rights;
            IF NEW.id_entity<=3 OR (SELECT id_entity FROM users WHERE user_id=NEW.id_user) IS DISTINCT FROM NEW.id_entity
                OR wallet.id_entity<>NEW.id_entity OR wallet.id_account<>withdrawal.id_account
                OR movement.id_balance<>NEW.id_balance OR movement.type_movement_category<>'profit_withdrawals'
                OR movement.id_movement_category<>NEW.id_profit_withdrawal_part OR movement.amount<>-NEW.amount
                OR NEW.earned_before<>rights OR rights<NEW.amount
                OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(withdrawal.request_body->'parts') p
                    WHERE (p->>'userId')::integer=NEW.id_user AND (p->>'entityId')::integer=NEW.id_entity
                    AND (p->>'amount')::numeric=NEW.amount) THEN
                RAISE EXCEPTION 'La parte del retiro no coincide con su journal, usuario o derechos reales.';
            END IF;
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER verify_profit_withdrawal_part BEFORE INSERT ON profit_withdrawal_parts
            FOR EACH ROW EXECUTE PROCEDURE verify_profit_withdrawal_part();
        CREATE FUNCTION verify_profit_withdrawal_credit_source() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            IF NOT EXISTS(SELECT 1 FROM profit_withdrawals w JOIN profit_credit_journals j
                ON j.id_balance_movement=NEW.id_balance_movement WHERE w.id_profit_withdrawal=NEW.id_profit_withdrawal
                AND w.id_account=j.id_account AND w.id_currency=j.id_currency
                AND EXISTS(SELECT 1 FROM jsonb_array_elements(w.request_body->'parts') p
                    WHERE (p->>'userId')::integer=j.id_user AND (p->>'entityId')::integer=j.id_entity)) THEN
                RAISE EXCEPTION 'La prueba de credito no pertenece a los destinatarios y cuenta de este retiro.';
            END IF;
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER verify_profit_withdrawal_credit_source BEFORE INSERT ON profit_withdrawal_credit_sources
            FOR EACH ROW EXECUTE PROCEDURE verify_profit_withdrawal_credit_source();

        CREATE FUNCTION protect_profit_withdrawal_history() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE protected boolean := false;
        BEGIN
            IF TG_OP='TRUNCATE' THEN
                IF EXISTS(SELECT 1 FROM profit_credit_journals) OR EXISTS(SELECT 1 FROM profit_withdrawals) THEN
                    RAISE EXCEPTION 'El historial de retiros y sus pruebas de comision es inmutable.';
                END IF;
                RETURN NULL;
            END IF;
            IF TG_TABLE_NAME IN ('profit_withdrawals','profit_withdrawal_parts','profit_credit_journals','profit_withdrawal_credit_sources') THEN
                protected:=true;
            ELSIF TG_TABLE_NAME='balance_movements' THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_balance_movement=OLD.id_balance_movement)
                    OR EXISTS(SELECT 1 FROM profit_withdrawal_parts WHERE id_balance_movement=OLD.id_balance_movement);
            ELSIF TG_TABLE_NAME='closure_odt_allocations' THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_closure_odt=OLD.id_closure_odt
                    AND id_account=OLD.id_account AND id_entity=OLD.id_entity);
            ELSIF TG_TABLE_NAME='closure_odts' THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_closure_odt=OLD.id_closure_odt);
            ELSIF TG_TABLE_NAME='closure_odt_parts' THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_closure_odt=OLD.id_closure_odt AND id_currency=OLD.id_currency);
            ELSIF TG_TABLE_NAME='closure_odt_part_commissions' THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals j JOIN closure_odt_parts p USING(id_closure_odt)
                    WHERE p.id_part=OLD.id_part AND j.id_user=OLD.id_user AND j.id_currency=p.id_currency);
            ELSIF TG_TABLE_NAME IN ('admin_closure_odts','operative_closure_odts','supervisor_closure_odts','ceo_closure_odts') THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_closure_odt=OLD.id_closure_odt AND id_user=OLD.id_user);
            ELSIF TG_TABLE_NAME='balances' THEN
                protected:=(TG_OP='DELETE' OR OLD.id_balance IS DISTINCT FROM NEW.id_balance
                    OR OLD.id_account IS DISTINCT FROM NEW.id_account OR OLD.id_entity IS DISTINCT FROM NEW.id_entity)
                    AND (EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_balance=OLD.id_balance)
                        OR EXISTS(SELECT 1 FROM profit_withdrawal_parts WHERE id_balance=OLD.id_balance));
            ELSIF TG_TABLE_NAME='accounts' THEN
                protected:=(TG_OP='DELETE' OR OLD.id_account IS DISTINCT FROM NEW.id_account OR OLD.id_currency IS DISTINCT FROM NEW.id_currency)
                    AND (EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_account=OLD.id_account)
                        OR EXISTS(SELECT 1 FROM profit_withdrawals WHERE id_account=OLD.id_account));
            ELSIF TG_TABLE_NAME='users' THEN
                protected:=(TG_OP='DELETE' OR OLD.user_id IS DISTINCT FROM NEW.user_id OR OLD.id_entity IS DISTINCT FROM NEW.id_entity)
                    AND (EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_user=OLD.user_id)
                        OR EXISTS(SELECT 1 FROM profit_withdrawal_parts WHERE id_user=OLD.user_id));
            ELSIF TG_TABLE_NAME='currencys' THEN
                protected:=(TG_OP='DELETE' OR OLD.id_currency IS DISTINCT FROM NEW.id_currency OR OLD.code IS DISTINCT FROM NEW.code)
                    AND (EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_currency=OLD.id_currency)
                        OR EXISTS(SELECT 1 FROM profit_withdrawals WHERE id_currency=OLD.id_currency));
            ELSIF TG_TABLE_NAME='entitys' THEN
                protected:=(TG_OP='DELETE' OR OLD.id_entity IS DISTINCT FROM NEW.id_entity)
                    AND (EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_entity=OLD.id_entity)
                        OR EXISTS(SELECT 1 FROM profit_withdrawal_parts WHERE id_entity=OLD.id_entity));
            END IF;
            IF protected THEN RAISE EXCEPTION 'El historial de retiros y sus pruebas de comision es inmutable.'; END IF;
            IF TG_OP='DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END;
        $body$;

        CREATE FUNCTION protect_used_profit_credit_insert() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE protected boolean := false;
        BEGIN
            IF TG_TABLE_NAME='balance_movements' THEN
                protected:=NEW.type_movement_category='closure_odts' AND EXISTS(SELECT 1 FROM profit_credit_journals
                    WHERE id_closure_odt=NEW.id_movement_category AND id_balance=NEW.id_balance);
            ELSIF TG_TABLE_NAME='closure_odt_allocations' THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals j JOIN accounts a ON a.id_account=NEW.id_account
                    WHERE j.id_closure_odt=NEW.id_closure_odt AND j.id_entity=NEW.id_entity AND j.id_currency=a.id_currency);
            ELSIF TG_TABLE_NAME='closure_odt_part_commissions' THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals j JOIN closure_odt_parts p USING(id_closure_odt)
                    WHERE p.id_part=NEW.id_part AND j.id_user=NEW.id_user AND j.id_currency=p.id_currency);
            ELSIF TG_TABLE_NAME IN ('admin_closure_odts','operative_closure_odts','supervisor_closure_odts','ceo_closure_odts') THEN
                protected:=EXISTS(SELECT 1 FROM profit_credit_journals WHERE id_closure_odt=NEW.id_closure_odt AND id_user=NEW.id_user);
            END IF;
            IF protected THEN RAISE EXCEPTION 'No se puede ampliar una prueba de credito ya utilizada.'; END IF;
            RETURN NEW;
        END;
        $body$;
        DO $body$
        DECLARE table_name text;
        BEGIN
            FOREACH table_name IN ARRAY ARRAY['balance_movements','closure_odt_allocations','closure_odt_part_commissions',
                'admin_closure_odts','operative_closure_odts','supervisor_closure_odts','ceo_closure_odts'] LOOP
                EXECUTE format('CREATE TRIGGER protect_used_profit_credit_insert BEFORE INSERT ON %I FOR EACH ROW EXECUTE PROCEDURE protect_used_profit_credit_insert()',table_name);
            END LOOP;
        END;
        $body$;
        DO $body$
        DECLARE table_name text;
        BEGIN
            FOREACH table_name IN ARRAY ARRAY['profit_withdrawals','profit_withdrawal_parts','profit_credit_journals',
                'profit_withdrawal_credit_sources','balance_movements','closure_odt_allocations','closure_odts',
                'closure_odt_parts','closure_odt_part_commissions','admin_closure_odts','operative_closure_odts',
                'supervisor_closure_odts','ceo_closure_odts','balances','accounts','users','currencys','entitys'] LOOP
                EXECUTE format('CREATE TRIGGER protect_profit_withdrawal_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE PROCEDURE protect_profit_withdrawal_history()',table_name);
                EXECUTE format('CREATE TRIGGER protect_profit_withdrawal_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE PROCEDURE protect_profit_withdrawal_history()',table_name);
            END LOOP;
        END;
        $body$;

        CREATE FUNCTION profit_withdrawal_result(v_id integer) RETURNS jsonb LANGUAGE sql STABLE AS $body$
            SELECT jsonb_build_object('idProfitWithdrawal',w.id_profit_withdrawal,'externalUuid',w.external_uuid,
                'requestDigest',w.request_digest,'accountId',w.id_account,'currencyId',w.id_currency,'amount',w.amount::text,
                'occurredAt',w.occurred_at,'technicalTimestamp',w.technical_timestamp,'documentaryOdt',w.documentary_odt,
                'parts',coalesce((SELECT jsonb_agg(jsonb_build_object('idPart',p.id_profit_withdrawal_part,
                    'userId',p.id_user,'entityId',p.id_entity,'balanceId',p.id_balance,'amount',p.amount::text,
                    'earnedBefore',p.earned_before::text,'earnedAfter',p.earned_after::text,
                    'idBalanceMovement',p.id_balance_movement) ORDER BY p.id_user)
                    FROM profit_withdrawal_parts p WHERE p.id_profit_withdrawal=w.id_profit_withdrawal),'[]'::jsonb),
                'creditJournalIds',coalesce((SELECT jsonb_agg(s.id_balance_movement ORDER BY s.id_balance_movement)
                    FROM profit_withdrawal_credit_sources s WHERE s.id_profit_withdrawal=w.id_profit_withdrawal),'[]'::jsonb))
            FROM profit_withdrawals w WHERE w.id_profit_withdrawal=v_id;
        $body$;

        CREATE FUNCTION register_profit_withdrawal(v_request jsonb,v_digest text) RETURNS jsonb LANGUAGE plpgsql AS $body$
        DECLARE
            previous profit_withdrawals;
            external_id uuid;
            actor integer;
            account_id integer;
            currency_id integer;
            account_currency integer;
            currency_code text;
            total numeric;
            description_value text;
            namespace_value text;
            key_value text;
            evidence_hash text;
            event_date timestamptz;
            documentary integer;
            recipient record;
            credit record;
            wallet balances;
            user_entity integer;
            earned numeric;
            paid numeric;
            rights_before numeric;
            withdrawal_id integer;
            part_id integer;
            cash_movement balance_movements;
        BEGIN
            IF v_request IS NULL OR jsonb_typeof(v_request)<>'object' OR (v_request->>'version') IS DISTINCT FROM '1'
                OR v_digest IS NULL OR v_digest !~ '^[0-9a-f]{64}$'
                OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_request) k WHERE k NOT IN ('version','externalUuid','actorUserId',
                    'accountId','currencyId','amount','description','source','occurredAt','documentaryOdt','parts'))
                OR jsonb_typeof(v_request->'source') IS DISTINCT FROM 'object'
                OR EXISTS(SELECT 1 FROM jsonb_object_keys(v_request->'source') k WHERE k NOT IN ('namespace','key','evidenceHash','amount','currency','rawEvidence'))
                OR jsonb_typeof(v_request->'source'->'rawEvidence') IS DISTINCT FROM 'object'
                OR jsonb_typeof(v_request->'parts') IS DISTINCT FROM 'array' THEN
                RAISE EXCEPTION 'Contrato de retiro no admitido; no se admiten fees, FX o traslados de derechos.';
            END IF;
            external_id:=(v_request->>'externalUuid')::uuid;
            actor:=(v_request->>'actorUserId')::integer;
            account_id:=(v_request->>'accountId')::integer;
            currency_id:=(v_request->>'currencyId')::integer;
            total:=(v_request->>'amount')::numeric;
            description_value:=v_request->>'description';
            namespace_value:=v_request->'source'->>'namespace';
            key_value:=v_request->'source'->>'key';
            evidence_hash:=v_request->'source'->>'evidenceHash';
            event_date:=(v_request->>'occurredAt')::timestamptz;
            documentary:=(v_request->>'documentaryOdt')::integer;
            IF external_id IS NULL OR actor IS NULL OR actor<=0 OR account_id IS NULL OR account_id<=0
                OR currency_id IS NULL OR currency_id<=0 OR total IS NULL OR NOT(total>0 AND total<1e20)
                OR total<>round(total,10) OR description_value IS NULL OR length(trim(description_value))=0 OR length(description_value)>512
                OR namespace_value IS NULL OR length(trim(namespace_value))=0 OR length(namespace_value)>240
                OR key_value IS NULL OR length(trim(key_value))=0 OR length(key_value)>240
                OR evidence_hash IS NULL OR evidence_hash !~ '^[0-9a-f]{64}$'
                OR (v_request->'source'->>'currency') IS DISTINCT FROM 'USD'
                OR (v_request->'source'->>'amount') IS NULL OR (v_request->'source'->>'amount')::numeric<>-total
                OR (documentary IS NOT NULL AND documentary<=0) OR jsonb_array_length(v_request->'parts') NOT BETWEEN 1 AND 100 THEN
                RAISE EXCEPTION 'Importe, identidad o fuente del retiro invalidos.';
            END IF;
            IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_request->'parts') p WHERE jsonb_typeof(p)<>'object'
                OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN ('userId','entityId','amount'))
                OR (p->>'userId') IS NULL OR (p->>'userId')::integer<=0 OR (p->>'entityId') IS NULL OR (p->>'entityId')::integer<=3
                OR (p->>'amount') IS NULL OR NOT((p->>'amount')::numeric>0 AND (p->>'amount')::numeric<1e20)
                OR (p->>'amount')::numeric<>round((p->>'amount')::numeric,10))
                OR (SELECT sum((p->>'amount')::numeric) FROM jsonb_array_elements(v_request->'parts') p) IS DISTINCT FROM total
                OR (SELECT count(DISTINCT p->>'userId') FROM jsonb_array_elements(v_request->'parts') p)<>jsonb_array_length(v_request->'parts')
                OR (SELECT count(DISTINCT p->>'entityId') FROM jsonb_array_elements(v_request->'parts') p)<>jsonb_array_length(v_request->'parts') THEN
                RAISE EXCEPTION 'Los destinatarios User deben sumar exactamente el retiro, sin duplicados.';
            END IF;

            PERFORM pg_advisory_xact_lock(1791687,hashtext(external_id::text));
            PERFORM pg_advisory_xact_lock(1791688,hashtext(namespace_value||':'||key_value));
            PERFORM 1 FROM users u WHERE u.user_id=actor OR u.user_id IN
                (SELECT (p->>'userId')::integer FROM jsonb_array_elements(v_request->'parts') p) ORDER BY u.user_id FOR SHARE;
            IF NOT EXISTS(SELECT 1 FROM users WHERE user_id=actor AND username='master' AND special_user IS TRUE) THEN
                RAISE EXCEPTION 'Solo un usuario tecnico master puede registrar este retiro.' USING ERRCODE='42501';
            END IF;
            SELECT a.id_currency,upper(c.code) INTO account_currency,currency_code FROM accounts a JOIN currencys c USING(id_currency)
                WHERE a.id_account=account_id FOR SHARE OF a,c;
            IF NOT FOUND OR account_currency IS DISTINCT FROM currency_id OR currency_code IS DISTINCT FROM 'USD' THEN
                RAISE EXCEPTION 'El retiro simple solo admite la moneda USD real de la cuenta.';
            END IF;
            SELECT * INTO previous FROM profit_withdrawals WHERE external_uuid=external_id;
            IF FOUND THEN
                IF previous.request_digest IS DISTINCT FROM v_digest OR previous.request_body IS DISTINCT FROM v_request THEN
                    RAISE EXCEPTION 'El UUID externo ya existe con otra fuente o datos.';
                END IF;
                RETURN profit_withdrawal_result(previous.id_profit_withdrawal);
            END IF;
            IF EXISTS(SELECT 1 FROM profit_withdrawals WHERE source_namespace=namespace_value AND source_key=key_value) THEN
                RAISE EXCEPTION 'La celda de origen ya fue consumida por otro retiro.';
            END IF;
            -- Lock every real wallet before admitting credit evidence or debiting any recipient.
            FOR recipient IN SELECT (p->>'userId')::integer AS user_id,(p->>'entityId')::integer AS entity_id,
                (p->>'amount')::numeric AS amount FROM jsonb_array_elements(v_request->'parts') p ORDER BY (p->>'entityId')::integer LOOP
                SELECT id_entity INTO user_entity FROM users WHERE user_id=recipient.user_id;
                IF user_entity IS DISTINCT FROM recipient.entity_id OR (SELECT count(*) FROM users WHERE id_entity=recipient.entity_id)<>1 THEN
                    RAISE EXCEPTION 'El destinatario no coincide con la entidad contable User.';
                END IF;
                SELECT b.* INTO wallet FROM balances b WHERE b.id_account=account_id AND b.id_entity=recipient.entity_id FOR UPDATE;
                IF NOT FOUND OR wallet.balance<recipient.amount THEN RAISE EXCEPTION 'Saldo real del usuario insuficiente en la cuenta.'; END IF;
                IF EXISTS(SELECT 1 FROM balance_movements m WHERE m.id_balance=wallet.id_balance AND m.amount<0
                    AND m.type_movement_category<>'profit_withdrawals') THEN
                    RAISE EXCEPTION 'La cuenta User tiene egresos de otras categorias; requiere revision de derechos.';
                END IF;
            END LOOP;
            INSERT INTO profit_withdrawals(external_uuid,source_namespace,source_key,source_evidence_hash,request_digest,request_body,
                id_actor_user,id_account,id_currency,amount,description,documentary_odt,occurred_at)
                VALUES(external_id,namespace_value,key_value,evidence_hash,v_digest,v_request,actor,account_id,currency_id,
                    total,description_value,documentary,event_date) RETURNING id_profit_withdrawal INTO withdrawal_id;
            FOR recipient IN SELECT (p->>'userId')::integer AS user_id,(p->>'entityId')::integer AS entity_id,
                (p->>'amount')::numeric AS amount FROM jsonb_array_elements(v_request->'parts') p ORDER BY (p->>'entityId')::integer LOOP
                SELECT * INTO STRICT wallet FROM balances WHERE id_account=account_id AND id_entity=recipient.entity_id;
                FOR credit IN SELECT m.* FROM balance_movements m WHERE m.id_balance=wallet.id_balance
                    AND m.type_movement_category='closure_odts' AND m.amount>0 ORDER BY m.id_balance_movement FOR SHARE LOOP
                    INSERT INTO profit_credit_journals(id_balance_movement,id_closure_odt,id_balance,id_account,id_currency,id_user,id_entity,amount)
                        VALUES(credit.id_balance_movement,credit.id_movement_category,credit.id_balance,account_id,currency_id,
                            recipient.user_id,recipient.entity_id,credit.amount) ON CONFLICT(id_balance_movement) DO NOTHING;
                END LOOP;
                SELECT coalesce(sum(amount),0) INTO earned FROM profit_credit_journals WHERE id_balance=wallet.id_balance;
                SELECT coalesce(sum(amount),0) INTO paid FROM profit_withdrawal_parts WHERE id_balance=wallet.id_balance;
                rights_before:=earned-paid;
                IF rights_before<recipient.amount THEN RAISE EXCEPTION 'Comisiones devengadas y no retiradas insuficientes en esta cuenta USD.'; END IF;
                INSERT INTO profit_withdrawal_credit_sources(id_profit_withdrawal,id_balance_movement)
                    SELECT withdrawal_id,id_balance_movement FROM profit_credit_journals WHERE id_balance=wallet.id_balance ORDER BY id_balance_movement;
                part_id:=nextval(pg_get_serial_sequence('profit_withdrawal_parts','id_profit_withdrawal_part'));
                SELECT * INTO cash_movement FROM alter_balance(wallet.id_balance,-recipient.amount,part_id,'profit_withdrawals');
                INSERT INTO profit_withdrawal_parts(id_profit_withdrawal_part,id_profit_withdrawal,id_user,id_entity,id_balance,amount,
                    earned_before,earned_after,id_balance_movement) VALUES(part_id,withdrawal_id,recipient.user_id,recipient.entity_id,
                        wallet.id_balance,recipient.amount,rights_before,rights_before-recipient.amount,cash_movement.id_balance_movement);
            END LOOP;
            IF (SELECT sum(amount) FROM profit_withdrawal_parts WHERE id_profit_withdrawal=withdrawal_id) IS DISTINCT FROM total THEN
                RAISE EXCEPTION 'El retiro no conserva el importe de la fuente original.';
            END IF;
            RETURN profit_withdrawal_result(withdrawal_id);
        END;
        $body$;
    `);
};

exports.down = pgm => {
    pgm.sql(`
        DO $body$ BEGIN
            IF EXISTS(SELECT 1 FROM profit_withdrawals) OR EXISTS(SELECT 1 FROM profit_credit_journals) THEN
                RAISE EXCEPTION 'No se puede retirar el registro de utilidades con historial contabilizado.';
            END IF;
        END $body$;
        DO $body$
        DECLARE table_name text;
        BEGIN
            FOREACH table_name IN ARRAY ARRAY['profit_withdrawals','profit_withdrawal_parts','profit_credit_journals',
                'profit_withdrawal_credit_sources','balance_movements','closure_odt_allocations','closure_odts',
                'closure_odt_parts','closure_odt_part_commissions','admin_closure_odts','operative_closure_odts',
                'supervisor_closure_odts','ceo_closure_odts','balances','accounts','users','currencys','entitys'] LOOP
                EXECUTE format('DROP TRIGGER protect_profit_withdrawal_history ON %I',table_name);
                EXECUTE format('DROP TRIGGER protect_profit_withdrawal_truncate ON %I',table_name);
            END LOOP;
        END;
        $body$;
        DROP TRIGGER verify_profit_credit_journal ON profit_credit_journals;
        DROP TRIGGER verify_profit_withdrawal_part ON profit_withdrawal_parts;
        DROP TRIGGER verify_profit_withdrawal_credit_source ON profit_withdrawal_credit_sources;
        DO $body$
        DECLARE table_name text;
        BEGIN
            FOREACH table_name IN ARRAY ARRAY['balance_movements','closure_odt_allocations','closure_odt_part_commissions',
                'admin_closure_odts','operative_closure_odts','supervisor_closure_odts','ceo_closure_odts'] LOOP
                EXECUTE format('DROP TRIGGER protect_used_profit_credit_insert ON %I',table_name);
            END LOOP;
        END;
        $body$;
        DROP FUNCTION register_profit_withdrawal(jsonb,text);
        DROP FUNCTION profit_withdrawal_result(integer);
        DROP FUNCTION protect_used_profit_credit_insert();
        DROP FUNCTION verify_profit_withdrawal_credit_source();
        DROP FUNCTION verify_profit_withdrawal_part();
        DROP FUNCTION protect_profit_withdrawal_history();
        DROP FUNCTION verify_profit_credit_journal();
        DROP TABLE profit_withdrawal_credit_sources;
        DROP TABLE profit_withdrawal_parts;
        DROP TABLE profit_credit_journals;
        DROP TABLE profit_withdrawals;
    `);
};
