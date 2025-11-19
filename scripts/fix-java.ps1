<#
PowerShell helper to detect installed JDKs, set JAVA_HOME, update
android/gradle.properties org.gradle.java.home, and optionally run
`npx expo run:android`.

Usage examples:
  # Detect JDKs and print choices
  .\scripts\fix-java.ps1

  # Automatically pick the first candidate, set JAVA_HOME for this shell,
  # update gradle.properties and run the Android build
  .\scripts\fix-java.ps1 -AutoYes -SetPermanent:$false -UpdateGradleProps -RunBuild

Notes:
- This script does not run elevated by default. Use an elevated PowerShell
  if you want to set a machine-level environment variable (not recommended
  unless you know what you're doing).
#>

param(
    [switch]$AutoYes,
    [bool]$SetPermanent = $false,
    [switch]$UpdateGradleProps,
    [switch]$RunBuild
)

function Write-Info($m){ Write-Host "[info] $m" -ForegroundColor Cyan }
function Write-Warn($m){ Write-Host "[warn] $m" -ForegroundColor Yellow }
function Write-Err($m){ Write-Host "[error] $m" -ForegroundColor Red }

Write-Info "Searching for installed JDKs in common locations..."

$candidates = @()
$pathsToCheck = @(
    'C:\Program Files\Eclipse Adoptium',
    'C:\Program Files\Adoptium',
    'C:\Program Files\Temurin',
    'C:\Program Files\Java',
    'C:\Program Files (x86)\Java',
    'C:\Program Files\AdoptOpenJDK'
)

foreach($base in $pathsToCheck){
    if(Test-Path $base){
        try{
            $dirs = Get-ChildItem -Path $base -Directory -ErrorAction Stop | ForEach-Object { $_.FullName }
            foreach($d in $dirs){
                # Accept if it contains bin\java.exe
                if(Test-Path (Join-Path $d 'bin\java.exe')){ $candidates += $d }
            }
        } catch { }
    }
}

# Also probe Windows registry JavaHome for installed JRE/JDKs
try{
    $regPaths = @(
        'HKLM:\SOFTWARE\JavaSoft\Java Development Kit',
        'HKLM:\SOFTWARE\JavaSoft\JDK',
        'HKLM:\SOFTWARE\WOW6432Node\JavaSoft\Java Development Kit',
        'HKLM:\SOFTWARE\WOW6432Node\JavaSoft\JDK'
    )
    foreach($rp in $regPaths){
        if(Test-Path $rp){
            Get-ChildItem $rp -ErrorAction SilentlyContinue | ForEach-Object {
                $verKey = $_.PSChildName
                $javaHome = (Get-ItemProperty -Path (Join-Path $rp $verKey) -Name JavaHome -ErrorAction SilentlyContinue).JavaHome
                if($javaHome -and (Test-Path (Join-Path $javaHome 'bin\java.exe'))){ $candidates += $javaHome }
            }
        }
    }
} catch { }

# Remove duplicates and sort
$candidates = $candidates | Select-Object -Unique

if(-not $candidates -or $candidates.Count -eq 0){
    Write-Warn "No JDKs found in common locations. Please install Temurin/Adoptium JDK 11 or 17 and run this script again."
    Write-Host "Download: https://adoptium.net/"
    exit 1
}

Write-Info "Found the following JDK installations:"
[int]$i=0
foreach($c in $candidates){
    $i++; Write-Host "  [$i] $c"
}

$choice = 1
if(-not $AutoYes){
    $input = Read-Host "Enter number to use as JAVA_HOME (or press Enter for 1)"
    if($input -match '^[0-9]+$'){ $choice = [int]$input }
}

if($choice -lt 1 -or $choice -gt $candidates.Count){
    Write-Err "Invalid selection. Aborting."
    exit 1
}

$selected = $candidates[$choice - 1]
Write-Info "Selected: $selected"

# Set for current shell
$env:JAVA_HOME = $selected
$env:PATH = "$env:JAVA_HOME\bin;" + $env:PATH
Write-Info "JAVA_HOME set for this shell to: $env:JAVA_HOME"
Write-Info "java -version output:"
try{ java -version } catch { Write-Warn "java not found in PATH after setting JAVA_HOME." }

if($SetPermanent){
    Write-Info "Setting persistent user environment variable JAVA_HOME..."
    setx JAVA_HOME "$selected" > $null
    Write-Info "User-level JAVA_HOME set. Close and reopen terminals for permanent variable to take effect." 
}

if($UpdateGradleProps){
    $gp = Join-Path -Path (Get-Location) -ChildPath 'android\gradle.properties'
    if(Test-Path $gp){
        Write-Info "Updating org.gradle.java.home in android/gradle.properties to: $selected"
        (Get-Content $gp) -replace '(?m)^org\.gradle\.java\.home=.*$', "org.gradle.java.home=$selected" | Set-Content $gp
        Write-Info "Updated $gp"
    } else {
        Write-Warn "android/gradle.properties not found in project root. Skipping update."
    }
}

if($RunBuild){
    Write-Info "Running: npx expo run:android"
    Write-Info "Build output will appear below — if the script exits, check the output for errors."
    # Run the build and stream output
    & npx expo run:android
    $rc = $LASTEXITCODE
    if($rc -ne 0){
        Write-Err "Build exited with code $rc"
        exit $rc
    }
}

Write-Info "Done. If you didn't run the build, you can now run: npx expo run:android"
