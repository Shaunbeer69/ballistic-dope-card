@echo off
cd /d C:\AppDev\ballistic-dope-card\android
call gradlew.bat clean
if errorlevel 1 goto error
call gradlew.bat bundleRelease
if errorlevel 1 goto error

cd /d C:\AppDev\ballistic-dope-card
call npm run android:rename
if errorlevel 1 goto error

echo.
echo DONE - Release AAB output:
echo C:\AppDev\ballistic-dope-card\android\app\build\outputs\bundle\release
exit /b 0

:error
echo BUILD FAILED
exit /b 1
