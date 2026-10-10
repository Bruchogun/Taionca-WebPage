import { settlementDetails } from '../../../../lib/odt-settlement-data';
import { paymentSummary, paymentError } from '../../../../lib/odt-payment-data';
import { validId } from '../../../../lib/odt-closure';
import { sql, pool } from "../../../../db";

// List odt_closure_resume
export const get =
    async (req, res) => {
        const {id_odt} = req.params;
        const user = req.session && req.session.user;
        if (!user) { res.statusCode=401; return res.json({error:'Debes iniciar sesión.'}); }
        if (!req.authorized) {
            res.statusCode=403; return res.json({error:'No tienes permiso para consultar ODTs.'});
        }
        if (!validId(id_odt)) { res.statusCode=400; return res.json({error:'Selecciona una ODT válida.'}); }
        let payments;
        try { payments = await paymentSummary(pool,id_odt,user.user_id); }
        catch (err) { return paymentError(res,err); }

        const {rows: odt_closure_resume} = await sql`

            WITH ceo_commissions AS (
                SELECT
                    id_closure_odt,
                    jsonb_build_object(
                        'id_user', id_user,
                        'user_name', users.name,
                        'user_lastname', users.lastname,
                        'user_position', 'Presidente',
                        'percent', profit_percent,
                        'profit', profit
                    ) as ceo_commission
                FROM ceo_closure_odts
                JOIN users ON ceo_closure_odts.id_user = users.user_id
                GROUP BY id_closure_odt, id_user, profit_percent, profit, users.name, users.lastname
            ),
            admin_commissions AS (
                SELECT
                    id_closure_odt,
                    jsonb_build_object(
                        'id_user', id_user,
                        'user_name', users.name,
                        'user_lastname', users.lastname,
                        'user_position', 'Administrador',
                        'percent', profit_percent,
                        'profit', profit
                    ) as admin_commission
                FROM admin_closure_odts
                JOIN users ON admin_closure_odts.id_user = users.user_id
                GROUP BY id_closure_odt, id_user, profit_percent, profit, users.name, users.lastname
            ),
            operative_commissions AS (
                SELECT
                    id_closure_odt,
                    jsonb_build_object(
                        'id_user', id_user,
                        'user_name', users.name,
                        'user_lastname', users.lastname,
                        'user_position', 'Operador',
                        'percent', profit_percent,
                        'profit', profit
                    ) as operative_commission
                FROM operative_closure_odts
                JOIN users ON operative_closure_odts.id_user = users.user_id
                GROUP BY id_closure_odt, id_user, profit_percent, profit, users.name, users.lastname
            ),
            supervisor_commissions AS (
                SELECT
                    id_closure_odt,
                    jsonb_build_object(
                        'id_user', id_user,
                        'user_name', users.name,
                        'user_lastname', users.lastname,
                        'user_position', 'Supervisor',
                        'percent', profit_percent,
                        'profit', profit
                    ) as supervisor_commission
                FROM supervisor_closure_odts
                JOIN users ON supervisor_closure_odts.id_user = users.user_id
                GROUP BY id_closure_odt, id_user, profit_percent, profit, users.name, users.lastname
            )  
            SELECT 
                closure_odts.id_closure_odt as id_closure_odt,
                closure_odts.id_account,
                coalesce(accounts.name,(SELECT string_agg(DISTINCT a.name, ', ') FROM odt_payments p
                    JOIN accounts a USING(id_account) WHERE p.id_odt=closure_odts.id_odt)) as account_name,
                closure_odts.settled_from_payments,
                closure_odts.amount as paid_amount,
                closure_odts.admin_expense_percent,
                closure_odts.gross_profit,

                round(closure_odts.amount * closure_odts.admin_expense_percent, 10) as admin_profit,
                closure_odts.taionca_profit as taionca_profit,
                closure_odts.general_expense as general_expenses,
                closure_odts.inv_expense as inv_expenses,

                COALESCE(
                    CASE 
                        WHEN COUNT(ceo_commissions.ceo_commission) = 0 
                        THEN '[]'::jsonb 
                        ELSE jsonb_agg(DISTINCT ceo_commissions.ceo_commission)
                    END, '[]'::jsonb
                ) as ceo_commissions,
                COALESCE(
                    CASE 
                        WHEN COUNT(admin_commissions.admin_commission) = 0 
                        THEN '[]'::jsonb 
                        ELSE jsonb_agg(DISTINCT admin_commissions.admin_commission)
                    END, '[]'::jsonb
                ) as admin_commissions,
                COALESCE(
                    CASE 
                        WHEN COUNT(operative_commissions.operative_commission) = 0 
                        THEN '[]'::jsonb 
                        ELSE jsonb_agg(DISTINCT operative_commissions.operative_commission)
                    END, '[]'::jsonb
                ) as operative_commissions,
                COALESCE(
                    CASE 
                        WHEN COUNT(supervisor_commissions.supervisor_commission) = 0 
                        THEN '[]'::jsonb 
                        ELSE jsonb_agg(DISTINCT supervisor_commissions.supervisor_commission)
                    END, '[]'::jsonb
                ) as supervisor_commissions
            
            from closure_odts
            LEFT JOIN accounts ON accounts.id_account = closure_odts.id_account
            LEFT JOIN ceo_commissions ON closure_odts.id_closure_odt = ceo_commissions.id_closure_odt
            LEFT JOIN admin_commissions ON closure_odts.id_closure_odt = admin_commissions.id_closure_odt
            LEFT JOIN operative_commissions ON closure_odts.id_closure_odt = operative_commissions.id_closure_odt
            LEFT JOIN supervisor_commissions ON closure_odts.id_closure_odt = supervisor_commissions.id_closure_odt

            WHERE closure_odts.id_odt = ${id_odt}
            GROUP BY closure_odts.id_closure_odt, accounts.name;
            `
        ;

        res.json({
            success: "Resumen de la ODT cargado exitosamente.",
            odt_closure_resume: odt_closure_resume[0],
            payments,
            currency_settlement: await settlementDetails(pool,id_odt)
        }
        );
    }
