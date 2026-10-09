#!/usr/bin/env bash
# Phát hành phiên bản mới:  npm run release -- 1.1.0
#  1. Kiểm tra CHANGELOG.md đã có mục "## [1.1.0]"
#  2. Đặt version trong package.json (+ package-lock.json)
#  3. lint (tsc) + test
#  4. commit "release: v1.1.0" + tag v1.1.0
# Sau đó: git push && git push --tags  → GitHub Actions build image + tạo Release.
set -euo pipefail
V="${1:?Cách dùng: npm run release -- X.Y.Z}"
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || { echo "Phiên bản không hợp lệ: $V"; exit 1; }
grep -Eq "^## \[?$V\]?" CHANGELOG.md || { echo "CHANGELOG.md chưa có mục '## [$V]'"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Còn thay đổi chưa commit"; exit 1; }
git rev-parse -q --verify "refs/tags/v$V" >/dev/null && { echo "Tag v$V đã tồn tại"; exit 1; }
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='$V';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
npm install --package-lock-only --ignore-scripts >/dev/null
npm run lint && npm test
git add package.json package-lock.json
git diff --cached --quiet || git commit -m "release: v$V"
git tag "v$V"
echo "✓ Đã tạo tag v$V. Đẩy lên:  git push && git push --tags"
