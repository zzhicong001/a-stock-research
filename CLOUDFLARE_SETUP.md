# Cloudflare Pages 部署指南

## 前提条件
- 已有 GitHub 仓库（本仓库）
- 已有 Cloudflare 账号

## 部署步骤

### 1. 登录 Cloudflare
访问 https://dash.cloudflare.com/ 并登录

### 2. 创建 Pages 项目
1. 左侧菜单 → **Workers & Pages** → **创建** → **Pages**
2. 选择 **连接到 Git**
3. 授权并选择你的 GitHub 仓库

### 3. 构建设置 ⚠️ 关键步骤

> **构建命令** 必须填写 `node gen_files.js`，这样才能自动发现新文件！

- **构建命令**：`node gen_files.js`
- **输出目录**：（留空，使用根目录）
- **框架预设**：选择「无」

**为什么需要构建命令？**

`index.html` 通过 `files.json` 展示文档列表。`gen_files.js` 会扫描目录自动生成 `files.json`。
配置构建命令后，每次推送新文件，Cloudflare 会自动运行 `node gen_files.js` 刷新清单，
无需在本地手动执行。

### 4. 部署
点击「保存并部署」，Cloudflare 会自动：
- 拉取 GitHub 仓库代码
- 部署到 `*.pages.dev` 子域名
- 之后每次 `git push` 都会自动重新部署

### 5. 自定义域名（可选）
在 Pages 项目设置中绑定自定义域名。

---

部署后访问地址将是：`https://<项目名>.pages.dev`
