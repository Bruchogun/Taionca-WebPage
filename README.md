# Taionca

## This PC

Node.js 14 and npm are available on the Windows user PATH. Fully reopen PowerShell or Windows Terminal after the PATH update (restart VS Code if using its integrated terminal). From this folder, `npm run dev:local` starts both the local PostgreSQL cluster and the isolated preview website. The original `npm run dev` remains unchanged: it starts only Sapper and uses the database configured in `.env`.

Run `powershell -ExecutionPolicy Bypass -File .\start-local.ps1` from this folder. The launcher uses the installed local Node.js 14 and PostgreSQL runtimes, starts the app on loopback, and prints its URL. If port 3000 is occupied, it selects another available local port; `-Port 3001` sets the starting port.

The first launch copies `taionca_migrador_20261013_tool` into the separate `taionca_local_preview` database. Later launches preserve that preview and any edits made there. Neither the source migration database nor the original `.env` is changed. The migration itself remains partial; this preview is a copy of its current data, not the production website.

Local server status and logs are in `.local-runtime/preview-server.json` and the corresponding `web-PORT` logs. No schema migration or dependency upgrade is performed automatically by this launcher.

## Quick setup

*This assumes you already have a PostgreSQL server running, with an empty database created*

1. Install **git** and **node v14** (matching `package.json`; the local launcher uses its bundled runtime)
2. Clone this repository
3. Open terminal in repo's folder
4. Run `npm install`
5. Copy the file `.env.template` to `.env` and set the variable `DATABASE_URL` accordingly. Example: `DATABASE_URL=postgres://user:password@domain:5432/db_name`
6. Run `npm run build:db` to migrate db, and build `PERMISSIONS.js`
7. Run development server `npm run dev`

### To deploy to fly.io

    fly deploy --build-secret db_url="postgres://user:password@domain:5432/db_name"

### To deploy to vercel

1. Fork this repo and configure it in vercel as a Sapper app
2. Set the environment variables
   - `DATABASE_URL`
   - `SECRET_SESSION` ─ *you can get one with `openssl rand -base64 30`*

---

## DB

### Config connection

Set the environment variable `DATABASE_URL` in your `.env` file. Example:

```
DATABASE_URL=postgres://user:password@domain:5432/db_name
```

Now you can run the server, or any migration-command

### Migrations

- To migrate all pending migrations: `npm run migrate up`
- To undo **one** migration `npm run migrate down`
- To undo `n` migrations `npm run migrate down {n}`
- To redo `n` migrations `npm run migrate redo {n}`

#### Create migrations

```bash
npm run migrate create 'name of migration'
```

*DO NOT USE THIS TO CREATE PERMISSIONS*, see [Permissions](#Permissions) section

That will create an empty migration like `/migrations/1603225902395_name-of-migration.js`, see [existing migrations](/migrations) to see how this works, or check [node-pg-migrate's docs](https://salsita.github.io/node-pg-migrate/#/?id=quick-example)

### More Information
[node-pg-migrate's docs](https://salsita.github.io/node-pg-migrate/#/?id=quick-example)

## Permissions

Permissions must be created using a migration, to automate the deployment.\
I made some scripts to automate this process, *see [CRUD permissions](#create-crud-permissions) or [single permissions](#create-single-permissions)*

`PERMISSIONS.js` is a file that is not included in the repo, because it's builded after each DB-migration. *See [PERMISSIONS.js.README](src/constants/PERMISSIONS.js.README.md)* for more details\
It allows you to easily import permission's ids and names when developing API endpoints, to validate permissions.

To build that file, run `npm run build:permissions.js`, but most likely you will be running `npm run build:db` which migrates any pending changes and then builds the file.

### Create CRUD permissions

To create CRUD permissions (Create, Read, Update, Delete)

```bash
npm run create:crudPermissions accounts
```

That will create a migration to insert the following permissions:
- accounts_create
- accounts_read
- accounts_update
- accounts_delete

To migrate them and build `PERMISSIONS.js`

```bash
npm run build:db
```

### Create single permissions

```bash
npm run create:permissions approve_loans ask_for_approval
```

That will create a migration to insert the following permissions:
- approve_loans
- ask_for_approval

To migrate them and build `PERMISSIONS.js`

```
npm run build:db
```

### Testing

To run tests, you need to have a test database, and set the environment variable `DATABASE_URL` in your shell. Example:

    postgres://user:password@domain:5432/test_db_name

Install playright browser

```bash
npx playwright install
```

Run tests

```bash
npx playwright test
```

#### Run tests directly in VSCode

Install the extension [Playwright Test for VScode](https://marketplace.visualstudio.com/items?itemName=ms-playwright.playwright) and a new icon will appear in the left sidebar.

#### Debug tests

When a test fails, besides the errors in the console, you also receive 2 more hints in the folder `test-results`:
- a screenshot of the web page when it failed.
- A trace zip file that lets you replay what happened step-by-step.\
    In the console, you will get the exact command to execute to replay it.

#### Create new tests

To create a new test, create a new file in the folder `tests` with the extension `.test.js`.\
Basic test example:

```javascript
const { test, expect } = require('@playwright/test');

test('basic test', async ({ page }) => {
    await page.goto('http://localhost:3000');
    const title = page.locator('title');
    await expect(title).toHaveText('Taionca');
});
```

You can also use playwright's codegen to generate the test code for you.\
Run `npx playwright codegen` and the browser will open, and any interaction you do will be recorded as code.
