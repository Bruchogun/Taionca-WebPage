import { query } from "../db"
import fs from 'fs'

(async () => {
    const {rows: permissions} = await query("SELECT permission_id, code AS name FROM permissions WHERE is_system=true");

    const constants_js_declarations = permissions.map( ({permission_id, name}) => (`export const ${name.toUpperCase()} = ['${name}', ${permission_id}];`) );

    const file_content = constants_js_declarations.join("\n");
    const filepath = "./src/constants/PERMISSIONS.js";

    fs.writeFile(filepath, file_content, (err) => {
        process.exit();
    });
})();

