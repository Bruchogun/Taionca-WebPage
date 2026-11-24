import { compose } from "compose-middleware";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

export const post =
    async (req, res) => {
        const { id_awaiting_approval_responsibility } = req.body;
        const {rows: completed_responsibilitys} = await res.sql`

            DELETE FROM awaiting_approval_responsibilitys WHERE id_awaiting_approval_responsibility = ${id_awaiting_approval_responsibility}
        ;`;

        const completed_responsibility = completed_responsibilitys[0];
        res.json({
            warning: `Responsabilidad rechazada.`,
            completed_responsibility
        });
    }
     