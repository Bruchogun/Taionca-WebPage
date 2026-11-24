import { compose } from "compose-middleware";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post =
    async (req, res) => {
        const { user_id } = req.session.user;
        const { id_client, id_currency, id_entity, amount, description, id_quotation, admin_percent } = req.body;
        
        if (!res.validateDescription(description)) return;

        const {rows: odts} = await res.sql`
            INSERT INTO public.odts
                ( id_client, id_user, id_currency, id_entity, amount, description, id_quotation, admin_percent )
                VALUES (${id_client}::integer, ${user_id}::integer, ${id_currency}::integer, ${id_entity}::integer, ${amount}::numeric, ${description}::character varying, ${id_quotation}::integer, ${admin_percent}::numeric )
                RETURNING id_odt;
        `;

        const odt = odts[0];
        res.json({
            success: `ODT creada exitosamente con id ${odt.id_odt}`,
            odt
        });
    }
     