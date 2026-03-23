#!/bin/bash
# 量化机器人定时任务脚本
# 用法：chmod +x cron.sh，然后加入 crontab
#
# 每小时执行一次（适合日线策略）：
#   0 * * * * /path/to/vibe-portfolio/cron.sh >> /tmp/crypto-cron.log 2>&1
#
# 每15分钟执行一次（适合15m/1h策略）：
#   */15 * * * * /path/to/vibe-portfolio/cron.sh >> /tmp/crypto-cron.log 2>&1

curl -s "http://localhost:3004/api/crypto/cron?secret=local-cron-secret-2026" | python3 -m json.tool
echo "--- $(date) ---"
