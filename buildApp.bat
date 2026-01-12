@echo off
setlocal

cd /d "%~dp0"

echo ================================
echo GS DOPE ANDROID BUILD
echo ================================
echo Working folder: %CD%
echo.

REM --- Find Node executable used by Windows ---
for /f "delims=" %%i in ('where node 2^>nul') do set "NODE_EXE=%%i"
if not defined NODE_EXE (
  echo ERROR: node not found on PATH for this window.
  echo Fix: reinstall Node OR add it to system PATH.
  echo.
  pause
  exit /b 1
)

REM --- Find NPM command ---
for /f "delims=" %%i in ('where npm 2^>nul') do set "NPM_CMD=%%i"
if not defined NPM_CMD (
  echo ERROR: npm not found on PATH for this window.
  echo.
  pause
  exit /b 1
)

echo Node: %NODE_EXE%
echo NPM : %NPM_CMD%
echo.

if not exist "scripts\bump-patch.js" (
  echo ERROR: Missing scripts\bump-patch.js
  echo.
  pause
  exit /b 1
)

echo Bumping patch version...
call "%NODE_EXE%" "scripts\bump-patch.js"
if errorlevel 1 goto error

echo.
echo Running ng build...
call "%NPM_CMD%" run build
if errorlevel 1 goto error

echo.
echo Running capacitor sync/copy...
call "%NPM_CMD%" run cap:sync
if errorlevel 1 goto error

echo.
echo Opening Android Studio...
call "%NPM_CMD%" run android
if errorlevel 1 goto error

echo.
echo DONE SUCCESSFULLY
pause
exit /b 0

:error
echo.
echo BUILD FAILED!
pause
exit /b 