# wx-sticker-skill

用于将本地表情包图片目录自动整理、生成配套素材（横幅 / 透明底封面 / 透明底聊天图标 / 赞赏引导图 / 赞赏致谢图）并通过浏览器自动填充上传到**微信表情开放平台**的独立 Antigravity Skill 仓库。

## 目录结构

```text
wx-sticker-skill/
├── README.md
├── package.json
└── skills/
    └── wechat-sticker-publish/
        ├── SKILL.md                   # 主流程与默认偏好
        ├── scripts/
        │   └── build-pack.mjs         # 图像缩放、去白边/顶字、绿幕软抠图、拼图与规格校验 CLI
        └── references/
            └── platform-spec.md       # 微信表情开放平台实时字段、尺寸与审核规范
```

## 安装与全局注册

1. 安装依赖（仅需 `sharp`）：

```bash
cd ~/projects/wx-sticker-skill
npm install
```

2. 在 `~/.gemini/config/skills.json` 注册此目录（全局对所有工作区生效）：

```json
{
  "entries": [
    { "path": "~/projects/wx-sticker-skill/skills" }
  ]
}
```

## 使用方式

在任意项目对话中，向 Antigravity 发送指令并附带 `/browser` 即可：

```text
/browser 帮我把 @[/path/to/stickers] 里的表情包上架到微信表情开放平台
```

- 需提前启动 Google Chrome 并开启 `chrome://inspect/#remote-debugging`，且已扫码登录 `https://sticker.weixin.qq.com`。
- 默认开启并填好「表情赞赏」，版权默认 `汽水铺`（可在指令中覆盖），**绝不自动点击最终「提交」**。
- 生成的投稿包素材默认**不提交 Git**。

## 脚本 CLI 用法

```bash
# 1) 透明贴纸 PNG 目录一键生成全套素材 + 双底质检图
node skills/wechat-sticker-publish/scripts/build-pack.mjs transparent \
  --input /path/to/raw-pngs \
  --output /path/to/raw-pngs/pack \
  --qa /tmp/qa-cover-icon.png

# 2) 满版照片目录：仅缩放主图
node skills/wechat-sticker-publish/scripts/build-pack.mjs stickers \
  --input /path/to/raw-jpgs \
  --output /path/to/raw-jpgs/pack/stickers

# 3) 满版照片配套图：对绿幕原图软抠图 + 裁剪横幅/赞赏图 + 双底质检图
node skills/wechat-sticker-publish/scripts/build-pack.mjs chroma \
  --cover-raw /path/to/cover-green.jpg \
  --icon-raw /path/to/icon-green.jpg \
  --banner-raw /path/to/banner-raw.jpg \
  --guide-raw /path/to/guide-raw.jpg \
  --thanks-raw /path/to/thanks-raw.jpg \
  --output /path/to/raw-jpgs/pack \
  --qa /tmp/qa-cover-icon.png

# 4) 规格自检（校验全部尺寸、格式、体积与透明通道）
node skills/wechat-sticker-publish/scripts/build-pack.mjs verify \
  --pack /path/to/raw-jpgs/pack
```
