'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const repo = path.resolve(__dirname, '../..');
const { transformSync } = require('@babel/core');
const compile = file => transformSync(fs.readFileSync(file, 'utf8'), {
    filename: file, babelrc: false, configFile: false,
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')]
}).code;
function load(file, dependencies) {
    const exports = {};
    vm.runInNewContext(compile(file), { exports, require(name) {
        assert(Object.prototype.hasOwnProperty.call(dependencies, name), 'Unexpected API dependency.');
        return dependencies[name];
    } }, { filename: file });
    return exports;
}
async function run(client, expectedCount = 26, expectedSource = {
    sheetId: 1475939614, spreadsheetId: '1onMiSNkiVTxjQ9rRPVH844FFTvGAwfZlwM_obQX8VFk', accountKey: '1475939614:A:C'
}) {
    const identity = (await client.query('SELECT current_database() database,inet_server_port() port,host(inet_server_addr()) host')).rows[0];
    assert(/^taionca_migrador_test_[a-f0-9]{16}$/.test(identity.database), 'API fixture must be the caller-owned disposable Migrador test.');
    assert.strictEqual(identity.port, 55432);
    assert(['127.0.0.1', '::1'].includes(identity.host));
    const access = load(path.join(repo, 'src/security/access.js'), {
        './policy.json': JSON.parse(fs.readFileSync(path.join(repo, 'src/security/policy.json')))
    });
    const calls = [], api = load(path.join(repo, 'src/routes/api/public/unassigned_company_purchases.js'), {
        '../../../security/access': access,
        '../../../db': { query(sql, parameters) {
            assert(!/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE|DROP|ALTER|CALL)\b/i.test(sql), 'API fixture only reads.');
            calls.push({ sql, parameters });
            return client.query(sql, parameters);
        } }
    });
    const observations = [];
    for (const user of [
        { user_id: 1, is_admin: true, capabilities: [] },
        { user_id: 4, is_admin: false, capabilities: ['finance.read'] },
        { user_id: 4, is_admin: false, capabilities: ['finance.loans'] },
        { user_id: 100, is_admin: false, capabilities: [] },
        { user_id: 2, is_admin: false, capabilities: [] }
    ]) {
        let body;
        const response = { statusCode: 200, json(value) { body = value; } };
        await api.get({ user, query: { owner_user_id: 100 } }, response);
        assert.strictEqual(response.statusCode, 200);
        assert.strictEqual(body.unassigned_purchases_available, true);
        const rows = body.unassigned_company_purchases;
        assert.strictEqual(rows.length, user.user_id === 2 ? 0 : expectedCount);
        for (const row of rows) {
            assert.strictEqual(row.owner_user_id, 100);
            assert.strictEqual(row.currency_code, 'EUR');
            assert.strictEqual(row.source_sheet_id, expectedSource.sheetId);
            assert.strictEqual(row.assignment_status, 'awaiting_odt');
            assert.strictEqual(row.source_type, 'taionca_import');
            assert(row.id_purchase.startsWith('migrador:'));
            assert.strictEqual(row.source_spreadsheet_id, expectedSource.spreadsheetId);
            assert.strictEqual(row.source_key, expectedSource.accountKey + ':' + row.source_cell);
            assert.strictEqual(row.source_cell, 'C' + row.source_row);
            assert(Number.isInteger(row.source_row));
            assert(/^[a-f0-9]{64}$/.test(row.source_evidence_hash));
            assert(/^[0-9]+\.[0-9]{10}$/.test(row.amount));
            assert(row.description && row.sheet_title && row.account_name);
        }
        assert.strictEqual(new Set(rows.map(row => row.source_key)).size, rows.length);
        if (rows.length === 26) {
            const total = rows.reduce((n, row) => n + BigInt(row.amount.replace('.', '')), 0n);
            assert.strictEqual(total, 23876100000000n);
        }
        observations.push({ user_id: user.user_id, capabilities: user.capabilities, count: rows.length });
    }
    return { status: 'passed', observations, select_queries: calls.length, database_writes: 0 };
}
module.exports = { run };
