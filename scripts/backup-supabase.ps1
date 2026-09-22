<#
.SYNOPSIS
  Sauvegarde complete d'un projet Supabase Humana en utilisant pg_dump direct
  (pas besoin de Docker) + telechargement des buckets Storage.

.DESCRIPTION
  Prerequis :
    1. pg_dump 17+ installe (winget install PostgreSQL.PostgreSQL.17)
       ou binaires PostgreSQL portables (chemin via -PgBinDir)
    2. Projet Supabase deja lie : supabase link --project-ref <REF>
       (utilise supabase/.temp/pooler-url pour trouver l'URL)
    3. Optionnel : 7-Zip pour l'archivage chiffre (winget install 7zip.7zip)

  Le script :
    - Prompt le mot de passe DB une seule fois (SecureString, jamais logge).
    - Dump schema public via pg_dump --schema-only.
    - Dump donnees public via pg_dump --data-only.
    - Dump schema auth (users) si non desactive.
    - Telecharge chaque bucket Storage via l'API REST Supabase :
        * bucket public : URL /storage/v1/object/public/...
        * bucket prive  : signed URL /storage/v1/object/sign/... (necessite service_role)
    - Genere un manifest SHA256.
    - Chiffre optionnellement dans une archive 7z AES-256.

.PARAMETER OutputRoot
  Dossier ou seront cree les backups. Defaut : %USERPROFILE%\backups\humana-supabase

.PARAMETER ProjectRoot
  Dossier contenant le lien Supabase. Defaut : dossier courant.

.PARAMETER PgBinDir
  Dossier contenant pg_dump.exe. Defaut : auto-detection (PATH,
  C:\Program Files\PostgreSQL\<version>\bin, .tools\pg\bin).

.PARAMETER Buckets
  Liste des buckets Storage a telecharger. Defaut : detection automatique.

.PARAMETER ServiceRoleKey
  Cle service_role pour acceder aux buckets prives. Si absente, seuls les
  buckets publics sont telecharges. Prompt securise si -PromptServiceRole.

.PARAMETER PromptServiceRole
  Demande la cle service_role de maniere interactive et securisee.

.PARAMETER SkipStorage
  Ne telecharge pas les fichiers de Storage.

.PARAMETER SkipAuth
  N'inclut pas le dump du schema auth (utilisateurs).

.PARAMETER SkipSchema
  N'inclut pas le dump du schema (que les donnees).

.PARAMETER SkipData
  N'inclut pas le dump des donnees (que le schema).

.PARAMETER ArchivePassword
  Si defini, produit une archive 7z chiffree (AES-256, en-tete chiffre)
  et supprime le dossier en clair.

.PARAMETER KeepPlain
  Utilise avec -ArchivePassword pour conserver aussi le dossier en clair.

.EXAMPLE
  .\scripts\backup-supabase.ps1

.EXAMPLE
  .\scripts\backup-supabase.ps1 -PromptServiceRole

.EXAMPLE
  .\scripts\backup-supabase.ps1 -SkipStorage -SkipAuth
#>
[CmdletBinding()]
param(
  [string]$OutputRoot     = (Join-Path $env:USERPROFILE "backups\humana-supabase"),
  [string]$ProjectRoot    = (Get-Location).Path,
  [string]$PgBinDir       = $null,
  [string[]]$Buckets      = $null,
  [string]$ServiceRoleKey = $null,
  [switch]$PromptServiceRole,
  [switch]$SkipStorage,
  [switch]$SkipAuth,
  [switch]$SkipSchema,
  [switch]$SkipData,
  [string]$ArchivePassword,
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
# 1) Localisation de pg_dump
# ---------------------------------------------------------------------------
function Find-PgDump {
  param([string]$Hint)

  $candidates = @()
  if ($Hint) { $candidates += (Join-Path $Hint "pg_dump.exe") }

  $cmd = Get-Command pg_dump.exe -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }

  # Chemins standard EDB (Windows). On prend la plus haute version.
  $edbRoots = @(
    "C:\Program Files\PostgreSQL",
    "C:\Program Files (x86)\PostgreSQL"
  )
  foreach ($root in $edbRoots) {
    if (Test-Path $root) {
      Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { $candidates += (Join-Path $_.FullName "bin\pg_dump.exe") }
    }
  }

  # Portable dans le workspace.
  $portable = Join-Path (Get-Location).Path ".tools\pg\bin\pg_dump.exe"
  $candidates += $portable

  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return $c }
  }
  return $null
}

Write-Step "Verification des prerequis"

if (-not (Test-Path $ProjectRoot)) {
  Write-Error "Dossier introuvable : $ProjectRoot"
  exit 1
}
Set-Location $ProjectRoot
Write-Host "Dossier de travail : $ProjectRoot"

$pgDump = Find-PgDump -Hint $PgBinDir
if (-not $pgDump) {
  Write-Error @"
pg_dump introuvable. Installe-le :
  winget install PostgreSQL.PostgreSQL.17
ou passe le dossier bin via -PgBinDir "C:\Program Files\PostgreSQL\17\bin"
"@
  exit 1
}
Write-Host "pg_dump : $pgDump"

$pgDumpVersion = (& $pgDump --version) -join ""
Write-Host $pgDumpVersion

$psql = Join-Path (Split-Path $pgDump) "psql.exe"
if (-not (Test-Path $psql)) { $psql = $null }

# Le lien Supabase se materialise par supabase/.temp/*.
$refFile     = Join-Path $ProjectRoot "supabase\.temp\project-ref"
$poolerFile  = Join-Path $ProjectRoot "supabase\.temp\pooler-url"
if (-not (Test-Path $refFile) -or -not (Test-Path $poolerFile)) {
  Write-Error @"
Projet non lie a Supabase. Execute :
  supabase login
  supabase link --project-ref <TON_PROJECT_REF>
"@
  exit 1
}
$projectRef = (Get-Content $refFile -Raw).Trim()
$poolerUrl  = (Get-Content $poolerFile -Raw).Trim()
Write-Host "Projet lie   : $projectRef"
Write-Host "Pooler URL   : $poolerUrl"

# ---------------------------------------------------------------------------
# 2) Recuperation du mot de passe DB
# ---------------------------------------------------------------------------
Write-Step "Mot de passe DB Supabase"
if ($env:SUPABASE_DB_PASSWORD) {
  Write-Host "Utilisation de `$env:SUPABASE_DB_PASSWORD (deja defini)"
  $dbPassword = $env:SUPABASE_DB_PASSWORD
} else {
  Write-Host "Trouvable dans Supabase Dashboard -> Settings -> Database -> 'Database password'"
  $sec = Read-Host "Mot de passe DB (invisible)" -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    $dbPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}
if (-not $dbPassword) {
  Write-Error "Mot de passe vide, abandon."
  exit 1
}

# Construit la connection string en injectant le password.
# Format pooler: postgresql://postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432/postgres
# On insere :<password> avant '@'.
if ($poolerUrl -notmatch "^postgresql://([^@]+)@(.+)$") {
  Write-Error "Format inattendu du pooler URL : $poolerUrl"
  exit 1
}
$userPart = $Matches[1]
$hostPart = $Matches[2]
$encodedPassword = [System.Uri]::EscapeDataString($dbPassword)
$connString = "postgresql://${userPart}:${encodedPassword}@${hostPart}?sslmode=require"

# ---------------------------------------------------------------------------
# 3) Recuperation optionnelle de la service_role key
# ---------------------------------------------------------------------------
if ($PromptServiceRole -and -not $ServiceRoleKey) {
  Write-Step "Cle service_role (pour buckets prives)"
  Write-Host "Trouvable dans Supabase Dashboard -> Settings -> API -> service_role secret"
  Write-Host "Laisse vide pour ignorer les buckets prives."
  $sec = Read-Host "service_role (invisible, ENTER pour skip)" -AsSecureString
  if ($sec.Length -gt 0) {
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    try {
      $ServiceRoleKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    } finally {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }
}
if (-not $ServiceRoleKey -and $env:SUPABASE_SERVICE_ROLE_KEY) {
  $ServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
}

# ---------------------------------------------------------------------------
# 4) Preparation du dossier de sortie
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
# 5) Test de connexion
# ---------------------------------------------------------------------------
Write-Step "Test de connexion PostgreSQL"
$testOk = $false
try {
  $env:PGPASSWORD = $dbPassword
  if ($psql) {
    $out = & $psql "postgresql://${userPart}@${hostPart}?sslmode=require" -c "SELECT current_user;" 2>&1
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Connexion OK"
      $testOk = $true
    } else {
      Write-Warning "Test psql : $out"
    }
  }
} finally {
  $env:PGPASSWORD = $null
}
if (-not $testOk -and $psql) {
  Write-Error "Connexion echouee. Verifie le mot de passe."
  exit 1
}

# ---------------------------------------------------------------------------
# 6) SQL dumps
# ---------------------------------------------------------------------------
$env:PGPASSWORD = $dbPassword
try {
  if (-not $SkipSchema) {
    Write-Step "Dump du schema public"
    & $pgDump $connString --schema=public --schema-only --no-owner --no-privileges --file (Join-Path $sqlDir "schema-public.sql")
    if ($LASTEXITCODE -ne 0) { Write-Warning "Dump schema public partiel/echec (code $LASTEXITCODE)" }
  }

  if (-not $SkipData) {
    Write-Step "Dump des donnees du schema public (COPY)"
    & $pgDump $connString --schema=public --data-only --no-owner --no-privileges --file (Join-Path $sqlDir "data-public.sql")
    if ($LASTEXITCODE -ne 0) { Write-Warning "Dump data public partiel/echec (code $LASTEXITCODE)" }
  }

  if (-not $SkipAuth) {
    Write-Step "Dump du schema auth (utilisateurs)"
    # Note : sur Supabase le compte 'postgres' du pooler n'a pas SELECT sur toutes
    # les tables auth. Ce dump peut echouer en partie et c'est attendu.
    & $pgDump $connString --schema=auth --data-only --no-owner --no-privileges --file (Join-Path $sqlDir "auth-users.sql") 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Dump auth partiel/echec (permissions limitees). Non bloquant."
    }
  }

  Write-Step "Dump du schema storage (metadonnees des buckets/objets)"
  & $pgDump $connString --schema=storage --schema-only --no-owner --no-privileges --file (Join-Path $sqlDir "schema-storage.sql") 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Warning "Dump schema storage partiel/echec." }

  & $pgDump $connString --schema=storage --data-only --no-owner --no-privileges --file (Join-Path $sqlDir "data-storage.sql") 2>&1 | Out-Host
  if ($LASTEXITCODE -ne 0) { Write-Warning "Dump data storage partiel/echec." }
} finally {
  $env:PGPASSWORD = $null
}

# ---------------------------------------------------------------------------
# 7) Storage : telechargement via API REST
# ---------------------------------------------------------------------------
if (-not $SkipStorage) {
  Write-Step "Storage : telechargement des buckets"
  $projectBase = "https://$projectRef.supabase.co"

  # Enumere les buckets si non specifie via parametre.
  if (-not $Buckets) {
    if ($ServiceRoleKey) {
      try {
        $bucketsResp = Invoke-RestMethod -Uri "$projectBase/storage/v1/bucket" `
          -Headers @{ apikey = $ServiceRoleKey; Authorization = "Bearer $ServiceRoleKey" } `
          -Method Get
        $Buckets = $bucketsResp | ForEach-Object { $_.name }
      } catch {
        Write-Warning "Impossible de lister les buckets via API : $($_.Exception.Message)"
        $Buckets = @("event-posters", "hr-documents", "payslips")
      }
    } else {
      # Fallback : liste connue Humana.
      $Buckets = @("event-posters", "hr-documents")
    }
  }

  foreach ($bucket in $Buckets) {
    Write-Host ""
    Write-Host "  Bucket: $bucket" -ForegroundColor Yellow
    $bucketDir = Join-Path $storeDir $bucket
    New-Item -ItemType Directory -Path $bucketDir -Force | Out-Null

    # 1) Recupere l'info du bucket (public/prive)
    $isPublic = $false
    if ($ServiceRoleKey) {
      try {
        $info = Invoke-RestMethod -Uri "$projectBase/storage/v1/bucket/$bucket" `
          -Headers @{ apikey = $ServiceRoleKey; Authorization = "Bearer $ServiceRoleKey" } `
          -Method Get -ErrorAction Stop
        $isPublic = [bool]$info.public
      } catch {
        Write-Warning "    Bucket '$bucket' inaccessible via API : $($_.Exception.Message)"
        continue
      }
    }
    Write-Host "    Public : $isPublic"

    # 2) Liste recursive des objets
    if (-not $ServiceRoleKey) {
      Write-Warning "    Sans service_role, impossible de lister ce bucket. Skip."
      continue
    }
    $allObjects = @()
    $prefixes = @("")
    while ($prefixes.Count -gt 0) {
      $prefix = $prefixes[0]
      $prefixes = $prefixes[1..($prefixes.Count - 1)]
      if ($null -eq $prefixes) { $prefixes = @() }
      $offset = 0
      $pageSize = 1000
      while ($true) {
        $body = @{
          prefix = $prefix
          limit  = $pageSize
          offset = $offset
          sortBy = @{ column = "name"; order = "asc" }
        } | ConvertTo-Json
        try {
          $page = Invoke-RestMethod -Uri "$projectBase/storage/v1/object/list/$bucket" `
            -Headers @{ apikey = $ServiceRoleKey; Authorization = "Bearer $ServiceRoleKey"; "Content-Type" = "application/json" } `
            -Method Post -Body $body -ErrorAction Stop
        } catch {
          Write-Warning "    List error prefix='$prefix' : $($_.Exception.Message)"
          break
        }
        if (-not $page -or $page.Count -eq 0) { break }
        foreach ($item in $page) {
          # Un item est soit un fichier (id != null) soit un sous-dossier (id == null).
          if ($item.id) {
            $fullName = if ($prefix) { "$prefix/$($item.name)" } else { $item.name }
            $allObjects += @{ name = $fullName; size = $item.metadata.size }
          } else {
            $subPrefix = if ($prefix) { "$prefix/$($item.name)" } else { $item.name }
            $prefixes += $subPrefix
          }
        }
        if ($page.Count -lt $pageSize) { break }
        $offset += $pageSize
      }
    }
    Write-Host "    $($allObjects.Count) objets trouves"

    # 3) Telecharge chaque objet.
    $ok = 0; $err = 0
    foreach ($obj in $allObjects) {
      $relPath = $obj.name -replace "/", [IO.Path]::DirectorySeparatorChar
      $destFile = Join-Path $bucketDir $relPath
      $destParent = Split-Path $destFile -Parent
      if (-not (Test-Path $destParent)) {
        New-Item -ItemType Directory -Path $destParent -Force | Out-Null
      }

      $downloadUrl = if ($isPublic) {
        "$projectBase/storage/v1/object/public/$bucket/$($obj.name)"
      } else {
        "$projectBase/storage/v1/object/$bucket/$($obj.name)"
      }

      try {
        $headers = @{}
        if (-not $isPublic) {
          $headers = @{ apikey = $ServiceRoleKey; Authorization = "Bearer $ServiceRoleKey" }
        }
        Invoke-WebRequest -Uri $downloadUrl -OutFile $destFile -Headers $headers -UseBasicParsing -ErrorAction Stop
        $ok++
      } catch {
        Write-Warning "    Echec $($obj.name) : $($_.Exception.Message)"
        $err++
      }
    }
    Write-Host "    OK: $ok / KO: $err"
  }
}

# ---------------------------------------------------------------------------
# 8) Manifest (integrite SHA256)
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
  createdAt   = (Get-Date).ToString("o")
  hostname    = $env:COMPUTERNAME
  user        = $env:USERNAME
  pgDump      = $pgDumpVersion
  projectRef  = $projectRef
  buckets     = if ($SkipStorage) { @() } else { $Buckets }
  totalFiles  = $manifestEntries.Count
  totalBytes  = ($manifestEntries | Measure-Object -Property size -Sum).Sum
  files       = $manifestEntries
}
$manifest | ConvertTo-Json -Depth 5 | Out-File -FilePath (Join-Path $backupDir "MANIFEST.json") -Encoding utf8
Write-Host "Manifest ecrit : MANIFEST.json ($($manifestEntries.Count) fichiers, $([math]::Round($manifest.totalBytes / 1MB, 2)) Mo)"

# ---------------------------------------------------------------------------
# 9) Compression / chiffrement (optionnel)
# ---------------------------------------------------------------------------
if ($ArchivePassword) {
  Write-Step "Compression + chiffrement 7z (AES-256, en-tete chiffre)"
  if (-not (Test-Cmd "7z")) {
    Write-Warning "7-Zip introuvable. Installe : winget install 7zip.7zip"
    Write-Warning "Le dossier en clair reste dans $backupDir."
  } else {
    $archive = "$backupDir.7z"
    & 7z a "-p$ArchivePassword" -mhe=on -mx=7 -y $archive "$backupDir\*" | Out-Host
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
# 10) Resume
# ---------------------------------------------------------------------------
Write-Step "Termine"
if (Test-Path $backupDir) {
  Get-ChildItem -Recurse $backupDir -File | Sort-Object FullName | Format-Table `
    @{ Name="Fichier"; Expression={ $_.FullName.Substring($backupDir.Length + 1) } }, `
    @{ Name="Taille"; Expression={ if ($_.Length -lt 1KB) { "$($_.Length) o" } elseif ($_.Length -lt 1MB) { "{0:N0} Ko" -f ($_.Length/1KB) } else { "{0:N2} Mo" -f ($_.Length/1MB) } } }
}

Write-Host ""
Write-Host "Restauration :" -ForegroundColor Yellow
Write-Host "  psql `"<CONNECTION_STRING>`" -f sql\schema-public.sql"
Write-Host "  psql `"<CONNECTION_STRING>`" -f sql\data-public.sql"
