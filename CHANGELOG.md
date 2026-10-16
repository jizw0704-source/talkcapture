# 更新记录 / Changelog

当前应用版本：0.1.0，本地开发版。本文件记录可定位的最近更新，不表示已发布安装包或完成真实场景验收。界面显示本次构建时间；源码版本使用 Git 提交识别。

## 2026-10-16 · 三批界面与流程整理 / Workflow refinements

- 第一批 / Batch 1 — [da8388b](https://github.com/jizw0704-source/talkcapture/commit/da8388b)：区分首次分组和补充识别，优化名称建议、页状态与输出说明。Clarified grouping actions, title suggestions, page states and output boundaries.
- 第二批 / Batch 2 — [3d0b41c](https://github.com/jizw0704-source/talkcapture/commit/3d0b41c)：共用问题列表、报告名称与原文 Markdown 导出检查入口。Unified issues, report naming and source Markdown export entry points.
- 第三批 / Batch 3 — [067c397](https://github.com/jizw0704-source/talkcapture/commit/067c397)：分组代表缩略图、按需展开的逐页文字与次级操作；显示设置在前、模型配置折叠。Added representative previews and compact controls; display preferences precede collapsed model settings.

三批均保留已有照片、报告分组、页序及人工确认选区。已有名称不会因浏览或升级自动重写；疑似重复照片不自动删除。

Existing photos, report assignments, page order and confirmed crops are preserved. Browsing does not rename reports, and possible duplicates are never automatically deleted.

## 当前主要能力 / Current scope

手机优先上传、全批找角与预览、人工核对、本机纠正经验、照片墙与大图、疑似重复提示、本机 OCR 分报告与命名、按组 PPTX/PDF/原文 Markdown 导出、可选 MiniMax 文字解读、中英文与显示设置。

Phone-first import, batch corner suggestions and previews, manual review and local correction examples, galleries, possible-duplicate hints, local OCR grouping and naming, per-report PPTX/PDF/source Markdown export, optional MiniMax text interpretation, bilingual UI and display preferences.

更早开发与局部测试见 [验证记录](docs/validation.md)；下一轮真实验收见 [实测清单](docs/acceptance.md)。
