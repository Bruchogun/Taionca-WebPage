// Every run creates a new database. Never migrate, seed or reset DATABASE_URL itself.
require('dotenv').config();
const { Client } = require('pg');
const migrate = require('node-pg-migrate').default;
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');

(async () => {
    const source = process.env.TEST_ADMIN_DATABASE_URL || process.env.DATABASE_URL;
    if (!source) throw new Error('Configure DATABASE_URL (or TEST_ADMIN_DATABASE_URL) to create an isolated test database.');
    const name = `taionca_test_odt_${Date.now()}`;
    const url = new URL(source);
    url.pathname = '/' + name;
    const testUrl = url.toString();
    const admin = new Client({ connectionString: source });
    let created = false;
    const permissionsFile = path.resolve('src/constants/PERMISSIONS.js');
    const previousPermissions = fs.existsSync(permissionsFile) ? fs.readFileSync(permissionsFile) : null;
    let result = 1;
    try {
        await admin.connect();
        await admin.query(`CREATE DATABASE "${name}"`);
        created = true;
        console.log('Isolated database: ' + name);
        const applied = await migrate({ databaseUrl: testUrl, dir: path.resolve('migrations'),
            direction: 'up', migrationsTable: 'pgmigrations', log: () => {},
            logger: { info() {}, warn() {}, error: console.error } });
        console.log('Migrations passed: ' + applied.length);
        const migrationOptions = { databaseUrl: testUrl, dir: path.resolve('migrations'), migrationsTable: 'pgmigrations', log: () => {}, logger: { info() {}, warn() {}, error: console.error } };
        await migrate({ ...migrationOptions, direction: 'down', count: 1 });
        const sequenceClient=new Client({connectionString:testUrl});await sequenceClient.connect();
        const sequenceCases=[];
        try {
            for(const [table,column] of [['users','user_id'],['roles','role_id'],['permissions','permission_id']]) {
                const maximum=Number((await sequenceClient.query(`SELECT max("${column}") AS value FROM "${table}"`)).rows[0].value);
                const preserveHigher=table==='roles';
                await sequenceClient.query('SELECT setval(pg_get_serial_sequence($1,$2),$3,$4)',[table,column,preserveHigher?maximum+50:1,preserveHigher]);
                sequenceCases.push({table,column,expected:preserveHigher?maximum+51:maximum+1});
            }
            await migrate({ ...migrationOptions, direction: 'up' });
            for(const {table,column,expected} of sequenceCases) {
                const actual=Number((await sequenceClient.query('SELECT nextval(pg_get_serial_sequence($1,$2)) AS value',[table,column])).rows[0].value);
                if(actual!==expected) throw new Error('Sequence migration failed for '+table);
            }
        } finally {await sequenceClient.end();}
        console.log('Migration rollback/reapply and imported ID sequence checks passed');
        const client = new Client({ connectionString: testUrl });
        await client.connect();
        try {
            // Historical seeds use explicit IDs; advance their sequences only in this fresh database.
            const { rows } = await client.query(`SELECT table_name,column_name FROM information_schema.columns
                WHERE table_schema='public' AND column_default LIKE 'nextval(%'`);
            for (const { table_name: table, column_name: column } of rows) {
                await client.query(`SELECT setval(pg_get_serial_sequence($1,$2),coalesce((SELECT max("${column}") FROM "${table}"),1),true)`, [table, column]);
            }
            const password = await argon2.hash('test-admin-odt');
            await client.query("UPDATE users SET username='admin',password_hash=$1 WHERE user_id=1", [password]);
            await client.query(`INSERT INTO join_roles_permissions(role_id,permission_id)
                SELECT 1,permission_id FROM permissions ON CONFLICT DO NOTHING`);
            for (let id = 201; id <= 204; id++) {
                const entity = (await client.query("INSERT INTO entitys(name) VALUES($1) RETURNING id_entity", ['Test user ' + id])).rows[0].id_entity;
                await client.query(`INSERT INTO users(user_id,username,password_hash,name,lastname,email,id_entity)
                    VALUES($1,$2,$3,'Test','User',$4,$5)`, [id, 'test-user-' + id, password, id+'@test.invalid', entity]);
            }
            await client.query("INSERT INTO accounts(id_currency,name) VALUES(1,'Destino ODT pruebas'),(1,'Otra cuenta pruebas')");
        } finally { await client.end(); }
        const env = { ...process.env, DATABASE_URL: testUrl, TAIONCA_TEST_DATABASE: name,
            PORT: process.env.TEST_PORT || '3107', PLAYWRIGHT_TEST_BASE_URL: 'http://127.0.0.1:' + (process.env.TEST_PORT || '3107') };
        const permissions = spawnSync(process.execPath, ['-r', 'esm', 'src/scripts/build_permissions_constants.js'], { env, stdio: 'inherit' });
        if (permissions.status !== 0) throw new Error('Permission generation failed');
        if (process.argv.includes('--build')) {
            const build = spawnSync(process.execPath, ['node_modules/sapper/sapper', 'build'], { env, stdio: 'inherit' });
            if (build.status !== 0) throw new Error('Build failed');
        }
        const tests = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2).filter(arg => arg !== '--build')], { env, stdio: 'inherit' });
        result = tests.status === null ? 1 : tests.status;
    } finally {
        if (previousPermissions) fs.writeFileSync(permissionsFile, previousPermissions);
        else if (fs.existsSync(permissionsFile)) fs.unlinkSync(permissionsFile);
        if (created) {
            await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [name]);
            await admin.query(`DROP DATABASE "${name}"`);
            console.log('Removed isolated database: ' + name);
        }
        await admin.end();
    }
    process.exitCode = result;
})().catch(err => { console.error(err.message); process.exitCode = 1; });
