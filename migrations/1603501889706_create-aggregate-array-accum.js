exports.up = pgm => {
    pgm.sql(`
        DO $migration$
        DECLARE
            array_type text := CASE
                WHEN to_regprocedure('pg_catalog.array_cat(anyarray,anyarray)') IS NOT NULL THEN 'anyarray'
                ELSE 'anycompatiblearray'
            END;
        BEGIN
            EXECUTE format($definition$
                CREATE FUNCTION array_sort_unique (%1$s) RETURNS %1$s
                LANGUAGE SQL AS $body$
                    SELECT ARRAY(
                        SELECT DISTINCT $1[s.i]
                        FROM generate_series(array_lower($1,1), array_upper($1,1)) AS s(i)
                        ORDER BY 1
                    );
                $body$;

                CREATE AGGREGATE array_merge_agg (%1$s) (
                    sfunc = pg_catalog.array_cat,
                    finalfunc = array_sort_unique,
                    stype = %1$s,
                    initcond = '{}'
                );
            $definition$, array_type);
        END;
        $migration$;
    `);
};

exports.down = pgm => {
    pgm.sql(`
        DROP AGGREGATE IF EXISTS array_merge_agg (anyarray);
        DROP FUNCTION IF EXISTS array_sort_unique (anyarray);
        DO $migration$
        BEGIN
            IF to_regtype('pg_catalog.anycompatiblearray') IS NOT NULL THEN
                DROP AGGREGATE IF EXISTS array_merge_agg (anycompatiblearray);
                DROP FUNCTION IF EXISTS array_sort_unique (anycompatiblearray);
            END IF;
        END;
        $migration$;
    `);
};
