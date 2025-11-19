# Restore-deps.ps1 - safe helper to restore node_modules and fix native Expo package
# Run this from project root:
# powershell -ExecutionPolicy Bypass -File .\scripts\restore-deps.ps1            # do cleanup + install
# powershell -ExecutionPolicy Bypass -File .\scripts\restore-deps.ps1 -StartDev  # do cleanup+install and start dev (npm run dev)

Write-Host "Starting dependency restore..." -ForegroundColor Cyan
$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $root
param(
    [switch]$StartDev
)

function SafeRemove($path) {
    if (Test-Path $path) {
        Write-Host "Removing: $path" -ForegroundColor Yellow
        try {
            Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
        } catch {
            Write-Host "Failed to remove $path: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "Not found (skipping): $path" -ForegroundColor DarkGray
    }
}

# Remove top-level node_modules and any nested components/node_modules
SafeRemove "node_modules"
SafeRemove "components\node_modules"

# Remove package-lock.json if present
if (Test-Path "package-lock.json") {
    Write-Host "Removing package-lock.json" -ForegroundColor Yellow
    Remove-Item -LiteralPath "package-lock.json" -Force
}

# Run npm install
Write-Host "Running npm install... this may take a while" -ForegroundColor Cyan
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "npm install failed (exit code $LASTEXITCODE)" -ForegroundColor Red
    exit $LASTEXITCODE
}

# Run fix-native (install correct expo-file-system version)
Write-Host "Running npm run fix-native (expo install expo-file-system)" -ForegroundColor Cyan
try {
    npm run fix-native
    if ($LASTEXITCODE -ne 0) { throw "fix-native failed with exit code $LASTEXITCODE" }
} catch {
    Write-Host "npm run fix-native failed: $_" -ForegroundColor Yellow
    Write-Host "Attempting fallback: npx -y expo install expo-file-system@~15.2.2" -ForegroundColor Cyan
    try {
        & npx -y expo install expo-file-system@~15.2.2
    } catch {
        Write-Host "npx expo failed: $_" -ForegroundColor Red
        Write-Host "Trying to install expo-cli globally as a last resort..." -ForegroundColor Yellow
        try {
            npm install -g expo-cli
            npm run fix-native
        } catch {
            Write-Host "Global expo install also failed: $_" -ForegroundColor Red
            Write-Host "Please install expo-cli manually or run the expo install command yourself." -ForegroundColor Red
        }
    }
}

# Cleanup temporary shims that may have been created during debugging
$shims = @(
    "node_modules\expo-module-scripts\tsconfig.base.json",
    "node_modules\@ljharb\tsconfig\tsconfig.json",
    "node_modules\react-native\types\index.d.ts",
    "node_modules\react-native\types\modules\BatchedBridge.d.ts",
    "node_modules\react-native\types\modules\Codegen.d.ts",
    "node_modules\react-native\types\modules\Devtools.d.ts",
    "node_modules\react-native\types\modules\LaunchScreen.d.ts",
    "node_modules\react-native\types\modules\globals.d.ts",
    "node_modules\react-native\types\private\TimerMixin.d.ts",
    "node_modules\react-native\types\private\Utilities.d.ts",
    "node_modules\react-native\types\public\DeprecatedPropertiesAlias.d.ts",
    "node_modules\react-native\types\public\Insets.d.ts",
    "node_modules\react-native\types\public\ReactNativeRenderer.d.ts",
    "node_modules\react-native\types\public\ReactNativeTypes.d.ts"
)

Write-Host "Cleaning temporary shim files if present..." -ForegroundColor Cyan
foreach ($s in $shims) { SafeRemove $s }

Write-Host "Dependency restore complete. Next steps:" -ForegroundColor Green
Write-Host "  1) Start the Expo server: npx expo start -c" -ForegroundColor Gray
Write-Host "  2) Start the local scraper server: npm run server" -ForegroundColor Gray
Write-Host "  3) Or start both: npm run dev" -ForegroundColor Gray

Write-Host "If you still see TypeScript/VSCode errors, reload the window and restart the TS server." -ForegroundColor Yellow

if ($StartDev) {
    Write-Host "Starting dev processes (npm run dev)..." -ForegroundColor Cyan
    try {
        npm run dev
    } catch {
        Write-Host "Failed to start dev: $_" -ForegroundColor Red
    }
}
