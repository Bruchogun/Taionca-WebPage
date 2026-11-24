const fs = require('fs').promises;
const { Client } = require('pg');
require('dotenv').config();

async function exportLegacyPermissions() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('Configure DATABASE_URL before exporting legacy permissions.');
    const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const { rows } = await client.query('SELECT permission_id, code FROM permissions WHERE is_system ORDER BY permission_id');
        const declarations = rows.map(({ permission_id, code }) => {
            const constant = code.toUpperCase();
            if (!/^[A-Z_][A-Z0-9_]*$/.test(constant)) throw new Error('Invalid legacy permission code.');
            return 'export const ' + constant + ' = ' + JSON.stringify([code, permission_id]) + ';';
        });
        await fs.writeFile('src/constants/PERMISSIONS.js', declarations.join('\n') + '\n');
    } finally { await client.end(); }
}

exportLegacyPermissions().catch(error => { console.error(error.message); process.exitCode = 1; });
