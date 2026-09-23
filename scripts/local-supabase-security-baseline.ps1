param(
  [string]$DatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  [switch]$SkipRuntimeMatrix
)

$ErrorActionPreference = "Stop"

if ($DatabaseUrl -notmatch "@(127\.0\.0\.1|localhost):54322/") {
  throw "Refusing to run against a non-local Supabase database URL: $DatabaseUrl"
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$schemaPath = Join-Path $repoRoot "supabase\schema.sql"
$migrationsDir = Join-Path $repoRoot "supabase\migrations"
$stagedMigrationsDir = Join-Path $repoRoot "supabase\.local-bootstrap-migrations"
$matrixPath = Join-Path $repoRoot "supabase\local\security-runtime-matrix.sql"

$supabaseCommand = Get-Command supabase.cmd -ErrorAction SilentlyContinue
if (-not $supabaseCommand) {
  $supabaseCommand = Get-Command supabase -ErrorAction SilentlyContinue
}
if (-not $supabaseCommand) {
  throw "Supabase CLI was not found on PATH."
}

$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dbContainer = $null

if (-not $dockerCommand) {
  throw "Docker was not found on PATH. Start Docker Desktop before running this script."
}

function Invoke-LocalPsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  Write-Host "==> $Label"
  if ($psqlCommand) {
    & psql $DatabaseUrl -v ON_ERROR_STOP=1 -f $Path
  } else {
    Get-Content -LiteralPath $Path -Raw | docker exec -i $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Failed while applying $Label"
  }
}

function Invoke-LocalPsqlScalar {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [Parameter(Mandatory = $true)][string]$Label
  )

  if ($psqlCommand) {
    $output = & psql $DatabaseUrl -v ON_ERROR_STOP=1 -tAc $Sql
  } else {
    $output = $Sql | docker exec -i $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Failed while checking $Label"
  }
  return ($output | Select-Object -First 1).Trim()
}

function Assert-TableExists {
  param(
    [Parameter(Mandatory = $true)][string]$TableName,
    [Parameter(Mandatory = $true)][string]$BeforeLabel
  )

  $exists = Invoke-LocalPsqlScalar -Sql "select to_regclass('public.$TableName') is not null;" -Label "public.$TableName exists"
  if ($exists -ne "t") {
    throw "Expected public.$TableName to exist before $BeforeLabel."
  }
  Write-Host "Verified public.$TableName exists before $BeforeLabel."
}

Write-Host "Disposable local Supabase baseline"
Write-Host "Database: $DatabaseUrl"
Write-Host "No hosted Supabase mutation or migration repair is performed by this script."

if (Test-Path -LiteralPath $stagedMigrationsDir) {
  throw "Refusing to continue because a previous local migration staging directory exists: $stagedMigrationsDir"
}
if (-not (Test-Path -LiteralPath $migrationsDir)) {
  throw "Expected migration directory was not found: $migrationsDir"
}

$migrationsWereStaged = $false
try {
  Write-Host "==> staging migrations away from Supabase automatic startup"
  Move-Item -LiteralPath $migrationsDir -Destination $stagedMigrationsDir
  $migrationsWereStaged = $true

  Write-Host "==> starting local Supabase services"
  & $supabaseCommand.Source start
  if ($LASTEXITCODE -ne 0) {
    throw "supabase start failed"
  }
} finally {
  if ($migrationsWereStaged -and (Test-Path -LiteralPath $stagedMigrationsDir)) {
    Write-Host "==> restoring migration directory"
    Move-Item -LiteralPath $stagedMigrationsDir -Destination $migrationsDir
  }
}

$dbContainer = (& docker ps --format "{{.Names}}" --filter "name=supabase_db_" | Select-Object -First 1)
if (-not $psqlCommand -and -not $dbContainer) {
  throw "No psql client or running local Supabase DB container was found after supabase start."
}

Invoke-LocalPsqlFile -Path $schemaPath -Label "baseline supabase/schema.sql"

Assert-TableExists -TableName "profiles" -BeforeLabel "20260910_exam_safety.sql"
Assert-TableExists -TableName "exams" -BeforeLabel "20260910_exam_safety.sql"

Get-ChildItem -LiteralPath $migrationsDir -Filter "*.sql" |
  Sort-Object Name |
  ForEach-Object {
    Invoke-LocalPsqlFile -Path $_.FullName -Label "migration $($_.Name)"
  }

if (-not $SkipRuntimeMatrix) {
  Invoke-LocalPsqlFile -Path $matrixPath -Label "security runtime matrix"
}

Write-Host "Local baseline and selected validation completed."
