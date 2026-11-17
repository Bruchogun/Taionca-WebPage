param([ValidateRange(1024, 65515)][int]$Port = 3000)

$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.local-runtime'
$node = Join-Path $runtime 'node-v14.21.3-win-x64\node.exe'
$pg = Join-Path $runtime 'pgsql\bin\pg_ctl.exe'
$data = Join-Path $runtime 'pgdata'
if (!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath $pg)) {
    throw 'The local Node.js and PostgreSQL runtimes are missing.'
}

& $pg -D $data status | Out-Null
if ($LASTEXITCODE -ne 0) {
    $process = Start-Process -FilePath $pg -ArgumentList @('-D', $data, '-l', (Join-Path $runtime 'postgresql.log'), '-w', 'start') -WindowStyle Hidden -PassThru
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw 'Could not start the existing local PostgreSQL cluster.' }
}

& $node (Join-Path $runtime 'start-preview.cjs') --port $Port
if ($LASTEXITCODE -ne 0) { throw 'Local preview startup failed. See the local runtime logs.' }
