const { defineConfig } = require('@playwright/test');

// Prevent browser tests from accidentally attaching to a normal or production server.
if (!process.env.TAIONCA_TEST_DATABASE || !process.env.TAIONCA_TEST_DATABASE.startsWith('taionca_test_odt_')) {
    throw new Error('Run npm test to create an isolated database and server.');
}
const baseURL = process.env.PLAYWRIGHT_TEST_BASE_URL;
module.exports = defineConfig({
    testDir: './tests',
    testMatch: /.*\.(test|spec)\.js$/,
    timeout: 30000,
    expect: { timeout: 10000 },
    workers: 1,
    retries: 0,
    reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
    use: {
        baseURL, browserName: 'chromium', serviceWorkers: 'block',
        channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
        screenshot: 'only-on-failure', trace: 'retain-on-failure'
    },
    webServer: {
        command: 'npm run dev', url: baseURL + '/login', timeout: 120000,
        reuseExistingServer: false,
        env: { PORT: process.env.PORT, DATABASE_URL: process.env.DATABASE_URL }
    }
});
