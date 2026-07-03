@echo off
rem ローカル開発サーバー起動（Claude Code のプレビュー用）
cd /d "%~dp0..\web"
npm run dev -- --port 5173 --strictPort
