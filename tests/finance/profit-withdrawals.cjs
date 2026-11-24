const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { Client } = require('pg');
const migrate = require('node-pg-migrate').default;
const { loadSource } = require('../helpers/source');
const repo = path.resolve(__dirname, '../..');
const { prepareProfitWithdrawal, registerProfitWithdrawal } = loadSource('lib/profit-withdrawals');
const { settlementSource, settleOdt } = loadSource('lib/odt-settlement-data');
const { initialSettlement } = loadSource('lib/odt-settlement');
const schemaMigration = require('../../migrations/1791687000000_profit-withdrawals.js');
const categoryMigration = require('../../migrations/1791686000000_profit-withdrawals-category.js');
const supplementMigration = require('../../migrations/1791690002000_historical-profit-supplement-credits.js');
const fixtureName = 'taionca_test_profit_withdrawals_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
const base = process.env.TEST_ADMIN_DATABASE_URL;
assert(base, 'Set TEST_ADMIN_DATABASE_URL to a disposable local PostgreSQL cluster.');
const adminUrl = new URL(base); adminUrl.pathname = '/postgres';
const fixtureUrl = new URL(base); fixtureUrl.pathname = '/' + fixtureName;
assert(['postgres:', 'postgresql:'].includes(fixtureUrl.protocol) &&
    ['localhost', '127.0.0.1', '[::1]'].includes(fixtureUrl.hostname) &&
    !fixtureUrl.search && !fixtureUrl.hash, 'Only a local isolated database is permitted');
assert(/^taionca_test_profit_withdrawals_\d+_[0-9a-f]{8}$/.test(fixtureName));
const admin = new Client({ connectionString: adminUrl.toString() });
const client = new Client({ connectionString: fixtureUrl.toString() });
const peers = [];
let created = false;
let connected = false;
let checks = 0;
const equal = (actual, expected, label) => { assert.deepStrictEqual(actual, expected, label); checks++; };
const check = (condition, label) => { assert(condition, label); checks++; };
const rejects = async (operation, pattern) => { await assert.rejects(operation, pattern); checks++; };
const throws = (operation, pattern) => { assert.throws(operation, pattern); checks++; };
const rows = async (sql, values = []) => (await client.query(sql, values)).rows;
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : [4, 2, 2, 2, 6].map(size => crypto.randomBytes(size).toString('hex')).join('-');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
let actor;
let usd;
let recipient;
let secondRecipient;
let customer;
let sourceSequence = 0;
function event(accountId, overrides = {}) {
    const rawEvidence = { amount: '-10', description: 'Retiro USD fixture', row: ++sourceSequence };
    return {
        externalUuid: uuid(), actorUserId: actor, accountId, currencyId: usd, amount: '10',
        description: 'Retiro de utilidad fixture', documentaryOdt: null, occurredAt: null,
        source: { namespace: 'profit-withdrawal-fixture', key: 'fixture:C' + sourceSequence,
            currency: 'USD', amount: '-10', evidenceHash: hash(rawEvidence), rawEvidence },
        parts: [{ userId: recipient.user_id, entityId: recipient.id_entity, amount: '10' }], ...overrides
    };
}
function amountEvent(accountId, amount, parts, overrides = {}) {
    const value = event(accountId, overrides);
    const rawEvidence = { amount: '-' + amount, description: 'Retiro USD fixture', row: sourceSequence };
    return { ...value, amount, parts: parts || [{ userId: recipient.user_id, entityId: recipient.id_entity, amount }],
        source: { ...value.source, amount: '-' + amount, rawEvidence, evidenceHash: hash(rawEvidence) } };
}
async function account(name, currency = usd) {
    return (await rows('INSERT INTO accounts(id_currency,name) VALUES($1,$2) RETURNING id_account', [currency, name]))[0].id_account;
}
async function cash(accountId, entity = recipient.id_entity) {
    const row = (await rows('SELECT balance FROM balances WHERE id_account=$1 AND id_entity=$2', [accountId, entity]))[0];
    return row ? row.balance : null;
}
async function counts() {
    return (await rows(`SELECT (SELECT count(*) FROM profit_withdrawals)::int AS headers,
        (SELECT count(*) FROM profit_withdrawal_parts)::int AS parts,(SELECT count(*) FROM profit_credit_journals)::int AS proofs,
        (SELECT count(*) FROM profit_withdrawal_credit_sources)::int AS links,(SELECT count(*) FROM balance_movements)::int AS journals,
        (SELECT count(*) FROM balance_registers)::int AS snapshots`))[0];
}
async function topup(accountId, user, amount) {
    await client.query('INSERT INTO balances(id_account,id_entity) VALUES($1,$2) ON CONFLICT(id_account,id_entity) DO NOTHING', [accountId, user.id_entity]);
    const income = (await rows('INSERT INTO incomes(id_user,id_account,id_entity,amount,description) VALUES($1,$2,$3,$4,$5) RETURNING id_income',
        [actor, accountId, user.id_entity, amount, 'Personal opening fixture, not commission']))[0];
    await client.query("SELECT alter_balance(id_balance,$3,$4,'incomes') FROM balances WHERE id_account=$1 AND id_entity=$2",
        [accountId, user.id_entity, amount, income.id_income]);
}
async function earn(accountId, includeSecond = true, commit = true, primaryRecipient = recipient) {
    await client.query('BEGIN');
    try {
        const odt = (await rows(`INSERT INTO odts(id_client,id_user,id_currency,id_entity,amount,description,admin_percent)
            VALUES($1,$2,$3,1,100,'Native committed commission fixture',0.1) RETURNING id_odt`, [customer, actor, usd]))[0];
        await client.query("SELECT register_odt_payment_amount($1,$2,$3,100,100,'Native fixture receipt',$4)", [odt.id_odt, accountId, actor, uuid()]);
        const source = await settlementSource(client, odt.id_odt, actor);
        const input = initialSettlement(source, 'single', usd);
        input.id_account = accountId;
        input.parts[0].ceo_percent = '0';
        input.parts[0].operative_users = [{ id_user: primaryRecipient.user_id, profit_percent: '0.5' }];
        if (includeSecond) input.parts[0].operative_users.push({ id_user: secondRecipient.user_id, profit_percent: '0.25' });
        const closure = await settleOdt(client, input, actor);
        if (commit) await client.query('COMMIT');
        return closure;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}
async function earnSplit(firstAccount, secondAccount) {
    await client.query('BEGIN');
    try {
        const odt = (await rows(`INSERT INTO odts(id_client,id_user,id_currency,id_entity,amount,description,admin_percent)
            VALUES($1,$2,$3,1,100,'Native multi-account commission fixture',0.1) RETURNING id_odt`, [customer, actor, usd]))[0];
        for (const accountId of [firstAccount, secondAccount]) {
            await client.query("SELECT register_odt_payment_amount($1,$2,$3,50,50,'Native fixture receipt',$4)", [odt.id_odt, accountId, actor, uuid()]);
        }
        const source = await settlementSource(client, odt.id_odt, actor);
        const input = initialSettlement(source, 'split', usd);
        input.parts[0].ceo_percent = '0';
        input.parts[0].operative_users = [{ id_user: recipient.user_id, profit_percent: '0.5' }];
        await settleOdt(client, input, actor);
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}
async function earnLegacy(accountId, presidentId) {
    await client.query('BEGIN');
    try {
        const odt = (await rows(`INSERT INTO odts(id_client,id_user,id_currency,id_entity,amount,description,admin_percent)
            VALUES($1,$2,$3,1,100,'Native legacy commission fixture',0.1) RETURNING id_odt`, [customer, actor, usd]))[0];
        await client.query("SELECT register_odt_payment($1,$2,$3,100,1,'Native fixture receipt',$4)", [odt.id_odt, accountId, actor, uuid()]);
        await client.query("SELECT closure_odt(NULL,$1,$2,100,$3,'[]'::json,$4::json,'[]'::json,0.1,0)",
            [odt.id_odt, actor, presidentId, JSON.stringify([{ id_user: recipient.user_id, profit_percent: 0.5 }])]);
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
}
async function schema(direction, migration = schemaMigration) {
    const statements = [];
    migration[direction]({ sql(value) { statements.push(value); } });
    await client.query('BEGIN');
    try { for (const statement of statements) await client.query(statement); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
}

(async () => {
    let noTransaction = false;
    categoryMigration.up({ noTransaction() { noTransaction = true; }, sql(statement) { check(statement.includes('profit_withdrawals'), 'Enum migration only adds its category'); } });
    check(noTransaction, 'Enum migration commits separately');
    await admin.connect();
    await admin.query('CREATE DATABASE "' + fixtureName + '"'); created = true;
    await client.connect(); connected = true;
    if (!(await rows("SELECT to_regprocedure('pg_catalog.array_cat(anyarray,anyarray)') AS f"))[0].f) {
        await client.query('CREATE FUNCTION public.array_cat(anyarray,anyarray) RETURNS anyarray LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $body$ SELECT pg_catalog.array_cat($1,$2); $body$');
    }
    const migrations = await migrate({ databaseUrl: fixtureUrl.toString(), dir: path.join(repo, 'migrations'), direction: 'up', singleTransaction: true,
        migrationsTable: 'pgmigrations', log() {}, logger: { info() {}, warn() {}, error() {} } });
    check(migrations.some(item => item.name === '1791687000000_profit-withdrawals'), 'Schema migration applied after committed enum');
    await schema('down', supplementMigration); await schema('down');
    await schema('up'); await schema('up', supplementMigration); checks++;
    actor = (await rows("SELECT user_id FROM users WHERE username='master' AND special_user IS TRUE"))[0].user_id;
    usd = (await rows("SELECT id_currency FROM currencys WHERE upper(code)='USD' ORDER BY id_currency LIMIT 1"))[0].id_currency;
    [recipient, secondRecipient] = await rows('SELECT user_id,id_entity FROM users WHERE id_entity>3 AND special_user IS FALSE ORDER BY user_id LIMIT 2');
    check(recipient && secondRecipient, 'Two distinct native User wallets exist');
    for (const [table, column] of [['accounts', 'id_account'], ['clients', 'id_client'], ['odts', 'id_odt']]) {
        await client.query('SELECT setval(pg_get_serial_sequence($1,$2),coalesce((SELECT max("' + column + '") FROM "' + table + '"),1),true)', [table, column]);
    }
    customer = (await rows("INSERT INTO clients(name) VALUES('Withdrawal fixture customer') RETURNING id_client"))[0].id_client;

    const basic = await account('Withdrawal fixture basic');
    const initial = event(basic);
    equal(prepareProfitWithdrawal(initial).request.amount, '10.0000000000', 'Decimal normalization');
    throws(() => prepareProfitWithdrawal({ ...initial, fees: '1' }), /no admitidos/);
    throws(() => prepareProfitWithdrawal({ ...initial, exchangeRate: '1' }), /no admitidos/);
    throws(() => prepareProfitWithdrawal({ ...initial, source: { ...initial.source, currency: 'VES' } }), /negativo en USD/);
    throws(() => prepareProfitWithdrawal({ ...initial, source: { ...initial.source, amount: '10' } }), /negativo en USD/);
    throws(() => prepareProfitWithdrawal({ ...initial, source: { ...initial.source, evidenceHash: '0'.repeat(64) } }), /hash/);
    throws(() => prepareProfitWithdrawal({ ...initial, amount: '10.00000000001' }), /decimales/);
    throws(() => prepareProfitWithdrawal({ ...initial, occurredAt: '2026-02-30T12:00:00Z' }), /zona horaria/);
    throws(() => prepareProfitWithdrawal({ ...initial, parts: [initial.parts[0], initial.parts[0]] }), /repetido/);
    throws(() => prepareProfitWithdrawal({ ...initial, parts: [{ ...initial.parts[0], amount: '9' }] }), /exactamente/);
    const closure = await earn(basic);
    equal(await cash(basic), '45.0000000000', 'A committed native closure earns real cash rights');
    const before = await counts();
    const result = await registerProfitWithdrawal(client, initial);
    equal(result.amount, '10.0000000000', 'Original full withdrawal amount');
    equal(result.parts[0].earnedBefore, '45.0000000000', 'Only earned native commissions count');
    equal(result.parts[0].earnedAfter, '35.0000000000', 'Unpaid rights decrease exactly');
    equal(await cash(basic), '35.0000000000', 'Only beneficiary wallet cash decreases');
    const after = await counts();
    equal(after.journals - before.journals, 1, 'Exactly one real cash movement');
    equal(after.snapshots - before.snapshots, 1, 'Exactly one native cash snapshot');
    equal(result.occurredAt, null, 'Unknown historical dates remain null');
    equal(await registerProfitWithdrawal(client, initial), result, 'Replay returns the immutable original result');
    equal(await counts(), after, 'Replay creates no rows or cash movements');
    equal(await cash(basic), '35.0000000000', 'Replay does not debit cash');
    const changed = { amount: '-10', description: 'Changed source', row: sourceSequence };
    await rejects(() => registerProfitWithdrawal(client, { ...initial, source: { ...initial.source, rawEvidence: changed, evidenceHash: hash(changed) } }), /otra fuente o datos/);
    await rejects(() => registerProfitWithdrawal(client, { ...initial, externalUuid: uuid() }), /ya fue consumida/);
    await rejects(() => registerProfitWithdrawal(client, event(basic, { actorUserId: recipient.user_id })), /master/);
    const president = (await rows("SELECT user_id FROM users WHERE username='presidente'"))[0];
    await rejects(() => registerProfitWithdrawal(client, event(basic, { actorUserId: president.user_id })), /master/);
    await rejects(() => registerProfitWithdrawal(client, event(basic, { parts: [{ userId: recipient.user_id, entityId: secondRecipient.id_entity, amount: '10' }] })), /entidad contable/);
    const ves = (await rows("SELECT id_currency FROM currencys WHERE upper(code)='VES' ORDER BY id_currency LIMIT 1"))[0];
    await rejects(() => registerProfitWithdrawal(client, event(basic, { currencyId: ves.id_currency })), /moneda USD/);
    equal(await counts(), after, 'Rejected replay and identities have no side effects');
    const nullCode = (await rows("INSERT INTO currencys(name_singular,code) VALUES('Unknown currency fixture',NULL) RETURNING id_currency"))[0];
    const unknownCurrencyAccount = await account('Withdrawal fixture unknown currency', nullCode.id_currency);
    await rejects(() => registerProfitWithdrawal(client, event(unknownCurrencyAccount, { currencyId: nullCode.id_currency })), /moneda USD/);
    const unsafeRequest = prepareProfitWithdrawal(event(basic));
    await rejects(() => client.query('SELECT register_profit_withdrawal($1::jsonb,$2)',
        [JSON.stringify({ ...unsafeRequest.request, fees: '1' }), unsafeRequest.digest]), /fees, FX/);
    await rejects(() => client.query('SELECT register_profit_withdrawal($1::jsonb,$2)',
        [JSON.stringify({ ...unsafeRequest.request, reallocation: [] }), unsafeRequest.digest]), /fees, FX/);
    const mixed = amountEvent(basic, '3.7500000000', [
        { userId: secondRecipient.user_id, entityId: secondRecipient.id_entity, amount: '2.5' },
        { userId: recipient.user_id, entityId: recipient.id_entity, amount: '1.25' }
    ], { documentaryOdt: 248 });
    const split = await registerProfitWithdrawal(client, mixed);
    equal(split.parts.length, 2, 'A single source can have explicit recipients');
    equal(split.documentaryOdt, 248, 'Source ODT is metadata only, not a payout attribution');
    equal(await cash(basic), '33.7500000000', 'First recipient exact cash');
    equal(await cash(basic, secondRecipient.id_entity), '20.0000000000', 'Second recipient exact cash');
    equal(await registerProfitWithdrawal(client, { ...mixed, parts: mixed.parts.slice().reverse() }), split, 'Recipient order does not change canonical replay');

    const proof = (await rows('SELECT * FROM profit_credit_journals WHERE id_balance=$1', [result.parts[0].balanceId]))[0];
    await rejects(() => client.query('UPDATE balance_movements SET amount=amount+1 WHERE id_balance_movement=$1', [proof.id_balance_movement]), /inmutable/);
    await rejects(() => client.query('DELETE FROM balance_movements WHERE id_balance_movement=$1', [proof.id_balance_movement]), /inmutable/);
    await rejects(() => client.query('UPDATE closure_odt_allocations SET amount=amount+1 WHERE id_closure_odt=$1 AND id_account=$2 AND id_entity=$3', [closure.id_closure_odt, basic, recipient.id_entity]), /inmutable/);
    await rejects(() => client.query('UPDATE closure_odts SET amount=amount+1 WHERE id_closure_odt=$1', [closure.id_closure_odt]), /inmutable/);
    await rejects(() => client.query('DELETE FROM closure_odt_allocations WHERE id_closure_odt=$1 AND id_account=$2 AND id_entity=$3', [closure.id_closure_odt, basic, recipient.id_entity]), /inmutable/);
    await rejects(() => client.query('DELETE FROM closure_odts WHERE id_closure_odt=$1', [closure.id_closure_odt]), /inmutable/);
    await rejects(() => client.query(`UPDATE closure_odt_part_commissions SET profit=profit+1 WHERE id_user=$1 AND id_part IN
        (SELECT id_part FROM closure_odt_parts WHERE id_closure_odt=$2)`, [recipient.user_id, closure.id_closure_odt]), /inmutable/);
    await rejects(() => client.query(`UPDATE closure_odt_parts SET gross_profit=gross_profit+1 WHERE id_closure_odt=$1`, [closure.id_closure_odt]), /inmutable/);
    await rejects(() => client.query('UPDATE accounts SET id_currency=$1 WHERE id_account=$2', [ves.id_currency, basic]), /inmutable|moneda/);
    await rejects(() => client.query('UPDATE users SET id_entity=$1 WHERE user_id=$2', [secondRecipient.id_entity, recipient.user_id]), /inmutable/);
    await rejects(() => client.query('UPDATE balances SET id_entity=$1 WHERE id_balance=$2', [secondRecipient.id_entity, proof.id_balance]), /inmutable/);
    await rejects(() => client.query('UPDATE currencys SET code=NULL WHERE id_currency=$1', [usd]), /inmutable/);
    await rejects(() => client.query('DELETE FROM profit_credit_journals WHERE id_balance_movement=$1', [proof.id_balance_movement]), /inmutable/);
    await rejects(() => client.query('UPDATE profit_withdrawals SET description=$1 WHERE id_profit_withdrawal=$2', ['Mutated history', result.idProfitWithdrawal]), /inmutable/);
    await rejects(() => client.query('DELETE FROM profit_withdrawal_parts WHERE id_profit_withdrawal=$1', [result.idProfitWithdrawal]), /inmutable/);
    await rejects(() => client.query('TRUNCATE profit_withdrawals CASCADE'), /inmutable/);
    const priorInsertCash = await cash(basic);
    await rejects(() => client.query("SELECT alter_balance($1,1,$2,'closure_odts')", [proof.id_balance, proof.id_closure_odt]), /ampliar/);
    equal(await cash(basic), priorInsertCash, 'Extra used credit insertion rolls back its cash change');
    await client.query('UPDATE accounts SET name=$1 WHERE id_account=$2', ['Display name may change', basic]);
    equal(await registerProfitWithdrawal(client, initial), result, 'Display identity updates do not change proof');

    const opening = await account('Withdrawal fixture opening only');
    await topup(opening, recipient, '100');
    const noRightsBefore = await counts();
    await rejects(() => registerProfitWithdrawal(client, event(opening)), /devengadas/);
    equal(await counts(), noRightsBefore, 'Personal opening cannot create rights or retained proofs');
    equal(await cash(opening), '100.0000000000', 'Personal opening cash untouched');
    await topup(basic, recipient, '100');
    const earnedInsufficient = await counts();
    await rejects(() => registerProfitWithdrawal(client, amountEvent(basic, '34')), /devengadas/);
    equal(await counts(), earnedInsufficient, 'Opening cannot replenish already consumed rights');
    const openingMovement = (await rows("SELECT m.* FROM balance_movements m JOIN balances b USING(id_balance) WHERE b.id_account=$1 AND m.type_movement_category='incomes'", [opening]))[0];
    await rejects(() => client.query(`INSERT INTO profit_credit_journals(id_balance_movement,id_closure_odt,id_balance,id_account,id_currency,id_user,id_entity,amount)
        VALUES($1,$2,$3,$4,$5,$6,$7,100)`, [openingMovement.id_balance_movement, closure.id_closure_odt, openingMovement.id_balance, opening, usd, recipient.user_id, recipient.id_entity]), /comision positiva/);
    await rejects(() => client.query(`INSERT INTO profit_credit_journals(id_balance_movement,id_closure_odt,id_balance,id_account,id_currency,id_user,id_entity,amount)
        VALUES($1,$2,$3,$4,$5,$6,$7,46)`, [proof.id_balance_movement, proof.id_closure_odt, proof.id_balance, basic, usd, recipient.user_id, recipient.id_entity]), /comision positiva/);

    const poor = await account('Withdrawal fixture insufficient cash'); await earn(poor, false);
    await client.query('UPDATE balances SET balance=1 WHERE id_account=$1 AND id_entity=$2', [poor, recipient.id_entity]);
    const poorBefore = await counts();
    await rejects(() => registerProfitWithdrawal(client, event(poor)), /Saldo real/);
    equal(await counts(), poorBefore, 'Real cash guard precedes any proof or header writes');
    const tainted = await account('Withdrawal fixture other debit'); await earn(tainted, false);
    const investment = (await rows('INSERT INTO investments(id_user,id_account,id_entity,amount,description) VALUES($1,$2,$3,1,$4) RETURNING id_investment', [actor, tainted, recipient.id_entity, 'Other debit fixture']))[0];
    await client.query("SELECT alter_balance(id_balance,-1,$3,'investments') FROM balances WHERE id_account=$1 AND id_entity=$2", [tainted, recipient.id_entity, investment.id_investment]);
    await rejects(() => registerProfitWithdrawal(client, event(tainted)), /otras categorias/);

    const unsettled = await account('Withdrawal fixture uncommitted');
    const preUncommitted = await counts();
    await earn(unsettled, false, false);
    await client.query('SAVEPOINT test_uncommitted');
    await rejects(() => registerProfitWithdrawal(client, event(unsettled)), /ya comprometida/);
    await client.query('ROLLBACK TO SAVEPOINT test_uncommitted');
    await client.query('ROLLBACK');
    equal(await counts(), preUncommitted, 'Uncommitted closure and withdrawal leave no rows');
    const rollbackAccount = await account('Withdrawal fixture rollback'); await earn(rollbackAccount, false);
    const rollbackBefore = await counts(); const rollbackCash = await cash(rollbackAccount);
    await client.query('BEGIN'); await registerProfitWithdrawal(client, event(rollbackAccount)); await client.query('ROLLBACK');
    equal(await counts(), rollbackBefore, 'Caller rollback removes header, proofs, parts, journal and snapshot');
    equal(await cash(rollbackAccount), rollbackCash, 'Caller rollback restores cash');
    const atomic = await account('Withdrawal fixture atomic recipients'); await earn(atomic, false); await topup(atomic, secondRecipient, '100');
    const atomicBefore = await counts(); const atomicCash = await cash(atomic);
    await rejects(() => registerProfitWithdrawal(client, amountEvent(atomic, '2', [
        { userId: recipient.user_id, entityId: recipient.id_entity, amount: '1' },
        { userId: secondRecipient.user_id, entityId: secondRecipient.id_entity, amount: '1' }
    ])), /devengadas/);
    equal(await counts(), atomicBefore, 'Failure of later recipient rolls back all earlier parts and proofs');
    equal(await cash(atomic), atomicCash, 'Atomic failure restores first recipient cash');
    const mismatch = await account('Withdrawal fixture mismatched allocation'); const mismatchClosure = await earn(mismatch, false);
    await client.query('UPDATE closure_odt_allocations SET amount=amount+1 WHERE id_closure_odt=$1 AND id_entity=$2', [mismatchClosure.id_closure_odt, recipient.id_entity]);
    await rejects(() => registerProfitWithdrawal(client, event(mismatch)), /exactamente con el reparto/);
    const badCommission = await account('Withdrawal fixture mismatched earned commission'); const badClosure = await earn(badCommission, false);
    await client.query('UPDATE closure_odt_part_commissions SET profit=profit+1 WHERE id_user=$1 AND id_part IN (SELECT id_part FROM closure_odt_parts WHERE id_closure_odt=$2)', [recipient.user_id, badClosure.id_closure_odt]);
    await rejects(() => registerProfitWithdrawal(client, event(badCommission)), /comisiones nativas/);
    const legacy = await account('Withdrawal fixture legacy native'); await earnLegacy(legacy, president.user_id);
    const legacyResult = await registerProfitWithdrawal(client, event(legacy));
    equal(legacyResult.parts[0].earnedBefore, '45.0000000000', 'Actual committed legacy native role profits are supported in their original USD');
    equal(await cash(legacy), '35.0000000000', 'Legacy closure rights debit the actual User wallet');
    const splitAccountA = await account('Withdrawal fixture split A');
    const splitAccountB = await account('Withdrawal fixture split B'); await earnSplit(splitAccountA, splitAccountB);
    const splitAccountResult = await registerProfitWithdrawal(client, event(splitAccountA));
    equal(splitAccountResult.parts[0].earnedBefore, '22.5000000000', 'Native split rights remain in their actual source account');
    equal(await cash(splitAccountB), '22.5000000000', 'Other account rights and cash are untouched');
    await topup(splitAccountA, recipient, '100');
    await rejects(() => registerProfitWithdrawal(client, amountEvent(splitAccountA, '13')), /devengadas/);
    equal(await cash(splitAccountB), '22.5000000000', 'A personal top-up does not relocate rights from another account');

    for (let i = 0; i < 2; i++) { const peer = new Client({ connectionString: fixtureUrl.toString() }); await peer.connect(); peers.push(peer); }
    const concurrent = await account('Withdrawal fixture concurrent'); await earn(concurrent, false);
    const attempts = await Promise.allSettled(peers.map(peer => registerProfitWithdrawal(peer, amountEvent(concurrent, '30'))));
    equal(attempts.filter(item => item.status === 'fulfilled').length, 1, 'Only one simultaneous excessive withdrawal succeeds');
    equal(attempts.filter(item => item.status === 'rejected').length, 1, 'The other simultaneous withdrawal rolls back');
    equal(await cash(concurrent), '15.0000000000', 'Concurrent withdrawals cannot overspend');
    equal((await rows('SELECT count(*)::int AS n FROM profit_withdrawals WHERE id_account=$1', [concurrent]))[0].n, 1, 'Concurrent loser creates no header');
    const concurrentReplay = await account('Withdrawal fixture concurrent replay'); await earn(concurrentReplay, false);
    const replayRequest = event(concurrentReplay);
    const replays = await Promise.all(peers.map(peer => registerProfitWithdrawal(peer, replayRequest)));
    equal(replays[0], replays[1], 'Simultaneous identical UUID returns one immutable result');
    equal(await cash(concurrentReplay), '35.0000000000', 'Concurrent replay debits once');

    const supplementAccount = await account('Historical supplement fixture');
    let [payee] = await rows('SELECT user_id,id_entity FROM users WHERE user_id=5');
    if (!payee) [payee] = await rows(`WITH wallet AS (INSERT INTO entitys(name) VALUES('Supplement fixture user') RETURNING id_entity)
        INSERT INTO users(user_id,username,password_hash,name,lastname,email,id_entity)
        SELECT 5,'supplement-fixture','unused','Fixture','Supplement','supplement-fixture@example.invalid',id_entity FROM wallet
        RETURNING user_id,id_entity`);
    const supplementClosure = await earn(supplementAccount, false, true, payee.user_id === recipient.user_id ? secondRecipient : recipient);
    const supplementRequest = amountEvent(supplementAccount, '7', [{ userId: payee.user_id, entityId: payee.id_entity, amount: '7' }]);
    await client.query('BEGIN');
    const [transfer] = await rows("INSERT INTO transfer_entitys(description) VALUES('Historical supplement fixture') RETURNING id_transfer_entity");
    await client.query('INSERT INTO balances(id_account,id_entity) VALUES($1,$2) ON CONFLICT(id_account,id_entity) DO NOTHING', [supplementAccount,payee.id_entity]);
    const transferLeg = async (entity, amount) => (await rows(`SELECT (alter_balance(id_balance,$3,$4,'transfer_entities')).id_balance_movement
        FROM balances WHERE id_account=$1 AND id_entity=$2`, [supplementAccount,entity,amount,transfer.id_transfer_entity]))[0].id_balance_movement;
    const debit = await transferLeg(1, '-10'), credit = await transferLeg(payee.id_entity, '10');
    const supplementSql = `INSERT INTO profit_supplement_credits(id_odt,id_closure_odt,role,id_user,id_entity,id_account,id_currency,
        id_transfer_entity,id_credit_movement,id_debit_movement,amount,source_key,evidence_hash)
        VALUES($1,$2,'operative',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING commission_percent`;
    const supplementArgs = [supplementClosure.id_odt,supplementClosure.id_closure_odt,payee.user_id,payee.id_entity,supplementAccount,usd,
        transfer.id_transfer_entity,credit,debit,'10','historical:fixture',hash({ credit })];
    await client.query('SAVEPOINT wrong_amount');
    await rejects(() => rows(supplementSql, supplementArgs.map((value, index) => index === 9 ? '9' : value)), /dos movimientos exactos/);
    await client.query('ROLLBACK TO SAVEPOINT wrong_amount');
    equal((await rows(supplementSql, supplementArgs))[0].commission_percent, '0.10000', 'Supplement records its historical role rate');
    await client.query('SAVEPOINT immature_supplement');
    await rejects(() => registerProfitWithdrawal(client, supplementRequest), /comprometida/);
    await client.query('ROLLBACK TO SAVEPOINT immature_supplement');
    await client.query('COMMIT');
    const historical = await registerProfitWithdrawal(client, supplementRequest);
    equal(historical.creditJournalIds, [credit], 'Committed supplement produces the exact native withdrawal proof link');
    equal(historical.parts[0].earnedAfter, '3.0000000000', 'A withdrawal spends only its exact amount of historical rights');
    equal(await cash(supplementAccount, payee.id_entity), '3.0000000000', 'Supplement withdrawal debits real recipient cash');
    await rejects(() => rows(supplementSql, supplementArgs), /duplicate key/);
    await rejects(() => transferLeg(payee.id_entity, '1'), /inmutable/);
    await rejects(() => rows('UPDATE balance_movements SET amount=amount+1 WHERE id_balance_movement=$1', [debit]), /inmutable/);
    await rejects(() => rows('UPDATE transfer_entitys SET description=$1 WHERE id_transfer_entity=$2', ['altered',transfer.id_transfer_entity]), /inmutable/);
    await rejects(() => rows('DELETE FROM profit_supplement_credits WHERE id_credit_movement=$1', [credit]), /inmutable/);
    await topup(supplementAccount, payee, '100');
    await rejects(() => registerProfitWithdrawal(client, amountEvent(supplementAccount, '4', [
        { userId: payee.user_id, entityId: payee.id_entity, amount: '4' }
    ])), /devengadas/);
    await rejects(() => schema('down', supplementMigration), /historial de complementos/);
    await rejects(() => schema('down'), /historial contabilizado/);
    equal((await rows("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN ('ledger_import','taionca_import')"))[0].n, 0, 'Fixture does not read or create OLD/NEW audit schemas');
    console.log(JSON.stringify({ status: 'passed', checks, fixture: fixtureName, migrations: migrations.length, realDatabaseWrites: 0 }));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; }).finally(async () => {
    for (const peer of peers) await peer.end().catch(() => {});
    if (connected) await client.end().catch(() => {});
    if (created) {
        await admin.query('DROP DATABASE "' + fixtureName + '"');
        const remains = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [fixtureName]);
        assert.strictEqual(remains.rowCount, 0, 'Owned fixture removed');
        console.log('Owned fixture removed and absence verified.');
    }
    await admin.end().catch(() => {});
});
