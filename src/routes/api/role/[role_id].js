import { transaction,invalid } from '../../../lib/api-transaction';
import { compose } from "compose-middleware";
import { ROLES_DELETE, ROLES_READ, ROLES_UPDATE } from "../../../constants/PERMISSIONS";
import { query } from "../../../db";
import checkPermissionsMW from "../../../middlewares/checkPermissionsMW";

// Get role
export const get = compose(
    checkPermissionsMW(ROLES_READ),
    async (req, res) => {
        const {role_id} = req.params;

        const {rows: [role]} = await query(
            `SELECT
                role_id,
                roles.name,
                roles.created_at,
                coalesce(array_agg(jsonb_build_object(
                    'permission_id', permission_id,
                    'name', permissions.name)
                ) FILTER (WHERE permission_id IS NOT NULL), '{}') permissions
            FROM roles
            LEFT JOIN join_roles_permissions USING (role_id)
            LEFT JOIN permissions USING (permission_id)
            WHERE role_id = $1
            GROUP BY role_id
            LIMIT 1;`,
            [role_id]
        );

        res.json({
            data: {role}
        });
    }
)

export { updateRole as patch,deleteRole as del } from '../../../security/management';
