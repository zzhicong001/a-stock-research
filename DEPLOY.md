# 完整部署方案：A股研报 → GitHub → Cloudflare Pages

---

## 项目概览

```
H:\buddy\
├── index.html              # 首页（暗色主题，从 files.json 动态加载文档目录）
├── files.json              # 文档清单（gen_files.js 自动生成）
├── gen_files.js            # Node.js 扫描脚本，自动发现所有研报文件
├── _headers                # Cloudflare 缓存策略
├── README.md               # GitHub 项目说明
├── .gitignore              # 排除 .workbuddy、task目录等个人数据
├── 📄 卖方报告_2026-05-29.md
├── 📄 戴尔产业链_A股受益标的_2026-05-29.{md,html}
├── 📄 Anthropic_A股受益标的_2026-05-29.{md,html}
├── 📄 戴尔概念股_李朋整理_2026-05-29.html
├── 📄 特朗普Q1持仓盈亏分析_2026-05-30.html
└── 📄 特朗普个股提及_Q1_2026持仓.html
```

**特性：**
- 纯静态站，零后端依赖
- 首页自动展示所有研报，支持标签筛选
- 推送新文件后 Cloudflare 自动构建，无需手动维护 `files.json`
- 暗色主题，适合长时间阅读

---

## 第一步：准备工作（已完成）

> 如果你是新克隆仓库，以下已在本地完成：

- [x] Git 仓库已初始化（6 个 commits）
- [x] `.gitignore` 已配置（排除个人工作数据）
- [x] `index.html` + `gen_files.js` + `files.json` 已就绪
- [x] `_headers` Cloudflare 缓存策略已配置

---

## 第二步：连接 GitHub 并推送

### 2.1 在 WorkBuddy 中连接 GitHub

1. 打开 WorkBuddy 左侧「**连接器**」面板
2. 找到 **GitHub** → 点击连接
3. 按提示完成 GitHub OAuth 授权

### 2.2 创建 GitHub 仓库

在 GitHub 网页创建新仓库，例如 `a-stock-research`，**不要勾选**「Initialize this repository with a README」（因为本地已有 README）。

记下仓库地址，例如：`https://github.com/你的用户名/a-stock-research.git`

### 2.3 推送本地代码

连接 GitHub 后，在 WorkBuddy 中告诉我仓库地址，我来执行推送；或你手动运行：

```bash
cd H:\buddy
git remote add origin https://github.com/你的用户名/a-stock-research.git
git branch -M master main        # 如果 GitHub 默认分支是 main
git push -u origin main
```

---

## 第三步：配置 Cloudflare Pages

### 3.1 登录 Cloudflare

访问 [https://dash.cloudflare.com/](https://dash.cloudflare.com/) 并登录（没有账号就注册一个，免费）。

### 3.2 创建 Pages 项目

1. 左侧菜单 → **Workers & Pages**
2. 点击「**创建**」→ 选择「**Pages**」标签
3. 点击「**连接到 Git**」
4. 授权 Cloudflare 访问你的 GitHub 账号
5. 选择刚才创建的仓库（`a-stock-research`）
6. 点击「**开始设置**」

### 3.3 构建设置（⚠️ 关键！）

| 设置项 | 填写内容 | 说明 |
|--------|----------|------|
| **项目名称** | `a-stock-research` | 随意命名 |
| **生产分支** | `main`（或 `master`） | 与你的默认分支一致 |
| **框架预设** | **无** | 不是 React/Vue 项目 |
| **构建命令** | **`node gen_files.js`** | ⚠️ 必须填写！ |
| **构建输出目录** | 留空 | 使用仓库根目录 |

> **为什么填 `node gen_files.js`？**
> 
> 每次 GitHub 推送 → Cloudflare 自动拉取代码 → 执行此命令扫描所有文件 → 生成 `files.json` → 首页就能显示新文件了。全自动，无需任何手动操作。

### 3.4 环境变量（可选）

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `NODE_VERSION` | `22` | 指定 Node.js 版本（可选，Cloudflare 默认已支持） |

### 3.5 点击「保存并部署」

Cloudflare 将自动：
1. 拉取你的 GitHub 仓库
2. 运行 `node gen_files.js` 生成 `files.json`
3. 部署所有文件到 CDN 全球节点
4. 分配一个 `*.pages.dev` 的子域名

部署完成后你会看到类似这样的地址：
```
https://a-stock-research.pages.dev
```

---

## 第四步：验证

### 4.1 检查首页

浏览器打开 `https://你的项目名.pages.dev`，应该看到：
- 顶部标题「A股研报 & 投资分析」
- 标签筛选栏（AI算力、戴尔、特朗普…）
- 6 篇报告的卡片列表
- 点击卡片或格式标签（HTML/MD）可跳转到对应文件

### 4.2 检查关键文件

| URL | 应显示 |
|-----|--------|
| `/index.html` | 首页 |
| `/files.json` | JSON 格式的文档清单 |
| `/戴尔产业链_A股受益标的_2026-05-29.html` | 戴尔产业链报告 |

### 4.3 首次部署如果失败

进入 Pages 项目 → 「**部署**」→ 查看构建日志。

常见问题：

| 错误 | 解决方案 |
|------|----------|
| `node: command not found` | 确认框架预设选「无」，Cloudflare Pages 默认自带 Node.js |
| 文件找不到 | 检查 `.gitignore` 是否误排除了 `gen_files.js` |
| `files.json` 为空 | 检查研报文件是否都在仓库根目录，`gen_files.js` 只扫描根目录 |

---

## 第五步：日常使用

### 新增研报（唯一操作）

```bash
# 1. 把新研报放到 H:\buddy\ 目录
# 2. 提交推送
cd H:\buddy
git add 新研报.html
git commit -m "新增 xxx 研报"
git push
```

**不需要**：本地运行 `gen_files.js`、手动更新 `files.json`、打开 Cloudflare 后台。

Cloudflare 收到推送后会自动跑构建，首页自动更新，通常 1-2 分钟完成。

### 自定义域名（可选）

1. 在 Cloudflare Pages 项目 → 「**自定义域**」→ 设置域名
2. 在域名 DNS 中添加 CNAME 记录指向 `你的项目名.pages.dev`
3. 等待 DNS 生效（通常几分钟）

---

## 项目维护

### 修改首页样式

编辑 `H:\buddy\index.html`，提交推送即可。CSS 变量集中在 `:root` 块，改颜色很方便：

```css
:root {
  --bg: #0f1117;        /* 背景色 */
  --card-bg: #1a1d28;   /* 卡片背景 */
  --accent: #f59e0b;    /* 强调色 */
}
```

### 修改自动标签规则

编辑 `gen_files.js` 中的 `TAG_MAP`：

```js
const TAG_MAP = [
  { keywords: ['戴尔', 'DELL'], tag: '戴尔' },
  { keywords: ['Anthropic'], tag: 'Anthropic' },
  // 在这里添加新的标签规则
  { keywords: ['新能源', '光伏', '锂电'], tag: '新能源' },
];
```

### 修改扫描排除规则

编辑 `gen_files.js` 中的 `SKIP`：

```js
const SKIP = new Set([
  'README.md', 'CLOUDFLARE_SETUP.md', 'index.html',
  '_headers', '.gitignore', 'gen_files.js', 'files.json',
  'DEPLOY.md'  // 新增排除文件
]);
```

---

## 总结

```
你做的事                     Cloudflare 做的事
─────────                    ────────────────
git push ─────────────────→ 拉取代码
                             node gen_files.js  ← 自动扫描目录
                             生成 files.json     ← 自动刷新清单
                             部署到全球 CDN       ← 自动上线
                             首页自动显示新文件   ← 无须任何手动
```
