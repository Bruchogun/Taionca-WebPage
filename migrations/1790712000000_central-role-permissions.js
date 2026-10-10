const policy={legacy:{"users_create": ["users.create"], "users_read": ["users.read"], "odt_create": ["odts.create"], "odt_read": ["odts.read", "quotations.read"], "odt_update": ["odts.payments", "odts.close", "payroll.assign", "finance.transfer"], "admin_expenses_create": ["expenses.admin", "clients.manage"], "general_expenses_create": ["expenses.general"], "inv_odt_expenses_create": ["expenses.inventory"], "inv_purchases_create": ["inventory.purchase"], "stocks_read": ["inventory.read"], "stocks_create": ["inventory.create"], "storages_create": ["inventory.create"], "exchange_currency_create": ["finance.exchange", "expenses.admin"], "president": ["responsibilities.manage", "responsibilities.approve", "attendance.read_all", "payroll.pay", "odts.limits", "quotations.create", "finance.read", "finance.accounts", "finance.income", "finance.investment", "finance.loans"], "admin_expenses_read": ["finance.read"], "general_expenses_read": ["odts.read"], "inv_odt_expenses_read": ["odts.read"], "inv_purchases_read": ["inventory.read"], "storages_read": ["inventory.read"], "exchange_currency_read": ["finance.read"]}};
exports.up=pgm=>{
 pgm.sql(`ALTER TABLE permissions ADD COLUMN code varchar(128), ADD COLUMN description text NOT NULL DEFAULT '',
    ADD COLUMN capabilities text[] NOT NULL DEFAULT '{}', ADD COLUMN deleted_at timestamptz,
    ADD COLUMN is_system boolean NOT NULL DEFAULT false;
    UPDATE permissions SET code=name,is_system=true;
    ALTER TABLE permissions ALTER COLUMN code SET NOT NULL;
    ALTER TABLE permissions ADD CONSTRAINT permissions_code_unique UNIQUE(code);
    ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
    CREATE TABLE security_events(
      id_security_event bigserial PRIMARY KEY, actor_user_id integer REFERENCES users(user_id),
      action text NOT NULL, target_type text NOT NULL, target_id integer,
      before_data jsonb, after_data jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE login_attempts(key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT now());`);
 // Historical imports used explicit IDs. Keep future generated IDs above both
 // the imported records and the existing sequence, without changing any user.
 pgm.sql(`DO $$ DECLARE table_name text; id_column text; seq regclass; top_id bigint; last_id bigint; called boolean;
 BEGIN
   FOR table_name,id_column IN SELECT * FROM (VALUES ('users','user_id'),('roles','role_id'),('permissions','permission_id')) v(t,c) LOOP
     seq := pg_get_serial_sequence(table_name,id_column)::regclass;
     EXECUTE format('SELECT coalesce(max(%I),0) FROM %I',id_column,table_name) INTO top_id;
     EXECUTE format('SELECT last_value,is_called FROM %s',seq) INTO last_id,called;
     IF last_id < top_id OR (last_id = top_id AND NOT called) THEN PERFORM setval(seq,top_id,true); END IF;
   END LOOP;
 END $$;`);
 for(const [code,caps] of Object.entries(policy.legacy))pgm.sql(`UPDATE permissions SET capabilities=ARRAY[${caps.map(c=>"'"+c+"'").join(',')}]::text[] WHERE code='${code}';`);
};
exports.down=pgm=>{
 pgm.sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM security_events) THEN RAISE EXCEPTION 'No se puede revertir después de gestionar permisos; restaura el respaldo.'; END IF; END $$;
    DROP TABLE login_attempts;DROP TABLE security_events;
    ALTER TABLE users DROP COLUMN session_version;
    ALTER TABLE permissions DROP COLUMN code,DROP COLUMN description,DROP COLUMN capabilities,DROP COLUMN deleted_at,DROP COLUMN is_system;`);
};
