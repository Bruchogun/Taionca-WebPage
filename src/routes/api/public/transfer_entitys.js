import { safeOdtExpense } from '../../../lib/odt-expense-errors';
import { compose } from "compose-middleware";
import { USERS_READ } from "../../../constants/PERMISSIONS";
import { sql } from "../../../db";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post = safeOdtExpense(
    async (req, res) => {
        const {description, amount, income, expense} = req.body;
        if(expense.id_account === income.id_account && expense.id_entity === income.id_entity){
            return res.json({error: "Seleccione cuentas diferentes."}); 
        }else if (expense.id_currency !== income.id_currency){
            return res.json({error: "Seleccione cuentas con monedas iguales."}); 
        }else if(expense.id_account === income.id_account){
            const {rows: transfer_entity} = await sql`

                WITH new_transfer_entitys as (
                    INSERT INTO transfer_entitys
                        (description)
                        VALUES (${description}::character varying)
                        RETURNING id_transfer_entity
                )
                SELECT alter_balance( --Maldita sea, puto alter_balance siempre de ultimo en los WITHS!!!!!! 
                    id_balance,
                    CASE WHEN id_entity=${expense.id_entity} THEN ${'-'+amount}::numeric ELSE ${amount}::numeric END,
                    id_transfer_entity,
                    'transfer_entities' 
                ) FROM balances, new_transfer_entitys
                    WHERE id_account = ${income.id_account}::integer AND id_entity IN (${expense.id_entity}::integer, ${income.id_entity}::integer) --Both id_account are the same

                ;
            `;
            let data = transfer_entity[0]
            res.json({
                success:"Transferencia realizada",
                data
            });
        } else{
            const {rows: transfer_entity} = await sql`
    
                    WITH new_transfer_entitys as (
                        INSERT INTO transfer_entitys
                            (description)
                            VALUES (${description}::character varying)
                            RETURNING id_transfer_entity
                    )
                    SELECT alter_balance( --Maldita sea, puto alter_balance siempre de ultimo en los WITHS!!!!!! 
                        id_balance,
                        CASE WHEN id_account=${expense.id_account} THEN ${'-'+amount}::numeric ELSE ${amount}::numeric END,
                        id_transfer_entity,
                        'transfer_entities' 
                    ) FROM balances, new_transfer_entitys
                    WHERE (id_account = ${expense.id_account}::integer AND id_entity = ${expense.id_entity}::integer ) OR 
                            (id_account = ${income.id_account}::integer AND id_entity = ${income.id_entity}::integer)
                    ;
                `;
            let data = transfer_entity[0]
            res.json({
                success:"Transferencia realizada",
                data
            });
        }
    });
