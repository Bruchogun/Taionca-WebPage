const assert = require('assert').strict;

async function closureSnapshot(client, id) {
    const { rows: [closure] } = await client.query(`
        SELECT o.amount AS contract, c.amount AS received, c.id_closure_odt, c.id_account,
            c.general_expense, c.gross_profit, c.taionca_profit
        FROM closure_odts c JOIN odts o USING(id_odt) WHERE c.id_odt=$1`, [id]);
    const { rows: credits } = await client.query(`
        SELECT b.id_entity, m.amount FROM balance_movements m JOIN balances b USING(id_balance)
        WHERE m.type_movement_category='closure_odts' AND m.id_movement_category=$1
        ORDER BY b.id_entity`, [closure.id_closure_odt]);
    return { closure, credits };
}

async function exerciseLegacyClosure(client) {
    const { rows: [account] } = await client.query(`
        INSERT INTO accounts(id_account,id_currency,name) VALUES(700,1,'Historical fixture') RETURNING id_account`);
    await client.query(`
        INSERT INTO balances(id_account,id_entity) VALUES($1,1),($1,2),($1,4) ON CONFLICT DO NOTHING`, [account.id_account]);
    const { rows: [odt] } = await client.query(`
        INSERT INTO odts(id_client,id_user,id_currency,id_entity,amount,description,admin_percent)
        VALUES(1,1,1,1,1200,'Historical fixture',0.2) RETURNING id_odt`);
    await client.query(`
        INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,100,2,'Historical expense',1,7)`, [account.id_account, odt.id_odt]);
    const close = () => client.query(
        'SELECT closure_odt($1,$2,1,1000,2,$3::json,$3::json,$3::json,0.2,0.1)',
        [account.id_account, odt.id_odt, '[]']);
    assert.equal((await close()).rows[0].closure_odt, 'success');
    const snapshot = await closureSnapshot(client, odt.id_odt);
    assert.equal(snapshot.closure.contract, '1200.0000000000');
    assert.equal(snapshot.closure.received, '1000.0000000000');
    assert.deepEqual(snapshot.credits.map(row => [row.id_entity, row.amount]), [
        [1, '740.0000000000'], [2, '200.0000000000'], [4, '60.0000000000']
    ]);
    await assert.rejects(close, error => error.code === '23505');
    const { rows: [openOdt] } = await client.query(`
        INSERT INTO odts(id_client,id_user,id_currency,id_entity,amount,description,admin_percent)
        VALUES(1,1,1,1,500,'Historical expense fixture',0.2) RETURNING id_odt`);
    const { rows: [expense] } = await client.query(`
        INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,20,0,'Historical rate pending review',1,1) RETURNING id_general_expense,rate`,
        [account.id_account, openOdt.id_odt]);
    return { id: odt.id_odt, snapshot, accountId: account.id_account, openOdtId: openOdt.id_odt, expense };
}

async function testPermissionSequences(client, migratePermissions) {
    const records = [['users', 'user_id'], ['roles', 'role_id'], ['permissions', 'permission_id']];
    const expected = [];
    for (const [table, column] of records) {
        const { rows: [maximum] } = await client.query(`SELECT max("${column}") AS value FROM "${table}"`);
        const top = Number(maximum.value);
        const preserveHigher = table === 'roles';
        await client.query('SELECT setval(pg_get_serial_sequence($1,$2),$3,$4)',
            [table, column, preserveHigher ? top + 50 : 1, preserveHigher]);
        expected.push(preserveHigher ? top + 51 : top + 1);
    }
    await migratePermissions();
    for (const [index, [table, column]] of records.entries()) {
        const { rows: [actual] } = await client.query('SELECT nextval(pg_get_serial_sequence($1,$2)) AS value', [table, column]);
        assert.equal(Number(actual.value), expected[index], 'Sequence migration failed for ' + table);
    }
    console.log('Imported ID sequence checks passed');
}

async function assertHistoryPreserved(client, history) {
    assert.deepEqual(await closureSnapshot(client, history.id), history.snapshot);
    const { rows: [payments] } = await client.query('SELECT count(*)::int AS count FROM odt_payments WHERE id_odt=$1', [history.id]);
    assert.equal(payments.count, 0, 'A historical closure must not generate payments during migration.');
    const { rows: [historicalExpense] } = await client.query(
        'SELECT id_general_expense,rate FROM general_expenses WHERE id_general_expense=$1', [history.expense.id_general_expense]);
    assert.deepEqual(historicalExpense, history.expense, 'The migration must preserve the historical rate.');
    await assert.rejects(() => client.query(`
        INSERT INTO general_expenses(id_account,id_odt,amount,rate,description,id_measure,quantity)
        VALUES($1,$2,20,0,'Invalid new rate',1,1)`, [history.accountId, history.openOdtId]),
    error => error.constraint === 'valid_general_expense_rate');
    await assert.rejects(() => client.query(
        "SELECT closure_odt($1,$2,1,500,2,'[]','[]','[]',0.2,0.1)", [history.accountId, history.openOdtId]),
    error => error.code === 'P0001' && /costes historicos sin tasa/.test(error.message));
    console.log('Historical invalid rate preserved; new expenses and unsafe direct closure rejected.');
}

module.exports = { assertHistoryPreserved, exerciseLegacyClosure, testPermissionSequences };
