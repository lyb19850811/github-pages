#!/bin/bash
# 每日编排：生成今日 AI 资讯日报 → 同步进站 → 提交推送
set -euo pipefail

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export LANG="${LANG:-en_US.UTF-8}"

SKILL_DIR="${HOME}/.workbuddy/skills/ai-news-daily"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG="${SKILL_DIR}/run_daily.log"
OMP_BIN="${HOME}/.local/bin/omp"

echo "=== $(date '+%F %T') 开始 ===" >> "${LOG}"

# 1) 非交互跑技能，生成今日日报（含微信推送 + 归档）
"${OMP_BIN}" -p "今天的AI新闻" \
  --cwd "${SKILL_DIR}" \
  --auto-approve >> "${LOG}" 2>&1

# 2) 同步进站
"${REPO_DIR}/scripts/sync-news.sh" "$(date +%F)" >> "${LOG}" 2>&1

# 3) 提交推送（无变更则跳过）
cd "${REPO_DIR}"
git add "_news/$(date +%F).md"
if git diff --cached --quiet; then
  echo "无内容变更，跳过提交" >> "${LOG}"
else
  git commit -m "news: $(date +%F) 日报" >> "${LOG}" 2>&1
  git push >> "${LOG}" 2>&1
fi

echo "=== $(date '+%F %T') 完成 ===" >> "${LOG}"
