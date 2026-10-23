# Release notes 覆盖

在此目录放置 `<tag>.md`（例如 `v2.0.3.md`），发布该 tag 时会优先使用该文件作为
GitHub Release 正文。

适合人工撰写中英双语、按功能/修复/体验分类的发布说明；没有对应文件时，
`.github/workflows/release.yml` 会调用 `scripts/release-notes.mjs`，按
Conventional Commits 类型自动生成提交清单并标注提交者。
