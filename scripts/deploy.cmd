@echo off
rem Double-click or run from anywhere: deploys web + api to Vercel and checks them.
node "%~dp0deploy.mjs" %*
set code=%errorlevel%
if "%~1"=="" pause
exit /b %code%
