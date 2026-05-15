#!/bin/bash
# 台股自動交易排程腳本
# 交易時段：週一至週五 09:00-13:30 (UTC+8) = 01:00-05:30 UTC
# 每15分鐘執行一次

cd /home/ubuntu/.openclaw/workspace/tw-stock-investor-pwa

# 執行交易引擎
node trade-engine.js >> trade-cron.log 2>&1

# 如果交易成功，推送狀態到 GitHub Pages
if [ -f trade-state.json ]; then
  # 複製狀態到 JSON 供前端讀取
  cp trade-state.json state-export.json
fi
