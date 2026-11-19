@echo off
chcp 65001 >nul
REM =====================================================================
REM  Backup do banco do Sistema de Controle do Efetivo (Supabase)
REM  Uso: dê dois cliques. A senha do banco é pedida na tela.
REM  ATENÇÃO: o arquivo gerado contém dados pessoais e de saúde.
REM  Guarde em pasta protegida. NUNCA no GitHub, no OneDrive compartilhado ou por e-mail.
REM =====================================================================

REM 1) Cole aqui a "Connection string" do Supabase:
REM    Supabase > botão Connect > Session pooler > URI (SEM a senha; apague ":[YOUR-PASSWORD]")
set CONEXAO=postgresql://postgres.SEU-PROJETO@aws-0-sa-east-1.pooler.supabase.com:5432/postgres

REM 2) Pasta onde os backups ficam (fora da pasta do projeto)
set PASTA=%USERPROFILE%\Documents\backup-efetivo

REM 3) Localiza o pg_dump (instalado com as "Command Line Tools" do PostgreSQL)
set PGDUMP=pg_dump
for /d %%d in ("C:\Program Files\PostgreSQL\*") do if exist "%%d\bin\pg_dump.exe" set PGDUMP="%%d\bin\pg_dump.exe"

if not exist "%PASTA%" mkdir "%PASTA%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set DATA=%%i
set ARQ=%PASTA%\efetivo_%DATA%.sql

echo.
echo Gerando backup em: %ARQ%
echo Digite a senha do banco quando for pedida (ela não aparece enquanto digita).
echo.
%PGDUMP% "%CONEXAO%" --schema=public --no-owner --no-privileges --file="%ARQ%"
if errorlevel 1 (
  echo.
  echo *** FALHOU. Confira a connection string, a senha e se o pg_dump está instalado.
  pause
  exit /b 1
)
for %%A in ("%ARQ%") do echo Backup concluído: %%~zA bytes.
echo.
pause
