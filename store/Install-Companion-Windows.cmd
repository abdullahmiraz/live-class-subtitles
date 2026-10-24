@echo off
rem Live Class Subtitles companion: double-click to install (Windows 10/11, no admin rights needed).
rem It runs the official installer from GitHub: https://github.com/abdullahmiraz/live-class-subtitles/blob/main/install.ps1
title Live Class Subtitles - installing the companion app
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/abdullahmiraz/live-class-subtitles/main/install.ps1 | iex"
echo.
pause
