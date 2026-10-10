import { compose } from 'compose-middleware';
import { ROLES_READ } from '../../constants/PERMISSIONS';
import checkPermissionsMW from '../../middlewares/checkPermissionsMW';
import { query } from '../../db';
export { createRole as post } from '../../security/management';
// List roles
export const get = compose(
    checkPermissionsMW(ROLES_READ),
    async (req, res) => {

        const {rows: roles} = await query(
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
            GROUP BY role_id;`
        );

        res.json({
            data: {roles}
        });
    }
)
