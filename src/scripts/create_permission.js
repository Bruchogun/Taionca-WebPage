const { writePermissionMigration } = require('./permission-migration');

try {
    const names = process.argv.slice(2).map(name => name.toLowerCase());
    writePermissionMigration(names, 'data_permissions');
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
