# A股研报 & 投资分析

A股产业链深度研究笔记，涵盖 AI 算力、数据中心、美股映射等方向。

> ⚠️ 所有内容仅供研究参考，不构成投资建议。

## 目录结构

```
├── index.html              # 首页（动态目录 + MD 渲染器）
├── gen_files.js            # 自动扫描脚本
├── files.json              # 文档清单（自动生成）
├── README.md
├── DEPLOY.md               # 完整部署指南
├── _headers                # Cloudflare 缓存策略
└── docs/
    └── YYYY-MM-DD/         # 按日期归档
        ├── 报告.md
        └── 报告.html
```

## 浏览

```
https://你的项目名.pages.dev
```

## 使用

```bash
# 新增研报：放入 docs/YYYY-MM-DD/ 文件夹，然后
git add docs/
git commit -m "新增研报"
git push
# Cloudflare 自动构建部署，首页自动更新
```
