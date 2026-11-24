const { writePermissionMigration } = require('./permission-migration');

try {
    const actions = ['create', 'read', 'update', 'delete'];
    const names = process.argv.slice(2).flatMap(base =>
        actions.map(action => base.toLowerCase() + '_' + action));
    writePermissionMigration(names, 'data_crud_permissions');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
