// Tests use only newly created databases in a disposable local cluster.
const { randomInt, randomBytes } = require('crypto');
const { spawnSync } = require('child_process');
const { readdirSync } = require('fs');
const path = require('path');
const { Client } = require('pg');
const migrate = require('node-pg-migrate').default;
const argon2 = require('argon2');
const { localPort, withTestCluster } = require('./test-cluster');
const { assertHistoryPreserved, exerciseLegacyClosure, testPermissionSequences } = require('./test-migrations');

const stages = ['unit', 'migrations', 'finance', 'security', 'ui', 'build', 'webkit'];
const unitTests = [
    'tests/finance/money-display.cjs',
    'tests/finance/settlement-net-profit.cjs',
    'tests/security/accounting-participant-login.cjs',
    'tests/security/loan-participants.cjs',
    'tests/security/odt-commission-supplements.cjs',
    'tests/security/unassigned-company-purchases.cjs'
];
const migrationDirectory = path.resolve('migrations');
const playwright = ['node_modules/@playwright/test/cli.js', 'test'];

function command(args, env) {
    const child = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
    if (child.error) throw child.error;
    if (child.status !== 0) throw new Error(args.join(' ') + ' failed (' + (child.status ?? child.signal) + ')');
}

async function withDatabase(source, task, port) {
    const name = 'taionca_test_odt_' + Date.now() + String(randomInt(1000000)).padStart(6, '0');
    const url = new URL(source);
    url.pathname = '/' + name;
    const admin = new Client({ connectionString: source.toString() });
    let created = false;
    try {
        await admin.connect();
        await admin.query('CREATE DATABASE "' + name + '"');
        created = true;
        console.log('Isolated database: ' + name);
        const env = {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: port === undefined ? '' : String(port),
            SECRET_SESSION: randomBytes(32).toString('hex'),
            DATABASE_URL: url.toString(),
            TEST_ADMIN_DATABASE_URL: source.toString(),
            TAIONCA_TEST_DATABASE: name,
            OPEN_EXCHANGE_RATES_APP_ID: '',
            ESM_DISABLE_CACHE: '1'
        };
        if (port !== undefined) env.PLAYWRIGHT_TEST_BASE_URL = 'http://127.0.0.1:' + env.PORT;
        await task(env);
    } finally {
        try {
            if (created) {
                await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
                await admin.query('DROP DATABASE "' + name + '"');
                console.log('Removed isolated database: ' + name);
            }
        } finally { await admin.end(); }
    }
}

function migrateUp(env, count) {
    return migrate({ databaseUrl: env.DATABASE_URL, dir: migrationDirectory, direction: 'up', count,
        migrationsTable: 'pgmigrations', log() {}, logger: { info() {}, warn() {}, error: console.error } });
}

async function testMigrations(env) {
    const files = readdirSync(migrationDirectory).filter(name => /^\d+_.*\.js$/.test(name)).sort();
    const legacyCount = files.findIndex(name => name.startsWith('1720296506624_')) + 1;
    const beforePermissions = files.findIndex(name => name.startsWith('1790712000000_'));
    if (!legacyCount || beforePermissions < legacyCount) throw new Error('Could not locate the legacy and permissions migration boundaries.');
    await migrateUp(env, legacyCount);
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    try {
        const history = await exerciseLegacyClosure(client);
        await migrateUp(env, beforePermissions - legacyCount);
        await testPermissionSequences(client, () => migrateUp(env, 1));
        await migrateUp(env);
        await assertHistoryPreserved(client, history);
        const { rows: [summary] } = await client.query('SELECT count(*)::int AS applied FROM pgmigrations');
        if (summary.applied !== files.length) throw new Error('Not all migrations were applied.');
        console.log('Upgrade from ' + legacyCount + ' to ' + summary.applied + ' migrations preserved the historical closure and ledger.');
    } finally { await client.end(); }
}

async function seed(env) {
    const applied = await migrateUp(env);
    console.log('Migrations passed: ' + applied.length);
    const client = new Client({ connectionString: env.DATABASE_URL });
    await client.connect();
    try {
        // The early fixtures use explicit IDs. Advance only the new test database's sequences.
        const { rows } = await client.query(`SELECT table_name,column_name FROM information_schema.columns
            WHERE table_schema='public' AND column_default LIKE 'nextval(%'`);
        for (const { table_name: table, column_name: column } of rows) {
            await client.query(`SELECT setval(pg_get_serial_sequence($1,$2),
                coalesce((SELECT max("${column}") FROM "${table}"),1),true)`, [table, column]);
        }
        const password = await argon2.hash('test-admin-odt');
        await client.query("UPDATE users SET username='admin',password_hash=$1 WHERE user_id=1", [password]);
        await client.query(`INSERT INTO join_roles_permissions(role_id,permission_id)
            SELECT 1,permission_id FROM permissions ON CONFLICT DO NOTHING`);
        for (let id = 201; id <= 204; id++) {
            const { rows: [entity] } = await client.query("INSERT INTO entitys(name) VALUES($1) RETURNING id_entity", ['Test user ' + id]);
            await client.query(`INSERT INTO users(user_id,username,password_hash,name,lastname,email,id_entity)
                VALUES($1,$2,$3,'Test','User',$4,$5)`, [id, 'test-user-' + id, password, id + '@test.invalid', entity.id_entity]);
        }
        await client.query("INSERT INTO accounts(id_currency,name) VALUES(1,'Destino ODT pruebas'),(1,'Otra cuenta pruebas')");
    } finally { await client.end(); }
}

async function main() {
    const args = process.argv.slice(2);
    const [mode, stage, ...extra] = args;
    const all = mode === '--all' || mode === '--build';
    const selected = mode === '--stage' ? stage : undefined;
    if (mode === '--stage' && !stages.includes(selected)) {
        throw new Error('Choose a test stage: ' + stages.join(', '));
    }
    if (all || selected === 'build') {
        console.log('Stage: build');
        command(['node_modules/sapper/sapper', 'build'], { ...process.env, ESM_DISABLE_CACHE: '1' });
        if (selected === 'build') return;
    }
    if (all || selected === 'unit') {
        console.log('Stage: unit');
        for (const test of unitTests) command([test], process.env);
        if (selected === 'unit') return;
    }
    await withTestCluster(source => runDatabaseStages(source, { all, selected, args, extra }));
}

async function runDatabaseStages(source, { all, selected, args, extra }) {
    if (all || selected === 'migrations') {
        console.log('Stage: migrations');
        await withDatabase(source, testMigrations);
        if (selected === 'migrations') return;
    }
    if (all || selected === 'finance') {
        console.log('Stage: finance database checks');
        command(['tests/finance/profit-withdrawals.cjs'], { ...process.env, TEST_ADMIN_DATABASE_URL: source.toString() });
    }
    const filters = {
        finance: ['tests/admin'],
        security: ['tests/security', 'admin\\.test\\.js$'],
        ui: ['tests/audit', 'close_odt.test.js', 'currency-settlement-page.test.js', 'odt-payments-page.test.js', 'money-display-page.test.js'],
        webkit: ['admin\\.test\\.js$', 'tests/security/ui.test.js', 'tests/audit/browser.test.js', 'tests/audit/ui-regressions.test.js', 'close_odt.test.js',
            'currency-settlement-page.test.js', 'odt-payments-page.test.js', 'money-display-page.test.js']
    };
    const port = process.env.TEST_PORT || await localPort();
    await withDatabase(source, async env => {
        await seed(env);
        if (selected === 'webkit') env.TAIONCA_TEST_BROWSER = 'webkit';
        console.log('Stage: ' + (selected || 'all Playwright specs'));
        const cliArgs = selected ? [...filters[selected], ...extra] : all ? args.slice(1) : args;
        command([...playwright, ...cliArgs], env);
    }, port);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
