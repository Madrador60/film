@echo off
title Publication GitHub - Madrador TV
color 0A

echo ============================================
echo        Publication de Madrador TV
echo ============================================
echo.

cd /d "%~dp0"

echo [1/4] Verification des fichiers...
git status

echo.
echo [2/4] Ajout des modifications...
git add .

echo.
set /p msg=Message du commit (laisser vide = Update) :

if "%msg%"=="" set msg=Update

echo.
echo [3/4] Creation du commit...
git commit -m "%msg%"

echo.
echo [4/4] Publication sur GitHub...

git push origin main

if errorlevel 1 (
    echo.
    echo La branche main n'existe pas, tentative avec master...
    git push origin master
)

echo.
echo ============================================
echo Publication terminee !
echo Si Render est configure en Auto Deploy,
echo le site sera mis a jour automatiquement.
echo ============================================
echo.

pause