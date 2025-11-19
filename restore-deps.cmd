@echo off
REM Wrapper to run the PowerShell restore script from CMD or by double-clicking
echo Running dependency restore (this will remove node_modules and reinstall)...
powershell -ExecutionPolicy Bypass -NoProfile -Command "& { Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -NoProfile -File "%~dp0scripts\restore-deps.ps1" -StartDev' -Verb RunAs }"
pause
