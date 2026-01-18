@echo off
set NODE_EXE=C:\Program Files\nodejs\node.exe
set NPM_CMD=C:\Program Files\nodejs\npm.cmd
setlocal EnableExtensions EnableDelayedExpansion

rem ============================================
rem  GUNSTUFF Build + Sync + Android Studio
rem  - Hard-set NODE_EXE / NPM_CMD (your preference)
rem  - Auto-generate src/assets/documents/index.json
rem  - Verify docs are bundled into Android assets
rem ============================================

echo Node: %NODE_EXE%
echo NPM : %NPM_CMD%
echo.

rem ---- Validate node/npm paths ----
if not exist "%NODE_EXE%" (
  echo ERROR: node.exe not found at: %NODE_EXE%
  echo Fix NODE_EXE at the top of this BAT.
  echo.
  pause
  exit /b 1
)

if not exist "%NPM_CMD%" (
  echo ERROR: npm.cmd not found at: %NPM_CMD%
  echo Fix NPM_CMD at the top of this BAT.
  echo.
  pause
  exit /b 1
)

rem ---- Project root sanity ----
if not exist "package.json" (
  echo ERROR: package.json not found. Run this bat from the project root.
  echo.
  pause
  exit /b 1
)

rem ---- Required scripts ----
if not exist "scripts\bump-patch.js" (
  echo ERROR: Missing scripts\bump-patch.js
  echo.
  pause
  exit /b 1
)

if not exist "scripts\generate-doc-index.js" (
  echo ERROR: Missing scripts\generate-doc-index.js
  echo.
  pause
  exit /b 1
)

rem ---- Documents folder ----
echo Checking src\assets\documents...
if not exist "src\assets\documents" (
  echo ERROR: Missing folder src\assets\documents
  echo.
  pause
  exit /b 1
)

echo.
echo Documents in src\assets\documents (before index generation):
dir /b "src\assets\documents"
echo.

rem ---- Auto-generate index.json from PDFs ----
echo Generating src\assets\documents\index.json from PDFs...
call "%NODE_EXE%" "scripts\generate-doc-index.js"
if errorlevel 1 goto error

echo.
echo Documents in src\assets\documents (after index generation):
dir /b "src\assets\documents"
echo.

rem ---- Bump patch version ----
echo Bumping patch version...
call "%NODE_EXE%" "scripts\bump-patch.js"
if errorlevel 1 goto error

rem ---- Angular build ----
echo.
echo Running ng build...
call "%NPM_CMD%" run build
if errorlevel 1 goto error

rem ---- Capacitor sync/copy ----
echo.
echo Running capacitor sync/copy...
call "%NPM_CMD%" run cap:sync
if errorlevel 1 goto error

rem ---- Verify docs in Android bundle ----
echo.
echo Checking Android bundled documents...
if exist "android\app\src\main\assets\public\assets\documents" (
  echo Found: android\app\src\main\assets\public\assets\documents
  dir /b "android\app\src\main\assets\public\assets\documents"
) else (
  echo WARNING: android\app\src\main\assets\public\assets\documents not found.
  echo If PDFs do not open, cap sync may not have copied the web assets.
)
echo.

rem ---- Open Android Studio ----
echo Opening Android Studio...
call "%NPM_CMD%" run android
if errorlevel 1 goto error

echo.
echo DONE SUCCESSFULLY
exit /b 0

:error
echo.
echo BUILD FAILED!
pause
exit /b 1
