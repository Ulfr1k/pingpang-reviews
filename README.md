# pingpang-reviews

ITTF 认证长胶评价库 — 数据仓库

## 仓库结构

```
pingpang-reviews/
├── scraper/
│   ├── scraper.mjs        # ITTF API 爬虫（直连，无需浏览器）
│   └── package.json
├── data/
│   ├── larc-long-rubbers.json   # 长胶清单（229条）
│   └── ratings.json             # 用户评分汇总（自动生成）
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   └── rating.yml           # 评分表单模板
│   └── workflows/
│       ├── sync-ittf.yml        # 每周日同步 ITTF 数据
│       └── aggregate-ratings.yml # 每小时汇总评分
└── README.md
```

## 工作流程

### 1. 数据同步（全自动）
- **频率**：每周日 UTC 00:00
- **方式**：直连 ITTF Azure API（`Equipment_RacketCoverings/all_list`），过滤 `PimpleType=Long`
- **无变化**：静默退出
- **有变化**：自动 commit + push，触发 `pingpang-site` 重新构建
- **失败**：自动创建 Issue 提醒人工介入

### 2. 用户评分
- 用户通过 GitHub Issue 表单提交评分（`.github/ISSUE_TEMPLATE/rating.yml`）
- 每条 Issue = 一条评分记录
- Actions 每小时自动汇总所有 Issue，生成 `data/ratings.json`

### 3. 前端展示
- `pingpang-site` 从本仓库读取 `data/larc-long-rubbers.json` 和 `data/ratings.json`
- 通过 GitHub Pages 静态托管

## API 端点（爬虫使用）

| 用途 | URL |
|------|-----|
| 长胶列表 | `https://ittf-admin-api.azurewebsites.net/api/Equipment_RacketCoverings/all_list?limit=100&skip=0&custom_filter=[{"name":"PimpleType","value":"Long"}]` |
| 胶皮详情 | `https://ittf-admin-api.azurewebsites.net/api/Equipment_RacketCovering/{id}/Details` |

## 本地运行爬虫

```bash
cd scraper
node scraper.mjs              # 仅列表数据
node scraper.mjs --with-detail # 含详情（图片、颜色等）
```

## 密钥配置

在仓库 Settings → Secrets 中添加：
- `PAT_TOKEN`：Personal Access Token，用于触发 `pingpang-site` 重建（需 `repo` 权限）
