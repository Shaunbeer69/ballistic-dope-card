@echo off
set NODE_EXE=C:\Program Files\nodejs\node.exe
set NPM_CMD=C:\Program Files\nodejs\npm.cmd
setlocal EnableExtensions EnableDelayedExpansion

rem ==========================================================
rem  GUNSTUFF Build + Sync + Android Deliverable
rem
rem  What it does:
rem   1) Generate src/assets/documents/index.json
rem   2) Bump patch version (scripts\bump-patch.js)
rem   3) ng build
rem   4) cap copy (your cap:sync)
rem   5) Verify PDFs bundled into Android assets
rem   6) Build Android DEBUG APK
rem   7) Produce ONE named deliverable via npm run android:rename:debug
rem
rem  Optional:
rem   -release   -> also build Release AAB and rename it
rem   -studio    -> open Android Studio at the end
rem
rem  Examples:
rem    ABuildApp.bat
rem    ABuildApp.bat -studio
rem    ABuildApp.bat -release
rem    ABuildApp.bat -release -studio
rem ==========================================================

set DO_RELEASE=0
set DO_STUDIO=0

:parseArgs
if "%~1"=="" goto argsDone
if /I "%~1"=="-release" set DO_RELEASE=1
if /I "%~1"=="-studio"  set DO_STUDIO=1
shift
goto parseArgs

:argsDone

echo Node: %NODE_EXE%
echo NPM : %NPM_CMD%
echo Release: %DO_RELEASE%
echo Studio : %DO_STUDIO%
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

if not exist "scripts\rename-android-artifacts.js" (
  echo ERROR: Missing scripts\rename-android-artifacts.js
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

rem ---- Capacitor copy ----
echo.
echo Running capacitor copy (cap:sync)...
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
  echo If PDFs do not open, cap copy may not have copied the web assets.
)
echo.

rem ---- Build Android Debug APK ----
echo Building Android DEBUG APK...
pushd android
call gradlew.bat assembleDebug
if errorlevel 1 goto error
popd

rem ---- Rename/make ONE deliverable debug file ----
echo.
echo Creating named DEBUG deliverable...
call "%NPM_CMD%" run android:rename:debug
if errorlevel 1 goto error

rem ---- Optional Release build (AAB for Play Store) ----
if "%DO_RELEASE%"=="1" (
  echo.
  echo Building Android RELEASE AAB...
  pushd android
  call gradlew.bat bundleRelease
  if errorlevel 1 goto error
  popd

  echo.
  echo Creating named RELEASE deliverable (AAB)...
  call "%NPM_CMD%" run android:rename:release-aab
  if errorlevel 1 goto error
)

rem ---- Optional: Open Android Studio ----
if "%DO_STUDIO%"=="1" (
  echo.
  echo Opening Android Studio...
  call "%NPM_CMD%" run android
  if errorlevel 1 goto error
)

echo.
echo DONE SUCCESSFULLY
exit /b 0

:error
echo.
echo BUILD FAILED!
pause
exit /b 1
