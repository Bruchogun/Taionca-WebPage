function previousFunction(file, name) {
    let source = '';
    require(file).up({ sql(value) { source += Array.isArray(value) ? value.join('') : value; } });
    const match = source.match(new RegExp('CREATE(?: OR REPLACE)? FUNCTION ' + name + '\\([\\s\\S]*?\\$body\\$;'));
    if (!match) throw new Error('Prior SQL function not found: ' + name);
    return match[0].replace(/^CREATE(?: OR REPLACE)? FUNCTION/, 'CREATE OR REPLACE FUNCTION');
}

function paymentFunctions(pgm, agreed) {
    for (const [file, name] of [
        ['./1790690000000_odt-payments', 'register_odt_payment'],
        ['./1790709000000_manual-currency-closures', 'register_odt_payment_amount']
    ]) {
        const original = previousFunction(file, name);
        pgm.sql(agreed ? original.split('selected_odt.amount').join('coalesce(selected_odt.settlement_amount,selected_odt.amount)') : original);
    }
    const closure = previousFunction('./1790690000000_odt-payments', 'closure_odt')
        .replace('FUNCTION closure_odt(', 'FUNCTION closure_odt_legacy(');
    const agreedClosure = closure.split('selected_odt.amount').join('coalesce(selected_odt.settlement_amount,selected_odt.amount)')
        .replace('SELECT count(*),coalesce(sum(amount_odt),0) INTO payment_count,paid_total', `IF selected_odt.settlement_amount IS NOT NULL AND v_amount IS DISTINCT FROM selected_odt.settlement_amount THEN
                RAISE EXCEPTION 'El monto del cierre debe coincidir con el importe final acordado.';
            END IF;
            SELECT count(*),coalesce(sum(amount_odt),0) INTO payment_count,paid_total`);
    pgm.sql(agreed ? agreedClosure : closure);
    let protection = previousFunction('./1790709000000_manual-currency-closures', 'protect_odt_payment_history');
    if (agreed) {
        protection = protection.replace('IF NEW.amount<', 'IF coalesce(NEW.settlement_amount,NEW.amount)<')
            .replace("ELSIF TG_TABLE_NAME='odts' THEN", `ELSIF TG_TABLE_NAME='odts' THEN
                IF OLD.amount IS DISTINCT FROM NEW.amount AND (OLD.settlement_amount IS NOT NULL OR NEW.settlement_amount IS NOT NULL) THEN
                    RAISE EXCEPTION 'El importe original de una ODT con importe final acordado se conserva.';
                END IF;
                IF OLD.settlement_amount IS DISTINCT FROM NEW.settlement_amount
                    AND EXISTS(SELECT 1 FROM closure_odts WHERE id_odt=OLD.id_odt) THEN
                    RAISE EXCEPTION 'No se puede cambiar el importe final de una ODT cerrada.';
                END IF;`);
    }
    pgm.sql(protection);
}

exports.up = pgm => {
    pgm.sql(`
        ALTER TABLE public.odts ADD COLUMN settlement_amount numeric(30,10)
            CHECK(settlement_amount IS NULL OR (settlement_amount>=0 AND settlement_amount<1e20));
        CREATE TABLE public.odt_settlement_targets (
            id_settlement_target bigserial PRIMARY KEY,
            id_odt integer NOT NULL REFERENCES public.odts(id_odt),
            id_user integer NOT NULL REFERENCES public.users(user_id),
            original_contract_amount numeric(30,10) NOT NULL,
            previous_settlement_amount numeric(30,10),
            settlement_amount numeric(30,10) NOT NULL CHECK(settlement_amount>=0 AND settlement_amount<1e20),
            reason varchar(512) NOT NULL CHECK(length(trim(reason))>0),
            source_key varchar(256) NOT NULL CHECK(length(trim(source_key))>0),
            source_json jsonb NOT NULL CHECK(jsonb_typeof(source_json)='object'),
            request_key uuid NOT NULL UNIQUE,
            created_at timestamptz NOT NULL DEFAULT current_timestamp,
            database_actor text NOT NULL DEFAULT current_user
        );
        CREATE INDEX odt_settlement_targets_odt ON public.odt_settlement_targets(id_odt,id_settlement_target);
        CREATE FUNCTION public.protect_odt_settlement_target_audit() RETURNS trigger LANGUAGE plpgsql AS $body$
        BEGIN
            RAISE EXCEPTION 'El historial de importes finales acordados es inmutable.';
        END;
        $body$;
        CREATE TRIGGER immutable_odt_target_audit BEFORE UPDATE OR DELETE ON public.odt_settlement_targets
            FOR EACH ROW EXECUTE FUNCTION public.protect_odt_settlement_target_audit();
        CREATE TRIGGER immutable_odt_target_truncate BEFORE TRUNCATE ON public.odt_settlement_targets
            FOR EACH STATEMENT EXECUTE FUNCTION public.protect_odt_settlement_target_audit();
        CREATE FUNCTION public.guard_odt_settlement_target() RETURNS trigger LANGUAGE plpgsql AS $body$
        DECLARE reference text; paid numeric;
        BEGIN
            IF TG_OP='INSERT' THEN
                IF NEW.settlement_amount IS NOT NULL THEN
                    RAISE EXCEPTION 'Registra primero el contrato y documenta su importe final con el importador.';
                END IF;
                RETURN NEW;
            END IF;
            IF OLD.settlement_amount IS NOT DISTINCT FROM NEW.settlement_amount THEN RETURN NEW; END IF;
            IF EXISTS(SELECT 1 FROM public.closure_odts WHERE id_odt=OLD.id_odt) THEN
                RAISE EXCEPTION 'No se puede cambiar el importe final de una ODT cerrada.';
            END IF;
            SELECT coalesce(sum(amount_odt),0) INTO paid FROM public.odt_payments WHERE id_odt=OLD.id_odt;
            IF NEW.settlement_amount IS NULL OR NEW.settlement_amount<paid THEN
                RAISE EXCEPTION 'El importe final no puede ser menor que los abonos recibidos.';
            END IF;
            reference:=current_setting('ledger_import.odt_target_request',true);
            IF reference IS NULL OR reference='' OR NOT EXISTS(
                SELECT 1 FROM public.odt_settlement_targets a WHERE a.request_key=reference::uuid
                    AND a.id_odt=OLD.id_odt AND a.original_contract_amount=OLD.amount
                    AND a.previous_settlement_amount IS NOT DISTINCT FROM OLD.settlement_amount
                    AND a.settlement_amount=NEW.settlement_amount) THEN
                RAISE EXCEPTION 'El cambio requiere motivo, actor y referencia de fuente registrados por el importador.';
            END IF;
            RETURN NEW;
        END;
        $body$;
        CREATE TRIGGER guard_agreed_odt_target BEFORE INSERT OR UPDATE OF settlement_amount ON public.odts
            FOR EACH ROW EXECUTE FUNCTION public.guard_odt_settlement_target();
        CREATE FUNCTION public.set_odt_settlement_amount(v_id_odt integer,v_amount numeric,v_id_user integer,
            v_reason text,v_source jsonb,v_request_key uuid) RETURNS bigint LANGUAGE plpgsql AS $body$
        DECLARE selected odts%ROWTYPE; prior odt_settlement_targets%ROWTYPE;
            paid numeric; reference bigint; source_key text; old_context text;
        BEGIN
            SELECT * INTO selected FROM public.odts WHERE id_odt=v_id_odt FOR UPDATE;
            IF NOT FOUND THEN RAISE EXCEPTION 'La ODT no existe.' USING ERRCODE='P0002'; END IF;
            IF v_id_user IS NULL OR NOT(selected.id_user=v_id_user OR selected.id_user=1 OR v_id_user IN(1,11)) THEN
                RAISE EXCEPTION 'No tienes acceso a esta ODT.' USING ERRCODE='42501';
            END IF;
            IF v_amount IS NULL OR v_amount::text IN('NaN','Infinity','-Infinity') OR v_amount<0 OR v_amount>=1e20 OR round(v_amount,10)<>v_amount THEN
                RAISE EXCEPTION 'El importe final debe ser no negativo y tener hasta 10 decimales.';
            END IF;
            source_key:=v_source->>'source_key';
            IF v_request_key IS NULL OR v_reason IS NULL OR length(trim(v_reason))=0 OR length(v_reason)>512
                OR v_source IS NULL OR jsonb_typeof(v_source)<>'object' OR source_key IS NULL
                OR length(trim(source_key))=0 OR length(source_key)>256 THEN
                RAISE EXCEPTION 'Documenta el motivo, la celda de fuente y la referencia del importe final.';
            END IF;
            SELECT * INTO prior FROM public.odt_settlement_targets WHERE request_key=v_request_key;
            IF FOUND THEN
                IF prior.id_odt=v_id_odt AND prior.id_user=v_id_user AND prior.settlement_amount=v_amount
                    AND prior.reason=v_reason AND prior.source_json=v_source THEN RETURN prior.id_settlement_target; END IF;
                RAISE EXCEPTION 'La referencia del importe final ya se utilizo con otros datos.' USING ERRCODE='23505';
            END IF;
            IF EXISTS(SELECT 1 FROM public.closure_odts WHERE id_odt=v_id_odt) THEN
                RAISE EXCEPTION 'La ODT ya esta cerrada. No se puede cambiar su importe final.' USING ERRCODE='23505';
            END IF;
            SELECT coalesce(sum(amount_odt),0) INTO paid FROM public.odt_payments WHERE id_odt=v_id_odt;
            IF v_amount<paid THEN RAISE EXCEPTION 'El importe final no puede ser menor que los abonos recibidos (%).',paid; END IF;
            INSERT INTO public.odt_settlement_targets(id_odt,id_user,original_contract_amount,previous_settlement_amount,
                settlement_amount,reason,source_key,source_json,request_key)
                VALUES(v_id_odt,v_id_user,selected.amount,selected.settlement_amount,v_amount,v_reason,source_key,v_source,v_request_key)
                RETURNING id_settlement_target INTO reference;
            old_context:=current_setting('ledger_import.odt_target_request',true);
            PERFORM set_config('ledger_import.odt_target_request',v_request_key::text,true);
            UPDATE public.odts SET settlement_amount=v_amount WHERE id_odt=v_id_odt;
            PERFORM set_config('ledger_import.odt_target_request',coalesce(old_context,''),true);
            RETURN reference;
        END;
        $body$;
    `);
    paymentFunctions(pgm, true);
};

exports.down = pgm => {
    pgm.sql(`DO $body$ BEGIN
        IF EXISTS(SELECT 1 FROM public.odt_settlement_targets) OR EXISTS(SELECT 1 FROM public.odts WHERE settlement_amount IS NOT NULL) THEN
            RAISE EXCEPTION 'No se puede revertir: existen importes finales documentados que se perderian.';
        END IF;
    END $body$;
    DROP TRIGGER guard_agreed_odt_target ON public.odts;
    DROP FUNCTION public.set_odt_settlement_amount(integer,numeric,integer,text,jsonb,uuid);
    DROP FUNCTION public.guard_odt_settlement_target();
    DROP TABLE public.odt_settlement_targets;
    DROP FUNCTION public.protect_odt_settlement_target_audit();`);
    paymentFunctions(pgm, false);
    pgm.sql('ALTER TABLE public.odts DROP COLUMN settlement_amount');
};
