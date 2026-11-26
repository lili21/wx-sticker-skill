---
name: wechat-sticker-publish
description: >-
  Prepare compliant WeChat Sticker Open Platform (微信表情开放平台, sticker.weixin.qq.com)
  album submission assets (240x240 stickers, 750x400 banner, transparent 240x240 cover,
  transparent 50x50 chat icon, 750x560 appreciation guide, 750x750 appreciation thank-you)
  and fill/upload the web submission form via any available browser automation tool
  (Chrome DevTools MCP, Playwright MCP, or built-in browser agent). Use when the user asks
  to publish, upload, or prepare a folder of stickers for 微信表情开放平台.
---

# WeChat Sticker Open Platform Publishing Workflow

Agent-agnostic runbook compatible with **Claude Code**, **Codex**, **Antigravity**, **Cursor**, and any coding agent supporting standard Agent Skills.

For exact live form fields, dropdown values, pixel sizes, and review rejection points, read [references/platform-spec.md](./references/platform-spec.md).

All image processing scripts live in [scripts/build-pack.mjs](./scripts/build-pack.mjs) relative to this skill directory (denoted `<SKILL_DIR>` below). The installed skill is self-contained; no repository checkout is needed.

Before processing images, check Node.js is ≥ 20.3 and that `sharp` can be loaded from the skill directory. If dependencies are missing, run `npm ci --prefix "<SKILL_DIR>" --no-audit --no-fund` yourself, then continue the requested workflow. Do not ask the user to clone the repository, create symlinks, or install dependencies manually. If installation fails, report the actual error and stop processing until resolved. Resolve `<SKILL_DIR>` to the directory containing this SKILL.md, and quote its absolute path in shell commands.

## Default Preferences (Apply Unless User Overrides)

- **表情赞赏 (Appreciation / Tipping)**: **Enabled (`接受赞赏` checked) by default**, including `赞赏引导语` (5–15 Chinese chars), `赞赏引导图` (750×560), and `赞赏致谢图` (750×750).
- **版权 (Copyright)**: Configurable per request; default to `汽水铺` if not specified by the user and no artist name is shown in the platform header.
- **下载地区 (Download Region)**: Default to `全球`.
- **Never Auto-Submit**: **NEVER** click `提交` (final submit), and do not click `保存` unless the user explicitly asks. Leave the filled form open in Chrome for human review.
- **Git Hygiene**: Do **NOT** commit generated sticker pack assets (`<input>/pack/`) to Git unless the user explicitly asks.

---

## Step 1: Inspect Input Folder & Read All Stickers

1. List image files in the input directory and inspect dimensions, formats, and alpha transparency.
   - Verify count is **8–24**. If `< 8` or `> 24`, stop and inform the user.
2. View **all** sticker images (in parallel if supported) to:
   - Identify the protagonist (species/character, appearance, recurring props/style).
   - Transcribe every caption verbatim in exact sorted filename order.
   - **Spot any AI typos, garbled strokes, or brand logos** and flag them to the user in the summary.
   - Draft:
     - Non-duplicate Mandarin meaning words (`含义词`, ≤ 4 Chinese characters each, no punctuation)
     - Album name (`名称`, ≤ 8 Chinese characters, ≤ 5–6 ideal, no punctuation)
     - Album intro (`介绍`, ≤ 80 Chinese characters, no emoji/special chars)
     - Humorous appreciation prompt (`赞赏引导语`, 5–15 Chinese characters)

---

## Step 2: Generate Submission Assets (`<input>/pack/`)

Choose the asset track based on the input images and available tools:

### Track A: Source Stickers Are Transparent RGBA PNGs (Offline, Zero API Cost)

Use programmatic extraction first — 100% identity fidelity, zero external API calls, works in any environment:

```bash
node <SKILL_DIR>/scripts/build-pack.mjs transparent \
  --input "<input_dir>" \
  --output "<input_dir>/pack" \
  --qa "/tmp/wx-sticker-qa.png"
```

Optional tuning flags (`1`-based sticker indices):
- `--cover <n>`: full-body pose with no flat bottom cut
- `--icon <n>`: large, centered, front-facing smiling head
- `--banner <n1,n2,n3>`: 3 varied poses (left, center hero, right)
- `--guide <n>`: endearing/pleading pose for `赞赏引导图`
- `--thanks <n>`: joyful/waving/heart pose for `赞赏致谢图`
- `--palette <sky|warm|pink>`: backdrop palette matching the protagonist

### Track B: Source Stickers Are Opaque Full-Bleed Photos (JPG/PNG with Background)

Pick the first available option:

1. **Option B1 — API Mode (Recommended for Claude Code / Codex / CLI)**:
   If `OPENAI_API_KEY` (supports native transparent PNG via `gpt-image-1`) or `OPENROUTER_API_KEY` is set:
   ```bash
   node <SKILL_DIR>/scripts/build-pack.mjs generate \
     --input "<input_dir>" \
     --output "<input_dir>/pack" \
     --theme "<short visual description of the protagonist>" \
     --qa "/tmp/wx-sticker-qa.png"
   ```
   Optional overrides: `--provider openai|openrouter`, `--model <model>`, `--base-url <url>`, `--refs <img1,img2>`.

2. **Option B2 — Host Agent Built-In Image Tool** (e.g., Antigravity `image-generator`):
   - Resize main stickers:
     ```bash
     node <SKILL_DIR>/scripts/build-pack.mjs stickers \
       --input "<input_dir>" \
       --output "<input_dir>/pack/stickers"
     ```
   - Generate 5 raw auxiliary images referencing 2–4 source stickers:
     - **Cover raw** (1:1): front-facing full/half body, ~12% empty margin on all 4 sides, solid `#00FF00` background (no shadows, no white outline, no text, no green props/eyes).
     - **Icon raw** (1:1): front-facing **head-only** (no shoulders/hat/props), ~15% margin on all 4 sides, solid `#00FF00` background, no white outline, no text.
     - **Banner raw** (16:9 / 15:8): lively warm non-white scene with protagonist + signature props, **zero text/logos**.
     - **Appreciation guide raw** (4:3): cute "please treat me" pose, warm non-white opaque background, **zero text**.
     - **Appreciation thanks raw** (1:1): joyful grateful pose with hearts/sparkles, warm non-white opaque background, **zero text**.
   - Run soft chroma-key matte + unmix + despill + exact resizing + QA sheet:
     ```bash
     node <SKILL_DIR>/scripts/build-pack.mjs chroma \
       --cover-raw "<cover_raw>" \
       --icon-raw "<icon_raw>" \
       --banner-raw "<banner_raw>" \
       --guide-raw "<guide_raw>" \
       --thanks-raw "<thanks_raw>" \
       --output "<input_dir>/pack" \
       --qa "/tmp/wx-sticker-qa.png"
     ```

3. **Option B3 — User-Provided Raw Images**:
   If neither API keys nor an image tool are available, resize the main stickers with `stickers`, explain which raw auxiliary images are missing, and stop or process user-supplied images with `chroma`.

---

## Step 3: Mandatory Verification & Visual QA

1. Run programmatic validation:
   ```bash
   node <SKILL_DIR>/scripts/build-pack.mjs verify --pack "<input_dir>/pack"
   ```
   Every file must report `[PASS]`.
2. Visually inspect:
   - `/tmp/wx-sticker-qa.png` (both `#FFFFFF` light mode and `#191919` dark mode: zero green fringe, zero white halo/stroke, zero clipped ears/fur).
   - `<input_dir>/pack/banner.jpg`, `appreciation-guide.jpg`, `appreciation-thanks.jpg` (zero text, clean framing, no awkward floating flat cuts).
3. Fix any visual defects and re-verify before uploading.

---

## Step 4: Fill & Upload on WeChat Sticker Open Platform

Use whichever browser automation tool is attached to your session (`chrome-devtools-mcp`, `@playwright/mcp`, or built-in browser agent):

1. **If a browser tool is available**:
   - Connect to the user's Chrome instance (if connection fails with `DevToolsActivePort`, ask the user to start Google Chrome and enable `chrome://inspect/#remote-debugging`).
   - **Never overwrite an unsaved form.** Open a **new tab** to `https://sticker.weixin.qq.com/cgi-bin/mmemoticonwebnode-bin/pages/stickerPage/detail`.
   - If not logged in, stop on the WeChat QR code login page and ask the user to scan. Never bypass login or captchas.
   - Fill all 3 sections:
     - **上传表情**: `静态表情`, upload `stickers/01.png`..`NN.png` in order, enter each `含义词`, visually verify 1-to-1 thumbnail-to-meaning match.
     - **基本信息**: fill `名称`, `介绍`, `版权`, upload `banner.jpg`, `cover.png`, `icon.png`.
     - **附加信息**: select `类型` (`卡通表情/其他` for pets/illustrations), `角色/内容`, 1–2 `表情风格`, `表情主题`, `下载地区` (`全球`), **check `接受赞赏`** and fill `赞赏引导语` + upload `appreciation-guide.jpg` & `appreciation-thanks.jpg`. Leave `版权证明` unchecked unless authorization docs are provided.
   - Verify **zero** red validation errors or upload warnings.
   - Inspect both **浅色模式预览效果** and **深色模式预览效果**, then switch back to Light Mode.
   - **STOP without clicking `保存` or `提交`**. Leave the tab open and present the full checklist to the user.

2. **If no browser tool is available**:
   - Write `<input_dir>/pack/form.md` containing every pre-filled field (`名称`, `介绍`, `版权`, 逐张 `含义词`, 附加信息选项, `赞赏引导语`) and the list of verified image paths so the user can upload manually in ~1 minute, and remind them which browser MCP / command enables auto-fill in their client.
