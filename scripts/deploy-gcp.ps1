<#
  Deploy backend KASIR NOVA ke Cloud Run + Cloud SQL (GCP).

  PRASYARAT (dilakukan pengguna):
    1. gcloud CLI terpasang & login:  gcloud auth login
    2. Project punya BILLING AKTIF (Cloud Run + Cloud SQL berbayar).
    3. Menjalankan ini = menyetujui pembuatan resource berbayar.

  Pemakaian:
    pwsh -File scripts/deploy-gcp.ps1 -ProjectId "PROJECT_ID_ANDA"

  Catatan: skrip ini membuat resource berbayar. Jangan dijalankan
  tanpa persetujuan pemilik proyek.
#>
param(
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$Region = 'us-central1',
  [string]$ArtifactRepo = 'nova-repo',
  [string]$ServiceName = 'nova-server',
  [string]$DbInstance = 'nova-db',
  [string]$DbName = 'nova_kasir_prod',
  [string]$DbUser = 'nova_app',
  [string]$CorsOrigin = 'https://kasir-nova.web.app'
)

$ErrorActionPreference = 'Stop'

function Invoke-Gcloud {
  param([string[]]$Args)
  Write-Host "> gcloud $($Args -join ' ')" -ForegroundColor Yellow
  & gcloud @Args
  if ($LASTEXITCODE -ne 0) { throw "gcloud gagal (exit $LASTEXITCODE): $($Args -join ' ')" }
}

Write-Host "=== Deploy KASIR NOVA (Cloud Run + Cloud SQL) ===" -ForegroundColor Cyan
Write-Host "Project=$ProjectId Region=$Region Service=$ServiceName DB=$DbName@$DbInstance"
Write-Host "PERINGATAN: langkah ini membuat resource BERBAYAR. Lanjutkan hanya jika Anda menyetujuinya." -ForegroundColor Magenta

Invoke-Gcloud @('config', 'set', 'project', $ProjectId)

foreach ($api in @('run.googleapis.com', 'sqladmin.googleapis.com', 'artifactregistry.googleapis.com', 'cloudbuild.googleapis.com', 'secretmanager.googleapis.com')) {
  Invoke-Gcloud @('services', 'enable', $api, "--project=$ProjectId")
}

# Artifact Registry (abaikan bila sudah ada)
try {
  Invoke-Gcloud @('artifacts', 'repositories', 'describe', $ArtifactRepo, "--location=$Region", "--project=$ProjectId")
} catch {
  Invoke-Gcloud @('artifacts', 'repositories', 'create', $ArtifactRepo, '--repository-format=docker', "--location=$Region", "--project=$ProjectId")
}

# Cloud SQL termurah untuk PostgreSQL (db-f1-micro)
try {
  Invoke-Gcloud @('sql', 'instances', 'describe', $DbInstance, "--project=$ProjectId")
} catch {
  Invoke-Gcloud @('sql', 'instances', 'create', $DbInstance, '--database-version=POSTGRES_16', '--tier=db-f1-micro', "--region=$Region", '--storage-size=10GB', "--project=$ProjectId")
}

try { Invoke-Gcloud @('sql', 'databases', 'create', $DbName, "--instance=$DbInstance", "--project=$ProjectId") } catch { Write-Host "(db mungkin sudah ada)" }
try { Invoke-Gcloud @('sql', 'users', 'create', $DbUser, "--instance=$DbInstance", "--project=$ProjectId") } catch { Write-Host "(user mungkin sudah ada)" }

# Secret Manager: DATABASE_URL + JWT
$dbPass = [System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N')
$dbUrl = "postgresql://$DbUser`:$dbPass@/$DbName?host=/cloudsql/$ProjectId`:$Region`:$DbInstance"
$jwtAccess = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([System.Guid]::NewGuid().ToString() + [System.Guid]::NewGuid().ToString()))
$jwtRefresh = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes([System.Guid]::NewGuid().ToString() + [System.Guid]::NewGuid().ToString()))

function Set-Secret {
  param([string]$Name, [string]$Value)
  try { Invoke-Gcloud @('secrets', 'describe', $Name, "--project=$ProjectId") } catch {
    Invoke-Gcloud @('secrets', 'create', $Name, '--replication-policy=automatic', "--project=$ProjectId")
  }
  $tmp = New-TemporaryFile
  Set-Content -Path $tmp -Value $Value -NoNewline
  Invoke-Gcloud @('secrets', 'versions', 'add', $Name, "--data-file=$($tmp.FullName)", "--project=$ProjectId")
  Remove-Item $tmp -Force
}

Set-Secret -Name 'nova-db-url' -Value $dbUrl
Set-Secret -Name 'nova-jwt-access' -Value $jwtAccess
Set-Secret -Name 'nova-jwt-refresh' -Value $jwtRefresh

Invoke-Gcloud @(
  'builds', 'submit', '.',
  "--project=$ProjectId",
  "--region=$Region",
  '--config=cloudbuild.yaml',
  "--substitutions=_CLOUD_SQL_INSTANCE=$ProjectId`:$Region`:$DbInstance,_CORS_ORIGIN=$CorsOrigin,_SERVICE_NAME=$ServiceName,_ARTIFACT_REPO=$ArtifactRepo,_REGION=$Region"
)

$url = (& gcloud run services describe $ServiceName "--region=$Region" "--project=$ProjectId" '--format=value(status.url)')
Write-Host ""
Write-Host "Cloud Run URL: $url" -ForegroundColor Green
Write-Host "Selanjutnya: set destination rewrite /api/** di firebase.json ke $url/api/**" -ForegroundColor Cyan
Write-Host "Lalu: node scripts/build-hosting.mjs  ;  firebase deploy --only hosting"
Write-Host ""
Write-Host "WAJIB (sekali): migrasi & seed DB via Cloud SQL Auth Proxy:" -ForegroundColor Yellow
Write-Host "  1) cloud-sql-proxy $ProjectId`:$Region`:$DbInstance"
Write-Host "  2) set DATABASE_URL lokal ke 127.0.0.1:5432 lalu: npm run db:migrate ; npm run db:seed"
Write-Host "  Password DB ada di Secret Manager 'nova-db-url'."
