exports.up = pgm => {
    pgm.sql`
        ALTER TYPE movement_category ADD VALUE IF NOT EXISTS 'opening_balance';
        CREATE TABLE account_openings (
            id_account_opening serial PRIMARY KEY,
            id_account integer NOT NULL REFERENCES accounts(id_account),
            id_entity integer NOT NULL REFERENCES entitys(id_entity),
            amount numeric(30,10) NOT NULL CHECK(amount>=0),
            source_key text NOT NULL UNIQUE,
            source_evidence jsonb NOT NULL,
            balance_before numeric(30,10) NOT NULL,
            balance_after numeric(30,10) NOT NULL,
            id_balance_movement integer REFERENCES balance_movements(id_balance_movement),
            created_at timestamptz NOT NULL DEFAULT current_timestamp,
            UNIQUE(id_account,id_entity),
            CHECK(balance_after=balance_before+amount)
        );
    `;
};
exports.down = pgm => {
    pgm.sql`
        DO $body$ BEGIN
            IF EXISTS(SELECT 1 FROM account_openings) THEN
                RAISE EXCEPTION 'No se puede retirar una apertura contabilizada.';
            END IF;
        END $body$;
        DROP TABLE account_openings;
    `;
};
