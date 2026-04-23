#!/bin/bash
# 量化机器人定时任务脚本
# 用法：chmod +x cron.sh，然后加入 crontab
#
# ── 推荐 crontab 配置（crontab -e）────────────────────────
#
# 每1分钟（支持 1m 策略）：
#   * * * * * /path/to/vibe-portfolio/cron.sh 1m >> /tmp/crypto-cron.log 2>&1
#
# 每5分钟（支持 5m 策略）：
#   */5 * * * * /path/to/vibe-portfolio/cron.sh 5m >> /tmp/crypto-cron.log 2>&1
#
# 每15分钟（支持 15m 策略）：
#   */15 * * * * /path/to/vibe-portfolio/cron.sh 15m >> /tmp/crypto-cron.log 2>&1
#
# 每小时（支持 1h 策略）：
#   0 * * * * /path/to/vibe-portfolio/cron.sh 1h >> /tmp/crypto-cron.log 2>&1
#
# 每4小时（支持 4h 策略）：
#   0 */4 * * * /path/to/vibe-portfolio/cron.sh 4h >> /tmp/crypto-cron.log 2>&1
#
# 每天（支持 1d 策略）：
#   0 8 * * * /path/to/vibe-portfolio/cron.sh 1d >> /tmp/crypto-cron.log 2>&1
#
# ── 不传参数则触发所有机器人（兼容旧版）─────────────────────

INTERVAL=${1:-""}
BASE_URL="http://localhost:3004"
SECRET="local-cron-secret-2026"

if [ -n "$INTERVAL" ]; then
  URL="${BASE_URL}/api/crypto/cron?secret=${SECRET}&interval=${INTERVAL}"
else
  URL="${BASE_URL}/api/crypto/cron?secret=${SECRET}"
fi

curl -s "$URL" | python3 -m json.tool 2>/dev/null || curl -s "$URL"
echo "--- $(date) interval=${INTERVAL:-all} ---"
