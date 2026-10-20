#!/bin/bash
# 同步某一天的 AI 资讯日报到站点 _news/（仅生成文件，不提交）
# 用法: sync-news.sh [YYYY-MM-DD]   （缺省为今天）
set -euo pipefail

DATE="${1:-$(date +%F)}"
SKILL_DIR="${HOME}/.omp/agent/skills/ai-news-daily"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "${REPO_DIR}/_news"

SRC="${SKILL_DIR}/reports/${DATE}.md"
[ -f "${SRC}" ] || { echo "错误：未找到日报 ${SRC}" >&2; exit 1; }

COUNT="$(sed -nE 's/.*覆盖 ([0-9]+) 条.*/\1/p' "${SRC}" | head -n 1)"
SUMMARY="AI 资讯日报"
[ -n "${COUNT}" ] && SUMMARY="覆盖 ${COUNT} 条"

DST="${REPO_DIR}/_news/${DATE}.md"
{
  printf -- '---\n'
  printf 'layout: news\n'
  printf 'title: "AI 资讯日报 · %s"\n' "${DATE}"
  printf 'date: %s\n' "${DATE}"
  printf 'summary: "%s"\n' "${SUMMARY}"
  printf -- '---\n\n'
  printf '# %s\n\n' "${DATE}"
  # 日报正文前 4 行为「标题 + 空行 + 副标题 + 空行」；站点页已有「每日AI资讯」标题，
  # 此处仅保留日期作 pane 标题，去掉重复的「AI 资讯日报」与「自动生成…」副标题。
  tail -n +5 "${SRC}"
} > "${DST}"

echo "已写入 ${DST}"
