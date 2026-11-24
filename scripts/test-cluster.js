const { spawnSync } = require('child_process');
const { randomBytes } = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const loopback = '127.0.0.1';

function localPort() {
    return new Promise((resolve, reject) => {
        const listener = net.createServer();
        listener.once('error', reject);
        listener.listen(0, loopback, () => {
            const { port } = listener.address();
            listener.close(error => error ? reject(error) : resolve(port));
        });
    });
}

function commands() {
    const executable = name => name + (process.platform === 'win32' ? '.exe' : '');
    const bundled = path.resolve(__dirname, '../.local-runtime/pgsql/bin');
    const bin = ['initdb', 'pg_ctl', 'postgres'].every(name => fs.existsSync(path.join(bundled, executable(name))))
        ? bundled : '';
    return { initdb: path.join(bin, executable('initdb')), pgCtl: path.join(bin, executable('pg_ctl')) };
}

function run(executable, args, outputFile) {
    const options = { encoding: 'utf8', windowsHide: true, timeout: 60000 };
    const output = outputFile ? fs.openSync(outputFile, 'a') : undefined;
    // On Windows the postmaster can inherit pg_ctl's stdout pipe and keep it open after startup.
    if (output !== undefined) options.stdio = ['ignore', output, output];
    let result;
    try { result = spawnSync(executable, args, options); }
    finally { if (output !== undefined) fs.closeSync(output); }
    if (result.error?.code === 'ENOENT') {
        throw new Error('PostgreSQL test binaries were not found. Add initdb and pg_ctl to PATH or set TEST_ADMIN_DATABASE_URL to a disposable local cluster.');
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const diagnostics = outputFile ? fs.readFileSync(outputFile, 'utf8') : (result.stderr || result.stdout || '');
        throw new Error(path.basename(executable) + ' failed: ' + diagnostics.trim());
    }
}

function validateAdminUrl(configured) {
    const url = new URL(configured);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        ![loopback, '[::1]', 'localhost'].includes(url.hostname) || url.search || url.hash) {
        throw new Error('TEST_ADMIN_DATABASE_URL requires a loopback PostgreSQL URL with no query or fragment.');
    }
    return url;
}

async function withTestCluster(task) {
    const configured = process.env.TEST_ADMIN_DATABASE_URL;
    if (configured) return task(validateAdminUrl(configured));

    const { initdb, pgCtl } = commands();
    const temp = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(temp, 'taionca-test-pg-'));
    const data = path.join(directory, 'data');
    const passwordFile = path.join(directory, 'password');
    const log = path.join(directory, 'postgres.log');
    const username = 'taionca_test';
    const password = randomBytes(24).toString('hex');
    const pidFile = path.join(data, 'postmaster.pid');
    let failed = false;

    function cleanup() {
        if (fs.existsSync(pidFile)) run(pgCtl, ['-D', data, '-w', '-t', '25', '-m', 'fast', 'stop']);
        const resolved = fs.realpathSync(directory);
        if (path.dirname(resolved) !== temp || path.relative(directory, resolved) !== '' ||
            !path.basename(resolved).startsWith('taionca-test-pg-')) {
            throw new Error('Unexpected PostgreSQL temporary directory: ' + resolved);
        }
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        console.log('Removed temporary PostgreSQL cluster.');
    }

    function interrupt(exitCode) {
        try { cleanup(); }
        catch (error) { console.error('Temporary PostgreSQL cleanup failed at ' + directory + ': ' + error.message); }
        process.exit(exitCode);
    }
    const interruptInt = () => interrupt(130);
    const interruptTerm = () => interrupt(143);
    process.once('SIGINT', interruptInt);
    process.once('SIGTERM', interruptTerm);

    try {
        fs.writeFileSync(passwordFile, password + '\n', { mode: 0o600 });
        try {
            run(initdb, ['-D', data, '--username=' + username, '--auth=scram-sha-256',
                '--pwfile=' + passwordFile, '--no-locale', '--encoding=UTF8']);
        } finally { fs.rmSync(passwordFile, { force: true }); }
        const port = await localPort();
        fs.appendFileSync(path.join(data, 'postgresql.conf'),
            "\nlisten_addresses = '" + loopback + "'\nport = " + port + "\nunix_socket_directories = ''\n");
        try {
            run(pgCtl, ['-D', data, '-l', log, '-w', '-t', '25', 'start'], path.join(directory, 'pg_ctl.log'));
        } catch (error) {
            const detail = fs.existsSync(log) ? '\n' + fs.readFileSync(log, 'utf8').trim() : '';
            throw new Error(error.message + detail);
        }
        console.log('Temporary PostgreSQL cluster listening on ' + loopback + ':' + port + '.');
        return await task(new URL('postgres://' + username + ':' + password + '@' + loopback + ':' + port + '/postgres'));
    } catch (error) {
        failed = true;
        throw error;
    } finally {
        process.removeListener('SIGINT', interruptInt);
        process.removeListener('SIGTERM', interruptTerm);
        try { cleanup(); }
        catch (error) {
            const message = 'Temporary PostgreSQL cleanup failed at ' + directory + ': ' + error.message;
            if (!failed) throw new Error(message);
            console.error(message);
        }
    }
}

module.exports = { localPort, withTestCluster };
