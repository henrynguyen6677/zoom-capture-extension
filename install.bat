@echo off
setlocal enabledelayedexpansion

:: 2-Step Zoom Recording Downloader — Native Host Installer for Windows
:: Double-click to install. No dependencies required.

set HOST_NAME=com.henry.zoomcurl
set BINARY_NAME=zoom-native-host
set REPO=henrynguyen6677/zoom-capture-extension
set VERSION=v1.2.1
set EXT_ID=mlhhonogkpdlokgahndkikdobjnpbgbb

set HOST_DIR=%LOCALAPPDATA%\zoom-native-host
set BINARY_PATH=%HOST_DIR%\%BINARY_NAME%.exe
set MANIFEST_PATH=%HOST_DIR%\%HOST_NAME%.json

:: Detect architecture
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" (
    set ARCH=arm64
) else if "%PROCESSOR_ARCHITECTURE%"=="AMD64" (
    set ARCH=amd64
) else (
    echo Unsupported architecture: %PROCESSOR_ARCHITECTURE%
    pause
    exit /b 1
)

set DOWNLOAD_URL=https://github.com/%REPO%/releases/download/%VERSION%/%BINARY_NAME%-windows-%ARCH%.exe

echo ========================================
echo  2-Step Zoom Recording Downloader
echo  Native Host Installer (Windows)
echo ========================================
echo.
echo Architecture: %ARCH%
echo Extension ID: %EXT_ID%
echo.

:: Create directory
if not exist "%HOST_DIR%" mkdir "%HOST_DIR%"

:: Download binary using curl (built-in on Windows 10+)
echo Downloading native host binary...
curl -fsSL "%DOWNLOAD_URL%" -o "%BINARY_PATH%"
if errorlevel 1 (
    echo ERROR: Download failed. Check your internet connection.
    pause
    exit /b 1
)
echo Done: %BINARY_PATH%

:: Write manifest JSON
echo Creating manifest...
(
echo {
echo   "name": "%HOST_NAME%",
echo   "description": "Zoom recording downloader native host",
echo   "path": "%BINARY_PATH:\=\\%",
echo   "type": "stdio",
echo   "allowed_origins": [
echo     "chrome-extension://%EXT_ID%/"
echo   ]
echo }
) > "%MANIFEST_PATH%"
echo Done: %MANIFEST_PATH%

:: Register in Windows registry
echo Registering native host...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%" /ve /d "%MANIFEST_PATH%" /f >nul 2>&1
if errorlevel 1 (
    echo ERROR: Failed to register in registry.
    pause
    exit /b 1
)
echo Done: Registry updated

echo.
echo ========================================
echo  Installation complete!
echo  Please restart Chrome if it is running.
echo ========================================
echo.
pause
