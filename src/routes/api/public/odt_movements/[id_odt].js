import { sql } from "../../../../db";

// List balance_movements
export const get =
    async (req, res) => {
        const {id_odt} = req.params;

        const {rows: balance_movements} = await sql`
            select 

            id_balance_movement,
            entitys.name as entity,
            currencys.name_plural as currency,
            symbol,
            accounts.name as account,
            balance_movements.amount,
            balance_movements.end_balance,
            balance_movements.id_balance,
            balance_movements.created_at
            
            from balance_movements
            join balances using(id_balance)
            join entitys using(id_entity)
            join accounts using(id_account)
            join currencys using(id_currency)

            WHERE id_entity = 1 AND type_movement_category IN ('general_expenses','spendable_inv_odt_expenses','no_spendable_inv_odt_expenses') AND get_odt_movement(id_movement_category, type_movement_category) = ${id_odt}

            ORDER BY created_at;
            `
        ;

        res.json({
            success: "Datos de la ODT cargados exitosamente.",
            balance_movements
        }
        );
    }
