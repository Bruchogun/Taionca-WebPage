import { query } from "../../../db";

// List loans
export const get =
    async (req, res) => {
        const parameters=[req.user.is_admin || req.user.capabilities.includes('finance.loans') ||
            req.user.capabilities.includes('finance.read'),req.user.user_id];

        const {rows: loans} = await query(
            `select *
            from loans
            join currencys using (id_currency) WHERE ($1::boolean OR id_user=$2);
            `, parameters
        );
        const {rows: company_debts}=await query(`
            SELECT d.*,c.name_singular,c.name_plural,c.symbol,c.code,a.name AS account_name
            FROM company_debts d JOIN currencys c USING(id_currency)
            JOIN accounts a USING(id_account)
            WHERE ($1::boolean OR d.id_owner_user=$2)
            ORDER BY d.id_owner_user,a.name,d.id_company_debt`,parameters);
        const {rows: company_debt_registers}=await query(`
            SELECT m.*,d.id_owner_user,d.id_account,d.id_currency,
                c.name_singular,c.name_plural,c.symbol,c.code,a.name AS account_name
            FROM company_debt_movements m JOIN company_debts d USING(id_company_debt)
            JOIN currencys c ON c.id_currency=d.id_currency
            JOIN accounts a ON a.id_account=d.id_account
            WHERE ($1::boolean OR d.id_owner_user=$2)
            ORDER BY m.created_at,m.id_company_debt_movement`,parameters);
        const {rows: loan_users}=await query(`
            SELECT u.user_id,u.name,u.lastname FROM users u
            WHERE ($1::boolean OR u.user_id=$2) AND (
                u.special_user=false
                OR EXISTS(SELECT 1 FROM loans_registers r WHERE r.id_user=u.user_id)
                OR EXISTS(SELECT 1 FROM company_debts d WHERE d.id_owner_user=u.user_id)
            ) ORDER BY u.name,u.lastname,u.user_id`,parameters);

        res.json({
            loans,
            company_debts,
            company_debt_registers,
            loan_users
        });
    }
