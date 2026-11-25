---
name: wechat-sticker-publish
description: >-
  Prepare compliant WeChat Sticker Open Platform (微信表情开放平台, sticker.weixin.qq.com)
  album submission assets (240x240 stickers, 750x400 banner, transparent 240x240 cover,
  transparent 50x50 chat icon, 750x560 appreciation guide, 750x750 appreciation thank-you)
  and fill/upload the web submission form via browser automation. Use when the user asks
  to publish, upload, or prepare a folder of stickers for 微信表情开放平台.
---

# WeChat Sticker Open Platform Publishing Workflow

End-to-end runbook for turning a local folder of 8–24 static stickers into a fully compliant WeChat Sticker Open Platform album draft and filling the web submission form.

For exact live form fields, dropdown values, pixel sizes, and review rules, read [references/platform-spec.md](./references/platform-spec.md).

## Default Preferences (Apply Unless User Overrides)

- **表情赞赏 (Appreciation / Tipping)**: **Enabled (`接受赞赏` checked) by default**, including `赞赏引导语` (5–15 Chinese chars), `赞赏引导图` (750×560), and `赞赏致谢图` (750×750).
- **版权 (Copyright)**: Configurable per request; default to `汽水铺` if not specified by the user and no artist name is shown in the header.
- **下载地区 (Download Region)**: Default to `全球`.
- **Never Auto-Submit**: **NEVER** click `提交` (final submit), and do not click `保存` unless the user explicitly asks. Leave the filled form open in Chrome for human review.
- **Git Hygiene**: Do **NOT** commit generated sticker pack assets (`<input>/pack/`) to Git unless the user explicitly asks to commit them.

---

## Step 1: Inspect Input Folder & Read All Stickers

1. List files in the input directory and check dimensions, format, and whether images have transparency (`sips` / `file`).
   - Verify sticker count is **8–24**. If `< 8` or `> 24`, stop and tell the user.
2. Read **all** sticker images with `read_file` in parallel to:
   - Identify the protagonist (species/character, appearance, recurring props/style).
   - Transcribe every caption verbatim in exact sorted order.
   - **Spot any AI typos or awkward wording** (e.g., wrong Chinese character) and flag them to the user in the final summary.
   - Draft non-duplicate Mandarin meaning words (`含义词`, ≤ 4 Chinese characters each, no punctuation), album name (`名称`, ≤ 8 Chinese characters, ≤ 5–6 ideal, no punctuation), album intro (`介绍`, ≤ 80 Chinese characters, no emoji/special chars), and humorous appreciation prompt (`赞赏引导语`, 5–15 Chinese characters).

---

## Step 2: Generate Submission Assets (`<input>/pack/`)

All processing uses the bundled script: [scripts/build-pack.mjs](./scripts/build-pack.mjs) (run via `node ~/projects/wx-sticker-skill/skills/wechat-sticker-publish/scripts/build-pack.mjs ...`).

Choose the asset track based on the source images:

### Track A: Source Stickers Are Transparent RGBA PNGs (e.g., Die-Cut Stickers with White Outline)

Prefer programmatic extraction first — zero image-generation quota cost and 100% identity fidelity:

```bash
node ~/projects/wx-sticker-skill/skills/wechat-sticker-publish/scripts/build-pack.mjs transparent \
  --input "<input_dir>" \
  --output "<input_dir>/pack" \
  --qa "<scratch_dir>/qa-cover-icon.png"
```

- Pick the best sticker indices (`1`-based) via flags if defaults aren't ideal:
  - `--cover <n>`: prefer a full-body pose with no flat bottom edge.
  - `--icon <n>`: prefer a large, centered, front-facing smiling head.
  - `--banner <n1,n2,n3>`: pick 3 varied poses (left, center hero, right).
  - `--guide <n>`: pick an endearing/pleading pose for `赞赏引导图`.
  - `--thanks <n>`: pick a cheerful/waving/heart pose for `赞赏致谢图`.
  - `--palette <sky|warm|pink>`: match the protagonist's color scheme.

### Track B: Source Stickers Are Opaque Full-Bleed Photos (JPG/PNG with Background)

1. Resize the main stickers to exact `240×240` PNG:
   ```bash
   node ~/projects/wx-sticker-skill/skills/wechat-sticker-publish/scripts/build-pack.mjs stickers \
     --input "<input_dir>" \
     --output "<input_dir>/pack/stickers"
   ```
2. Generate 5 raw auxiliary images in parallel with `image-generator` referencing 2–4 representative source stickers:
   - **Cover raw** (1:1): front-facing full/half body, ~12% empty margin on all 4 sides, solid flat `#00FF00` chroma-key green background, no shadows, no white outline, no text, avoid green eyes/props.
   - **Icon raw** (1:1): front-facing **head-only** (no shoulders/hat/props), ~15% margin on all 4 sides, solid flat `#00FF00` background, no shadows, no white outline, no text.
   - **Banner raw** (16:9 / 15:8): lively warm non-white cafe/themed scene featuring protagonist + signature props, **zero text/letters/logos**.
   - **Appreciation guide raw** (4:3): cute "please treat me" pose, warm non-white opaque background, **zero text**.
   - **Appreciation thanks raw** (1:1): joyful grateful pose with hearts/sparkles, warm non-white opaque background, **zero text**.
3. Run soft chroma-key matte + unmix + despill + exact resizing + QA sheet:
   ```bash
   node ~/projects/wx-sticker-skill/skills/wechat-sticker-publish/scripts/build-pack.mjs chroma \
     --cover-raw "<cover_raw>" \
     --icon-raw "<icon_raw>" \
     --banner-raw "<banner_raw>" \
     --guide-raw "<guide_raw>" \
     --thanks-raw "<thanks_raw>" \
     --output "<input_dir>/pack" \
     --qa "<scratch_dir>/qa-cover-icon.png"
   ```

---

## Step 3: Mandatory Verification & Visual QA (Before Touching Browser)

1. Run programmatic spec verification:
   ```bash
   node ~/projects/wx-sticker-skill/skills/wechat-sticker-publish/scripts/build-pack.mjs verify \
     --pack "<input_dir>/pack"
   ```
   All checks must pass (exact dimensions, allowed format, byte caps, transparent alpha on cover & icon, opaque on banner & appreciation images).
2. Visually inspect with `read_file` in parallel:
   - `<scratch_dir>/qa-cover-icon.png` (check both white background and `#191919` WeChat dark mode for zero green fringe, zero white halo/outline, zero jagged edges, zero ear/fur clipping).
   - `<input_dir>/pack/banner.jpg` (zero text, no clipped top tips, balanced layout).
   - `<input_dir>/pack/appreciation-guide.jpg` and `appreciation-thanks.jpg` (zero text, clean framing, no awkward floating flat cuts).
3. If ANY visual defect appears (clipped ear/hair, flat bottom floating mid-air, white halo, leftover text), fix parameters and re-inspect before uploading.

---

## Step 4: Fill & Upload via Browser (`/browser`)

1. Check if the `browser` subagent is available. If not, explain that WeChat Sticker Open Platform requires browser login and recommend the user invoke `/browser`.
2. If Chrome connection fails with `DevToolsActivePort (ENOENT)`, ask the user to confirm Google Chrome is running and enable `chrome://inspect/#remote-debugging`.
3. In the `browser` subagent:
   - **Never overwrite an unsaved form.** Open a **new tab** to `https://sticker.weixin.qq.com/cgi-bin/mmemoticonwebnode-bin/pages/stickerPage/detail` (if not logged in, stop at the QR code login screen and ask the user to scan).
   - **Section 1 (上传表情)**: Select `静态表情`, upload `stickers/01.png`..`NN.png` in exact order, fill each `含义词`, visually confirm 1-to-1 thumbnail-to-meaning alignment.
   - **Section 2 (填写基本信息)**: Fill `名称`, `介绍`, `版权`, upload `banner.jpg`, `cover.png`, `icon.png`.
   - **Section 3 (填写附加信息)**: Select `类型` (usually `卡通表情/其他` for pets/illustrations), `角色/内容` cascading category, 1–2 `表情风格`, `表情主题` (`万能通用` when mixed), `下载地区` (`全球`), **check `接受赞赏`** and fill `赞赏引导语` + upload `appreciation-guide.jpg` & `appreciation-thanks.jpg`. Leave `版权证明` unchecked unless user provides authorization docs.
   - Verify **zero** red validation errors or upload warnings.
   - Inspect both **Light Mode (`浅色模式预览效果`)** and **Dark Mode (`深色模式预览效果`)** in the right-hand preview panel, then switch back to Light Mode.
   - **STOP without clicking `保存` or `提交`**. Leave the tab open and report the complete checklist to the user.
