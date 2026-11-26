# wx-sticker-skill

一个**不绑定特定客户端**的开源 Agent Skill，支持将已有九宫格离线切成 9 张 PNG，并将本地表情包目录一键整理为符合**微信表情开放平台**（`sticker.weixin.qq.com`）规范的全套投稿素材，并通过任意浏览器自动化工具（Chrome DevTools MCP / Playwright MCP / 内置浏览器 Agent）自动填表、上传并检查浅色/深色模式预览。

兼容 **Claude Code**、**OpenAI Codex**、**Antigravity**、**Cursor** 以及独立命令行调用。

## 核心能力

- **免费九宫格切图**：已有 3×3 大图 → 9 张独立 PNG，自动寻找分隔带，保留原始单格分辨率和透明通道；无需 API Key，可继续整理投稿素材。

- **全套合规素材构建（[build-pack.mjs](skills/wechat-sticker-publish/scripts/build-pack.mjs)）**：
  - `240×240` 主图批量缩放（支持 8–24 张，自动识别透明/不透明）
  - **透明底贴纸模式（零 API 费用、完全离线）**：自动去除顶部深色描边文案、外圈细黑线和白边，抠出无白边 `240×240` 透明封面与 `50×50` 透明大头图标，并合成无字 `750×400` 横幅、`750×560` 赞赏引导图与 `750×750` 赞赏致谢图
  - **满版照片模式（支持多生图后端）**：内置 OpenAI（`gpt-image-1`，原生透明 PNG）与 OpenRouter API 调用，也兼容宿主 Agent 自带生图工具 + 本地软色键绿幕抠图去溢色
  - 自动生成浅色（`#FFFFFF`）+ 微信深色（`#191919`）双底质检图 + 全字段规格校验（`verify`）
- **默认投稿偏好**：
  - 默认勾选并填好「**表情赞赏**」（5–15 字引导语 + 750×560 引导图 + 750×750 致谢图）
  - 版权可配置（默认 `汽水铺`），下载地区默认 `全球`
  - **绝不自动点击「提交」**，留给创作者在浏览器中终审确认
  - 生成的素材包默认**不提交 Git**

## 目录结构

```text
wx-sticker-skill/
├── README.md
├── package.json
└── skills/
    └── wechat-sticker-publish/
        ├── SKILL.md                   # 跨 Agent 通用工作流说明
        ├── scripts/
        │   ├── slice-grid.mjs         # 离线九宫格切图
        │   └── build-pack.mjs         # 缩放 / 去白边拼图 / API 生图 / 绿幕软抠图 / 规格校验
        └── references/
            └── platform-spec.md       # 微信表情开放平台实时字段、尺寸、字数与审核避坑表
```

---

## 一条命令安装

需要 Node.js ≥ 20.3（sharp 运行要求）。在终端运行：

```bash
npx skills add lili21/wx-sticker-skill
```

按提示选择使用的 Agent 和安装范围即可，支持 Claude Code、Codex、Cursor、Antigravity 等。无需克隆仓库或手动创建软链接。

安装后，在 Agent 中直接说：

> 帮我把 /path/to/stickers 里的表情整理成微信表情投稿素材，并填写上传页面。

已有九宫格也可以直接说：

> 把 /path/to/grid.png 切成 9 张独立表情 PNG，再整理成微信投稿素材。

只需要切图时说“切成 9 张，不生成投稿素材”。

Agent 会在首次使用时自动安装图像处理依赖、生成素材并校验；有浏览器工具时自动填表，最终提交由你确认。只需要素材时直接说“生成投稿素材，不上传”。

[在 skills.sh 查看](https://skills.sh/lili21/wx-sticker-skill/wechat-sticker-publish) · [Skills CLI 文档](https://skills.sh/docs/cli)

---

## 免费 Skill 与 soda

免费 Skill 负责处理已有作品：切图、整理投稿素材、规格校验和辅助上传。参考照生成原创表情、重绘修改等由 **soda（汽水铺）付费服务**提供，不包含在此 Skill 内。下文的 API 生图仅用于已有表情的配套投稿图，不生成原创九宫格。

## 使用前提

1. **已有图片**：一张 **3×3 九宫格**，或包含 **8–24 张**静态图片的目录（PNG / JPG / WebP / GIF）。
2. **浏览器自动填表（可选）**：
   - 启动本机 **Google Chrome** 并开启 `chrome://inspect/#remote-debugging`；
   - 在 Chrome 中微信扫码登录 `https://sticker.weixin.qq.com`（开通赞赏需账号具备艺术家/赞赏资格）；
   - 如当前 Agent 未挂载浏览器工具，Skill 仍会生成并校验全套本地素材及 `form.md` 供手动上传。
3. **满版照片自动生成配套图（可选）**：
   - 透明底 PNG 贴纸**无需任何 API Key**，完全离线运行；
   - 满版带背景照片需配置 `OPENAI_API_KEY`（推荐，原生支持透明 PNG）或 `OPENROUTER_API_KEY`，也可使用宿主 Agent 自带的生图工具。

可选环境变量：

```bash
export OPENAI_API_KEY="sk-..."                     # 或 OPENROUTER_API_KEY="sk-or-..."
export WX_STICKER_IMAGE_MODEL="gpt-image-1"        # 可选，覆盖默认生图模型
export WX_STICKER_IMAGE_BASE_URL="..."             # 可选，自定义兼容端点
```

---

## 独立 CLI 用法

如需独立运行 CLI，先克隆仓库并安装依赖（Agent 用户无需执行）：

```bash
git clone https://github.com/lili21/wx-sticker-skill.git
cd wx-sticker-skill
npm install
```

然后在终端运行：

```bash
SCRIPT="$PWD/skills/wechat-sticker-publish/scripts/build-pack.mjs"

# 0) 已有九宫格离线切成 9 张 PNG（输出目录必须尚不存在）
node "$SCRIPT" slice \
  --input /path/to/grid.png \
  --output /path/to/sticker-slices

# 默认自动寻找分隔带；需要严格均分时加 --mode equal
# 查看全部切图与 slice-report.json，确认人物、文字未被切断。
# 保留原背景，不自动去白底；透明切图可接 transparent，不透明切图走照片模式。

# 1) 透明底 PNG 贴纸目录：离线一键出全套素材 + 浅/深色质检图
node "$SCRIPT" transparent \
  --input /path/to/png-stickers \
  --output /path/to/png-stickers/pack \
  --palette sky \
  --qa /tmp/qa-cover-icon.png

# 2) 满版照片目录：调用 OpenAI / OpenRouter API 自动生成并后处理全套素材
OPENAI_API_KEY=... node "$SCRIPT" generate \
  --input /path/to/photo-stickers \
  --output /path/to/photo-stickers/pack \
  --theme "a plump cream-golden British shorthair cat wearing a knitted cupcake hat" \
  --qa /tmp/qa-cover-icon.png

# 3) 仅缩放主图（240x240 PNG）
node "$SCRIPT" stickers \
  --input /path/to/stickers \
  --output /path/to/stickers/pack/stickers

# 4) 已有绿幕封面/图标原料图 + 横幅/赞赏原料图：软抠图并裁剪至精确规格
node "$SCRIPT" chroma \
  --cover-raw /path/to/cover-green.png \
  --icon-raw /path/to/icon-green.png \
  --banner-raw /path/to/banner-raw.jpg \
  --guide-raw /path/to/guide-raw.jpg \
  --thanks-raw /path/to/thanks-raw.jpg \
  --output /path/to/pack \
  --qa /tmp/qa-cover-icon.png

# 5) 规格自检（像素、格式、体积、透明/不透明通道）
node "$SCRIPT" verify --pack /path/to/pack
```
