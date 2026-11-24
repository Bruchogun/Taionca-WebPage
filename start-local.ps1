param([ValidateRange(1024, 65515)][int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.local-runtime'
$node = Join-Path $runtime 'node-v14.21.3-win-x64\node.exe'
if (!(Test-Path -LiteralPath $node)) { throw 'The local Node.js bootstrap is missing.' }

function Start-LocalPostgres($PgCtl, $Data, $Log) {
    if (!(Test-Path -LiteralPath $PgCtl) -or !(Test-Path -LiteralPath (Join-Path $Data 'PG_VERSION'))) {
        throw 'The selected local PostgreSQL runtime or cluster is missing.'
    }
    & $PgCtl -D $Data status | Out-Null
    if ($LASTEXITCODE -eq 0) { return }
    $process = Start-Process -FilePath $PgCtl -ArgumentList @('-D', ('"' + $Data + '"'), '-l', ('"' + $Log + '"'), '-w', 'start') -WindowStyle Hidden -PassThru
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Could not start the selected local PostgreSQL cluster.' }
}

Push-Location -LiteralPath $PSScriptRoot
try {
    $target = @(
        'const fs = require("fs");'
        'const config = require("dotenv").parse(fs.readFileSync(".env"));'
        'let url; try { url = new URL(config.DATABASE_URL); } catch { throw new Error("Expected a valid DATABASE_URL in .env."); }'
        'if (url.hostname !== "127.0.0.1") throw new Error("Expected a loopback DATABASE_URL in .env.");'
        'if (url.port === "55432") {'
        '    console.log("import-preview");'
        '} else if (url.port === "55433" && /^\/taionca_beta_prod_\d{8}$/.test(url.pathname)) {'
        '    if (process.env.DATABASE_URL && process.env.DATABASE_URL !== config.DATABASE_URL) {'
        '        throw new Error("The shell DATABASE_URL overrides the configured local copy. Unset it before starting.");'
        '    }'
        '    console.log("production-copy");'
        '} else {'
        '    throw new Error("The local launcher does not recognize the PostgreSQL cluster in .env.");'
        '}'
    ) | & $node
    if ($LASTEXITCODE -ne 0) { throw 'Could not identify the local database in .env.' }

    if ($target -eq 'production-copy') {
        $node24 = Get-Command node.exe -All | Where-Object { (& $_.Source --version) -like 'v24.*' } | Select-Object -First 1
        if (!$node24) { throw 'Node.js 24 is required to run beta against the production copy.' }
        $pg13 = Join-Path $env:ProgramFiles 'PostgreSQL\13\bin\pg_ctl.exe'
        Start-LocalPostgres $pg13 (Join-Path $runtime 'pgdata-production-pg13') (Join-Path $runtime 'postgresql-production-pg13.log')
        $env:HOST = '127.0.0.1'
        & $node24.Source (Join-Path $PSScriptRoot 'node_modules\sapper\sapper') dev --port $Port
    } else {
        $pg = Join-Path $runtime 'pgsql\bin\pg_ctl.exe'
        Start-LocalPostgres $pg (Join-Path $runtime 'pgdata') (Join-Path $runtime 'postgresql.log')
        & $node (Join-Path $runtime 'start-preview.cjs') --port $Port
    }
    if ($LASTEXITCODE -ne 0) { throw 'Local startup failed. See the local runtime logs.' }
} finally {
    Pop-Location
}
