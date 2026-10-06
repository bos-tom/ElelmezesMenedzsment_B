@echo off
chcp 65001 >nul
title Döntési oldal – helyi próba (Firebase Emulator)
cd /d "%~dp0"

set "URL=http://localhost:5500/?emulator"

rem Ha már fut, csak megnyitjuk a böngészőben.
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',5500); exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" "%URL%"
  exit /b 0
)

rem A Firebase Emulatorhoz JDK 21 kell; ha a hordozható példány megvan, azt használjuk.
if exist "%USERPROFILE%\.jdks\temurin-21\bin\java.exe" (
  set "JAVA_HOME=%USERPROFILE%\.jdks\temurin-21"
  set "PATH=%USERPROFILE%\.jdks\temurin-21\bin;%PATH%"
)

if not exist "node_modules" (
  echo Csomagok telepítése – első indítás, pár perc...
  call npm install || goto :error
)

rem A böngésző akkor nyílik meg, amikor a helyi szerver már válaszol.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 120;$i++){ try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1',5500); Start-Process '%URL%'; break } catch { Start-Sleep 1 } }"

echo.
echo Döntési oldal – helyi próba
echo   Cím:         %URL%
echo   Belépés:     a csoport 8 címe (admin-config.local.json), vagy admin1@example.com / admin2@example.com
echo   Leállítás:   zárd be ezt az ablakot (vagy Ctrl+C)
echo.
call npm run dev
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo Hiba történt, lásd fent. Az ablak bezárásához nyomj meg egy gombot.
pause >nul
exit /b 1
