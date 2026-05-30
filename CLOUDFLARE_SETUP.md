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

### 3. 构建设置
- **构建命令**：（留空，纯静态站点无需构建）
- **输出目录**：（留空，使用根目录）
- **框架预设**：选择「无」

### 4. 部署
点击「保存并部署」，Cloudflare 会自动：
- 拉取 GitHub 仓库代码
- 部署到 `*.pages.dev` 子域名
- 之后每次 `git push` 都会自动重新部署

### 5. 自定义域名（可选）
在 Pages 项目设置中绑定自定义域名。

---

部署后访问地址将是：`https://<项目名>.pages.dev`
