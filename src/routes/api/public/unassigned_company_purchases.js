import { query } from '../../../db';
import { allows } from '../../../security/access';

export const get = async (req, res) => {
    if (!req.user || !Number.isInteger(req.user.user_id) || req.user.user_id < 1) {
        res.statusCode = 401;
        res.json({ error: 'Sesion requerida.' });
        return;
    }
    const parameters = [allows(req.user, ['finance.read', 'finance.loans']), req.user.user_id];
    const { rows: [schema] } = await query(
        `SELECT to_regclass('ledger_import.unassigned_company_purchases') IS NOT NULL
            AND to_regclass('ledger_import.batches') IS NOT NULL
            AND to_regclass('ledger_import.sheets') IS NOT NULL AS legacy_available,
            to_regclass('taionca_import.operations') IS NOT NULL
            AND to_regclass('taionca_import.sources') IS NOT NULL AS migrador_available`
    );
    if (!schema.legacy_available && !schema.migrador_available) {
        res.json({ unassigned_company_purchases: [], unassigned_purchases_available: false });
        return;
    }
    const purchases = [];
    if (schema.legacy_available) {
        const { rows } = await query(`
        SELECT p.id_purchase, p.owner_user_id, u.name AS owner_name, u.lastname AS owner_lastname,
            p.id_account, a.name AS account_name, p.id_currency, upper(c.code) AS currency_code,
            c.symbol, p.amount::text AS amount, p.description, p.source_sheet_id,
            p.source_row, p.source_cell, s.sheet_title, p.assignment_status,
            b.source_spreadsheet_id, p.documentary_source_key AS source_key,
            trim(p.source_row_sha256) AS source_evidence_hash, 'ledger_import' AS source_type
        FROM ledger_import.unassigned_company_purchases p
        JOIN users u ON u.user_id=p.owner_user_id
        JOIN accounts a ON a.id_account=p.id_account
        JOIN currencys c ON c.id_currency=p.id_currency
        JOIN ledger_import.batches b ON b.id_batch=p.id_batch
        LEFT JOIN ledger_import.sheets s ON s.id_batch=p.id_batch AND s.sheet_id=p.source_sheet_id
        WHERE ($1::boolean OR p.owner_user_id=$2) AND p.assignment_status='awaiting_odt'
        ORDER BY p.source_row, p.id_purchase`, parameters);
        purchases.push(...rows);
    }
    if (schema.migrador_available) {
        const { rows } = await query(`
        SELECT 'migrador:' || o.spreadsheet_id || ':' || o.operation_id AS id_purchase,
            u.user_id AS owner_user_id, u.name AS owner_name, u.lastname AS owner_lastname,
            a.id_account, a.name AS account_name, c.id_currency, upper(c.code) AS currency_code,
            c.symbol, o.outcome #>> '{ownerPurchase,amount}' AS amount,
            o.payload->>'description' AS description,
            o.payload #>> '{sourceEvidence,0,rawEvidence,sheetId}' AS source_sheet_id,
            o.payload #>> '{sourceEvidence,0,rawEvidence,row}' AS source_row,
            o.payload #>> '{sourceEvidence,0,cell}' AS source_cell,
            o.payload #>> '{sourceEvidence,0,sheet}' AS sheet_title,
            o.outcome #>> '{ownerPurchase,assignmentStatus}' AS assignment_status,
            o.spreadsheet_id AS source_spreadsheet_id, s.source_key,
            s.source_evidence_hash, 'taionca_import' AS source_type
        FROM taionca_import.operations o
        JOIN taionca_import.sources s USING(spreadsheet_id,operation_id)
        JOIN users u ON u.user_id::text=o.outcome #>> '{ownerPurchase,ownerUserId}'
        JOIN accounts a ON a.id_account::text=o.outcome #>> '{ownerPurchase,accountId}'
        JOIN currencys c ON c.id_currency::text=o.outcome #>> '{ownerPurchase,currencyId}'
            AND c.id_currency=a.id_currency
        WHERE ($1::boolean OR u.user_id=$2) AND o.payload->>'kind'='owner_purchase'
            AND o.outcome->>'kind'='owner_purchase'
            AND o.payload->>'assignmentStatus'='awaiting_odt'
            AND o.outcome #>> '{ownerPurchase,assignmentStatus}'='awaiting_odt'
            AND o.payload->>'refundable'='true'
            AND o.outcome #>> '{ownerPurchase,refundable}'='true'
            AND s.source_key=o.payload #>> '{sourceKeys,0}'
            AND s.source_key=o.payload #>> '{sourceEvidence,0,key}'
            AND s.source_evidence_hash=o.payload #>> '{sourceEvidence,0,evidenceHash}'
        ORDER BY source_row, o.operation_id`, parameters);
        for (const row of rows) {
            purchases.push({ ...row, source_sheet_id: Number(row.source_sheet_id), source_row: Number(row.source_row) });
        }
    }
    // A source cell may be visible through both audit formats, but equal amounts are independent.
    const bySource = new Map();
    for (const purchase of purchases) {
        bySource.set(JSON.stringify([purchase.source_spreadsheet_id, purchase.source_key]), purchase);
    }
    const rows = Array.from(bySource.values()).sort((a, b) =>
        a.source_row - b.source_row || String(a.id_purchase).localeCompare(String(b.id_purchase)));
    res.json({ unassigned_company_purchases: rows, unassigned_purchases_available: true });
};
