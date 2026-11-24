const fs = require('fs');
const path = require('path');
const { legacy } = require('../security/policy.json');

function writePermissionMigration(names, filename) {
    if (!names.length || names.some(name => !/^[a-z][a-z0-9_]{0,63}$/.test(name))) {
        throw Error('Usa nombres de permisos en minúsculas de hasta 64 caracteres.');
    }
    const codes = [...new Set(names)];
    const values = codes.map(code => {
        const mapped = Object.prototype.hasOwnProperty.call(legacy, code) ? legacy[code] : [];
        const capabilities = mapped.map(capability => "'" + capability.replace(/'/g, "''") + "'");
        return "('" + code + "','" + code + "',ARRAY[" + capabilities.join(',') + "]::text[])";
    });
    const up = `WITH created AS (
        INSERT INTO permissions (name,code,capabilities)
        VALUES ${values.join(',\n        ')}
        RETURNING permission_id
    )
    INSERT INTO join_roles_permissions (role_id,permission_id)
    SELECT role_id,permission_id FROM roles CROSS JOIN created WHERE role_id=1;`;
    const down = `DELETE FROM permissions WHERE code IN (${codes.map(code => "'" + code + "'").join(',')});`;
    const output = path.join('migrations', Date.now() + '_' + filename + '.js');
    fs.writeFileSync(output, 'exports.up = pgm => pgm.sql(' + JSON.stringify(up) + ');\n' +
        'exports.down = pgm => pgm.sql(' + JSON.stringify(down) + ');\n', { flag: 'wx' });
    console.log(output);
}

module.exports = { writePermissionMigration };
