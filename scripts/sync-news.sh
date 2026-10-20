#!/bin/bash
# 同步某一天的 AI 资讯日报到站点 _news/（仅生成文件，不提交）
# 用法: sync-news.sh [YYYY-MM-DD]   （缺省为今天）
set -euo pipefail

DATE="${1:-$(date +%F)}"
SKILL_DIR="${HOME}/.workbuddy/skills/ai-news-daily"
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
  cat "${SRC}"
} > "${DST}"

echo "已写入 ${DST}"
