<#
.SYNOPSIS
  Sauvegarde complete d'un projet Supabase Humana : SQL (schema + donnees +
  auth + roles) et fichiers de Storage. Produit un dossier date, un manifest
  SHA256 et, en option, une archive 7z chiffree.

.DESCRIPTION
  Prerequis :
    1. Supabase CLI :   npm install -g supabase
    2. Login + link :   supabase login
                        supabase link --project-ref <REF>
                        (a faire une seule fois dans le dossier humana-rh)
    3. Optionnel :      7-Zip pour l'archivage chiffre  (scoop install 7zip)

  Le script se lance depuis n'importe quel dossier mais utilise le lien
  Supabase du dossier courant. Lance-le donc depuis humana-rh, sinon precise
  le dossier lie via -ProjectRoot.

.PARAMETER OutputRoot
  Dossier ou seront cree les backups. Defaut : %USERPROFILE%\backups\humana-supabase

.PARAMETER ProjectRoot
  Dossier contenant le lien Supabase (celui ou tu as fait 'supabase link').
  Defaut : dossier courant.

.PARAMETER Buckets
  Liste des buckets Storage a telecharger.
  Defaut : event-posters, hr-documents, payslips.

.PARAMETER SkipStorage
  Ne telecharge pas les fichiers de Storage.

.PARAMETER SkipAuth
  N'inclut pas le dump du schema auth (utilisateurs).

.PARAMETER Password
  Si defini, produit une archive 7z chiffree (AES-256, en-tete chiffre)
  et supprime le dossier en clair. Sensible : evite l'historique shell.

.PARAMETER KeepPlain
  Utilise avec -Password pour conserver aussi le dossier en clair.

.EXAMPLE
  .\scripts\backup-supabase.ps1

.EXAMPLE
  .\scripts\backup-supabase.ps1 -Password (Read-Host "Password" -AsSecureString | ConvertFrom-SecureString -AsPlainText)

.EXAMPLE
  .\scripts\backup-supabase.ps1 -SkipStorage -SkipAuth
#>
[CmdletBinding()]
param(
  [string]$OutputRoot   = (Join-Path $env:USERPROFILE "backups\humana-supabase"),
  [string]$ProjectRoot  = (Get-Location).Path,
  [string[]]$Buckets    = @("event-posters", "hr-documents", "payslips"),
  [switch]$SkipStorage,
  [switch]$SkipAuth,
  [string]$Password,
  [switch]$KeepPlain
)

$ErrorActionPreference = "Stop"

function Test-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Write-Step($message) {
  Write-Host ""
  Write-Host "== $message" -ForegroundColor Cyan
}

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
Write-Step "Verification des prerequis"

if (-not (Test-Cmd "supabase")) {
  Write-Error "Supabase CLI introuvable. Installe-la : npm install -g supabase"
  exit 1
}

$cliVersion = (& supabase --version) -join ""
Write-Host "Supabase CLI : $cliVersion"

if (-not (Test-Path $ProjectRoot)) {
  Write-Error "Dossier introuvable : $ProjectRoot"
  exit 1
}

Set-Location $ProjectRoot
Write-Host "Dossier de travail : $ProjectRoot"

# Le lien Supabase se materialise par supabase/.temp/project-ref
$linkFile = Join-Path $ProjectRoot "supabase\.temp\project-ref"
if (-not (Test-Path $linkFile)) {
  Write-Warning "Projet non lie a Supabase (supabase\.temp\project-ref absent)."
  Write-Warning "Execute au moins une fois :"
  Write-Warning "    supabase login"
  Write-Warning "    supabase link --project-ref <TON_PROJECT_REF>"
  $rep = Read-Host "Continuer quand meme ? (o/N)"
  if ($rep -notmatch "^[oOyY]") { exit 1 }
} else {
  $projectRef = (Get-Content $linkFile -Raw).Trim()
  Write-Host "Projet lie : $projectRef"
}

# ---------------------------------------------------------------------------
# Preparation du dossier de sortie
# ---------------------------------------------------------------------------
$stamp     = Get-Date -Format "yyyy-MM-dd_HHmm"
$backupDir = Join-Path $OutputRoot "humana_$stamp"
$sqlDir    = Join-Path $backupDir  "sql"
$storeDir  = Join-Path $backupDir  "storage"

New-Item -ItemType Directory -Path $sqlDir -Force | Out-Null
if (-not $SkipStorage) { New-Item -ItemType Directory -Path $storeDir -Force | Out-Null }

Write-Host ""
Write-Host "Dossier de backup : $backupDir"

# ---------------------------------------------------------------------------
# SQL dumps
# ---------------------------------------------------------------------------
Write-Step "Dump du schema public (tables, RLS, fonctions, triggers)"
& supabase db dump --schema public --file (Join-Path $sqlDir "schema-public.sql")
if ($LASTEXITCODE -ne 0) { Write-Error "Echec du dump du schema public"; exit 1 }

Write-Step "Dump des donnees (rows) du schema public"
& supabase db dump --data-only --file (Join-Path $sqlDir "data-public.sql")
if ($LASTEXITCODE -ne 0) { Write-Error "Echec du dump des donnees"; exit 1 }

Write-Step "Dump des roles et grants"
& supabase db dump --role-only --file (Join-Path $sqlDir "roles.sql")
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Echec du dump des roles (probablement bloque par la version CLI). On continue."
}

if (-not $SkipAuth) {
  Write-Step "Dump du schema auth (utilisateurs)"
  & supabase db dump --schema auth --data-only --file (Join-Path $sqlDir "auth-users.sql")
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "Echec du dump auth (permissions limitees). On continue."
  }
}

# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
if (-not $SkipStorage) {
  foreach ($bucket in $Buckets) {
    Write-Step "Storage : telechargement du bucket '$bucket'"
    $target = Join-Path $storeDir $bucket
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    try {
      & supabase storage cp -r "ss:///$bucket" $target 2>&1 | Out-Host
      if ($LASTEXITCODE -ne 0) {
        Write-Warning "Bucket '$bucket' : telechargement partiel ou echec (bucket vide, absent, ou permissions insuffisantes)."
      }
    } catch {
      Write-Warning "Bucket '$bucket' : erreur inattendue - $($_.Exception.Message)"
    }
  }
}

# ---------------------------------------------------------------------------
# Manifest (integrite SHA256)
# ---------------------------------------------------------------------------
Write-Step "Generation du manifest SHA256"
$files = Get-ChildItem -Recurse $backupDir -File | Sort-Object FullName
$manifestEntries = @()
foreach ($f in $files) {
  $rel = $f.FullName.Substring($backupDir.Length + 1)
  $sha = (Get-FileHash -Algorithm SHA256 -Path $f.FullName).Hash
  $manifestEntries += [ordered]@{
    path   = $rel
    size   = $f.Length
    sha256 = $sha
  }
}
$manifest = [ordered]@{
  createdAt      = (Get-Date).ToString("o")
  hostname       = $env:COMPUTERNAME
  user           = $env:USERNAME
  supabaseCli    = $cliVersion
  projectRef     = if ($projectRef) { $projectRef } else { "unlinked" }
  buckets        = if ($SkipStorage) { @() } else { $Buckets }
  totalFiles     = $manifestEntries.Count
  totalBytes     = ($manifestEntries | Measure-Object -Property size -Sum).Sum
  files          = $manifestEntries
}
$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath (Join-Path $backupDir "MANIFEST.json") -Encoding utf8
Write-Host "Manifest ecrit : MANIFEST.json ($($manifestEntries.Count) fichiers, $([math]::Round($manifest.totalBytes / 1MB, 2)) Mo)"

# ---------------------------------------------------------------------------
# Compression / chiffrement (optionnel)
# ---------------------------------------------------------------------------
if ($Password) {
  Write-Step "Compression + chiffrement 7z (AES-256, en-tete chiffre)"
  if (-not (Test-Cmd "7z")) {
    Write-Warning "7-Zip introuvable. Installe : scoop install 7zip"
    Write-Warning "Le dossier en clair reste dans $backupDir."
  } else {
    $archive = "$backupDir.7z"
    & 7z a "-p$Password" -mhe=on -mx=7 -y $archive "$backupDir\*" | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Echec de la compression. Le dossier en clair est conserve."
    } else {
      $archiveSize = [math]::Round((Get-Item $archive).Length / 1MB, 2)
      Write-Host ""
      Write-Host "Archive chiffree : $archive ($archiveSize Mo)" -ForegroundColor Green
      if (-not $KeepPlain) {
        Remove-Item -Recurse -Force $backupDir
        Write-Host "Dossier en clair supprime."
      } else {
        Write-Host "Dossier en clair conserve (-KeepPlain)."
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------
Write-Step "Termine"
if (Test-Path $backupDir) {
  Get-ChildItem -Recurse $backupDir -File | Sort-Object FullName | Format-Table `
    @{ Name="Fichier"; Expression={ $_.FullName.Substring($backupDir.Length + 1) } }, `
    @{ Name="Taille"; Expression={ if ($_.Length -lt 1KB) { "$($_.Length) o" } elseif ($_.Length -lt 1MB) { "{0:N0} Ko" -f ($_.Length/1KB) } else { "{0:N2} Mo" -f ($_.Length/1MB) } } }
}

Write-Host ""
Write-Host "Astuces :" -ForegroundColor Yellow
Write-Host "  * Chiffrer avant de sortir de la machine :"
Write-Host "      .\scripts\backup-supabase.ps1 -Password 'MotDePasseFort'"
Write-Host "  * Restaurer un dump plus tard :"
Write-Host "      psql <URI> < sql\schema-public.sql"
Write-Host "      psql <URI> < sql\data-public.sql"
Write-Host "  * Verifier l'integrite :"
Write-Host "      Get-FileHash sql\schema-public.sql -Algorithm SHA256"
Write-Host "      (comparer avec MANIFEST.json)"
