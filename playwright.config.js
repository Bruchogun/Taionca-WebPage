const { defineConfig } = require('@playwright/test');

// Prevent browser tests from accidentally attaching to a normal or production server.
const database = process.env.TAIONCA_TEST_DATABASE;
if (!/^taionca_test_odt_\d+$/.test(database || '') ||
    !process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/' + database) {
    throw new Error('Run npm test to create an isolated database and server.');
}
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;
if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
    throw new Error('The test server must be on loopback.');
}
const browserName = process.env.TAIONCA_TEST_BROWSER || 'chromium';
module.exports = defineConfig({
    testDir: './tests',
    testMatch: /.*\.(test|spec)\.js$/,
    timeout: 30000,
    expect: { timeout: 10000 },
    workers: 1,
    retries: 0,
    reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    use: {
        baseURL, browserName, serviceWorkers: 'block',
        channel: browserName === 'chromium'
            ? process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined)
            : undefined,
        screenshot: 'only-on-failure', trace: 'retain-on-failure'
    },
    webServer: {
        command: '"' + process.execPath + '" node_modules/sapper/sapper dev',
        url: baseURL + '/login', timeout: 120000,
        reuseExistingServer: false,
        env: { HOST: '127.0.0.1', PORT: process.env.PORT, DATABASE_URL: process.env.DATABASE_URL }
    }
});
