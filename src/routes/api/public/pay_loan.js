import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { sql } from "../../../db";

export const post = safeOdtExpense(
    async (req, res) => {
        const { user, account, description, amount } = req.body;
        const {rows: loan_paid} = await sql`

            WITH new_loan_register as (
                INSERT INTO public.loans_registers
                    ( id_user,  id_currency, amount, description)
                    VALUES (
                    ${user.value}::integer,
                    ${account.id_currency}::integer,
                    ${'-'+amount}::decimal(30,10),
                    ${description}::character varying
                    )
                    RETURNING id_loans_register
            ), t_ as(
                UPDATE loans
                SET amount = amount - ${amount}::decimal(30,10)
                WHERE id_user = ${user.value}::integer
                    AND id_currency = ${account.id_currency}::integer
            )
            SELECT alter_balance(id_balance, ${amount}::decimal(30,10), id_loans_register, 'loans')
            FROM new_loan_register, balances
            WHERE id_account = ${account.id_account}
                AND id_entity = 1 --TAIONCA
            ;
        `;

        let data = loan_paid[0]
        res.json({
            success: "Abono realizado.",
            data
        });
    });
