exports.up = pgm => {
    // PostgreSQL must commit the new enum value before the next migration uses it.
    pgm.noTransaction();
    pgm.sql("ALTER TYPE movement_category ADD VALUE IF NOT EXISTS 'profit_withdrawals';");
};

exports.down = () => {
    // A shared PostgreSQL enum value cannot be removed without replacing its type.
};
