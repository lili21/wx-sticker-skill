#!/usr/bin/env node
/**
 * WeChat Sticker Open Platform Pack Builder & Verifier (Agent-Agnostic CLI)
 *
 * Subcommands:
 *   slice        Split a 3×3 grid into 9 original-resolution PNGs (offline)
 *   stickers     Resize 8-24 source images to 240x240 PNG (auto contain/cover)
 *   transparent  Build complete pack from transparent RGBA PNG stickers (de-text, de-border, compose)
 *   generate     Generate raw auxiliary images via OpenAI or OpenRouter API (for opaque photo packs)
 *   chroma       Build cover/icon via soft green-screen chroma-key + resize opaque banner/appreciation images
 *   verify       Validate pack dimensions, formats, file sizes, and transparency rules
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { sliceGrid } from "./slice-grid.mjs";

const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (!next || next.startsWith("--")) {
        opts[key] = true;
      } else {
        opts[key] = next;
        i += 1;
      }
    }
  }
  return { cmd, opts };
}

function listImages(dir) {
  return fs
    .readdirSync(dir)
    .filter((name) => IMAGE_RE.test(name) && !name.startsWith("."))
    .sort()
    .map((name) => path.join(dir, name));
}

async function isCornerTransparent(filePath) {
  const { data } = await sharp(filePath)
    .ensureAlpha()
    .resize(32, 32, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const corners = [0, 31, 31 * 32, 32 * 32 - 1].map((idx) => data[idx * 4 + 3]);
  return corners.every((a) => a < 24);
}

async function buildStickers(inputDir, outputDir, fitMode = "auto") {
  const files = listImages(inputDir);
  if (files.length < 8 || files.length > 24) {
    throw new Error(`Expected 8-24 sticker images in ${inputDir}, found ${files.length}.`);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const results = [];
  for (let i = 0; i < files.length; i += 1) {
    const src = files[i];
    const transparent = fitMode === "auto" ? await isCornerTransparent(src) : fitMode === "contain";
    const outPath = path.join(outputDir, `${String(i + 1).padStart(2, "0")}.png`);
    let info;
    if (transparent) {
      const fitted = await sharp(src)
        .resize(232, 232, { fit: "contain", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      info = await sharp({
        create: { width: 240, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{ input: fitted, gravity: "center" }])
        .png({ compressionLevel: 9 })
        .toFile(outPath);
    } else {
      info = await sharp(src)
        .resize(240, 240, { fit: "cover", kernel: "lanczos3" })
        .png({ compressionLevel: 9 })
        .toFile(outPath);
    }
    results.push({ src: path.basename(src), out: path.basename(outPath), bytes: info.size, transparent });
    console.log(
      `${path.basename(src)} -> ${path.basename(outPath)} (${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)}KB, ${transparent ? "transparent" : "opaque"})`,
    );
  }
  return results;
}

/**
 * Strip top dark-outlined caption text, thin outer dark hairline, and neutral white die-cut border
 * from a transparent sticker PNG, keeping only the largest connected component (the main subject).
 */
async function extractCleanCutout(srcPath, options = {}) {
  const { textMaxY = 0.25, textMaxX = 1.0, whiteMin = 232, maxSat = 16, erodePx = 2 } = options;
  const { data, info } = await sharp(srcPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const buf = Buffer.from(data);
  const n = width * height;

  // Step 0: Remove top caption text (neutral charcoal outline + white interior) strictly above subject
  const maxTY = Math.floor(height * textMaxY);
  const maxTX = Math.floor(width * textMaxX);
  const isTextDark = (idx) => {
    const o = idx * 4;
    if (buf[o + 3] < 40) return false;
    const r = buf[o], g = buf[o + 1], b = buf[o + 2];
    return Math.max(r, g, b) <= 88 && Math.max(r, g, b) - Math.min(r, g, b) <= 12;
  };
  const isTextWhite = (idx) => {
    const o = idx * 4;
    if (buf[o + 3] < 40) return false;
    const r = buf[o], g = buf[o + 1], b = buf[o + 2];
    return Math.min(r, g, b) >= 215 && Math.max(r, g, b) - Math.min(r, g, b) <= 14;
  };

  let tm = new Uint8Array(n);
  const tq = new Int32Array(n);
  let th = 0, tt = 0;
  const seedY = Math.floor(height * Math.min(textMaxY, 0.165));
  for (let y = 0; y < seedY; y += 1) {
    for (let x = 0; x < maxTX; x += 1) {
      const idx = y * width + x;
      if (!tm[idx] && isTextDark(idx)) {
        tm[idx] = 1;
        tq[tt++] = idx;
      }
    }
  }
  while (th < tt) {
    const idx = tq[th++];
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0 && !tm[idx - 1] && (isTextDark(idx - 1) || isTextWhite(idx - 1))) { tm[idx - 1] = 1; tq[tt++] = idx - 1; }
    if (x + 1 < maxTX && !tm[idx + 1] && (isTextDark(idx + 1) || isTextWhite(idx + 1))) { tm[idx + 1] = 1; tq[tt++] = idx + 1; }
    if (y > 0 && !tm[idx - width] && (isTextDark(idx - width) || isTextWhite(idx - width))) { tm[idx - width] = 1; tq[tt++] = idx - width; }
    if (y + 1 < maxTY && !tm[idx + width] && (isTextDark(idx + width) || isTextWhite(idx + width))) { tm[idx + width] = 1; tq[tt++] = idx + width; }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const next = Uint8Array.from(tm);
    for (let y = 1; y < maxTY - 1; y += 1) {
      for (let x = 1; x < maxTX - 1; x += 1) {
        const idx = y * width + x;
        if (tm[idx]) continue;
        if (tm[idx - 1] || tm[idx + 1] || tm[idx - width] || tm[idx + width]) {
          const o = idx * 4;
          const sat = Math.max(buf[o], buf[o + 1], buf[o + 2]) - Math.min(buf[o], buf[o + 1], buf[o + 2]);
          if (sat <= 24) next[idx] = 1;
        }
      }
    }
    tm = next;
  }
  for (let i = 0; i < n; i += 1) {
    if (tm[i]) buf[i * 4 + 3] = 0;
  }

  // Step 1: Erode outer hairline
  let solid = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) solid[i] = buf[i * 4 + 3] >= 32 ? 1 : 0;
  for (let pass = 0; pass < erodePx; pass += 1) {
    const next = Uint8Array.from(solid);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = y * width + x;
        if (!solid[idx]) continue;
        if (
          x === 0 || y === 0 || x === width - 1 || y === height - 1 ||
          !solid[idx - 1] || !solid[idx + 1] || !solid[idx - width] || !solid[idx + width]
        ) {
          next[idx] = 0;
        }
      }
    }
    solid = next;
  }
  for (let i = 0; i < n; i += 1) {
    if (!solid[i]) buf[i * 4 + 3] = 0;
  }

  // Step 2: Flood-fill neutral pure-white sticker border from exterior
  const removed = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  const isBorder = (idx) => {
    const o = idx * 4;
    const a = buf[o + 3];
    if (a < 32) return true;
    const r = buf[o], g = buf[o + 1], b = buf[o + 2];
    const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
    if (mn >= whiteMin && mx - mn <= maxSat) return true;
    if (mn >= 210 && mx - mn <= 10 && a < 245) return true;
    return false;
  };
  for (let i = 0; i < n; i += 1) {
    if (buf[i * 4 + 3] < 32) {
      removed[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0 && !removed[idx - 1] && isBorder(idx - 1)) { removed[idx - 1] = 1; queue[tail++] = idx - 1; }
    if (x + 1 < width && !removed[idx + 1] && isBorder(idx + 1)) { removed[idx + 1] = 1; queue[tail++] = idx + 1; }
    if (y > 0 && !removed[idx - width] && isBorder(idx - width)) { removed[idx - width] = 1; queue[tail++] = idx - width; }
    if (y + 1 < height && !removed[idx + width] && isBorder(idx + width)) { removed[idx + width] = 1; queue[tail++] = idx + width; }
  }

  // Soft 1px feather on white-tinted boundary halo
  const halo = new Uint8Array(n);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      if (removed[idx]) continue;
      if (removed[idx - 1] || removed[idx + 1] || removed[idx - width] || removed[idx + width]) {
        const o = idx * 4;
        const mn = Math.min(buf[o], buf[o + 1], buf[o + 2]);
        const mx = Math.max(buf[o], buf[o + 1], buf[o + 2]);
        if (mn >= 205 && mx - mn <= 22) halo[idx] = 1;
      }
    }
  }
  for (let i = 0; i < n; i += 1) {
    if (removed[i]) {
      buf[i * 4] = 0; buf[i * 4 + 1] = 0; buf[i * 4 + 2] = 0; buf[i * 4 + 3] = 0;
    } else if (halo[i]) {
      buf[i * 4 + 3] = Math.round(buf[i * 4 + 3] * 0.45);
    }
  }

  // Step 3: Keep only the largest connected component
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let bestComp = [];
  for (let i = 0; i < n; i += 1) {
    if (seen[i] || buf[i * 4 + 3] < 20) continue;
    const comp = [];
    let top = 0;
    stack[top++] = i;
    seen[i] = 1;
    while (top) {
      const cur = stack[--top];
      comp.push(cur);
      const x = cur % width;
      const y = (cur - x) / width;
      if (x > 0 && !seen[cur - 1] && buf[(cur - 1) * 4 + 3] >= 20) { seen[cur - 1] = 1; stack[top++] = cur - 1; }
      if (x + 1 < width && !seen[cur + 1] && buf[(cur + 1) * 4 + 3] >= 20) { seen[cur + 1] = 1; stack[top++] = cur + 1; }
      if (y > 0 && !seen[cur - width] && buf[(cur - width) * 4 + 3] >= 20) { seen[cur - width] = 1; stack[top++] = cur - width; }
      if (y + 1 < height && !seen[cur + width] && buf[(cur + width) * 4 + 3] >= 20) { seen[cur + width] = 1; stack[top++] = cur + width; }
    }
    if (comp.length > bestComp.length) bestComp = comp;
  }
  const keep = new Uint8Array(n);
  for (const idx of bestComp) keep[idx] = 1;
  for (let i = 0; i < n; i += 1) {
    if (!keep[i]) {
      buf[i * 4] = 0; buf[i * 4 + 1] = 0; buf[i * 4 + 2] = 0; buf[i * 4 + 3] = 0;
    }
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] >= 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const cw = Math.max(1, maxX - minX + 1);
  const ch = Math.max(1, maxY - minY + 1);
  const buffer = await sharp(buf, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: cw, height: ch })
    .png()
    .toBuffer();
  return { buffer, width: cw, height: ch };
}

/**
 * Soft chroma-key matte + foreground color unmix + edge despill for green-screen (#00FF00) raw images.
 * If the input image already has genuine corner transparency, preserves its existing alpha channel cleanly.
 */
async function softChromaKeyPng(inputPath, outPath, targetSize, marginRatio = 0.04) {
  const alreadyTransparent = await isCornerTransparent(inputPath);
  const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const buf = Buffer.from(data);
  const n = width * height;

  if (!alreadyTransparent) {
    let kr = 0, kg = 0, kb = 0, kCount = 0;
    for (const [ox, oy] of [[0, 0], [width - 16, 0], [0, height - 16], [width - 16, height - 16]]) {
      for (let y = oy; y < oy + 16; y += 1) {
        for (let x = ox; x < ox + 16; x += 1) {
          const i = (y * width + x) * 4;
          kr += buf[i]; kg += buf[i + 1]; kb += buf[i + 2]; kCount += 1;
        }
      }
    }
    kr /= kCount; kg /= kCount; kb /= kCount;

    const domAt = (idx) => {
      const i = idx * 4;
      return buf[i + 1] - Math.max(buf[i], buf[i + 2]);
    };

    const ext = new Uint8Array(n);
    const queue = new Int32Array(n);
    let head = 0, tail = 0;
    const push = (idx) => {
      if (ext[idx] || domAt(idx) <= 10) return;
      ext[idx] = 1;
      queue[tail++] = idx;
    };
    for (let x = 0; x < width; x += 1) { push(x); push((height - 1) * width + x); }
    for (let y = 0; y < height; y += 1) { push(y * width); push(y * width + width - 1); }
    while (head < tail) {
      const idx = queue[head++];
      const x = idx % width;
      const y = (idx - x) / width;
      if (x > 0) push(idx - 1);
      if (x + 1 < width) push(idx + 1);
      if (y > 0) push(idx - width);
      if (y + 1 < height) push(idx + width);
    }

    let nearExt = Uint8Array.from(ext);
    for (let step = 0; step < 4; step += 1) {
      const next = Uint8Array.from(nearExt);
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const idx = y * width + x;
          if (nearExt[idx]) continue;
          if (nearExt[idx - 1] || nearExt[idx + 1] || nearExt[idx - width] || nearExt[idx + width]) next[idx] = 1;
        }
      }
      nearExt = next;
    }

    const low = 16, high = 105;
    for (let idx = 0; idx < n; idx += 1) {
      const i = idx * 4;
      if (!nearExt[idx]) {
        buf[i + 3] = 255;
        continue;
      }
      const r = buf[i], g = buf[i + 1], b = buf[i + 2];
      const dom = g - Math.max(r, b);
      let alpha = 1;
      if (ext[idx]) {
        if (dom >= high) alpha = 0;
        else if (dom > low) {
          const t = (dom - low) / (high - low);
          alpha = 1 - t * t * (3 - 2 * t);
        }
      }
      if (alpha <= 0.02) {
        buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0;
      } else {
        let ur = Math.max(0, Math.min(255, (r - (1 - alpha) * kr) / alpha));
        let ug = Math.max(0, Math.min(255, (g - (1 - alpha) * kg) / alpha));
        let ub = Math.max(0, Math.min(255, (b - (1 - alpha) * kb) / alpha));
        const maxRB = Math.max(ur, ub);
        if (ug > maxRB) ug = maxRB;
        buf[i] = Math.round(ur);
        buf[i + 1] = Math.round(ug);
        buf[i + 2] = Math.round(ub);
        buf[i + 3] = Math.round(alpha * 255);
      }
    }
  }

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (buf[(y * width + x) * 4 + 3] >= 20) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const cropped = await sharp(buf, { raw: { width, height, channels: 4 } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();

  const inner = Math.round(targetSize * (1 - marginRatio * 2));
  const fitted = await sharp(cropped)
    .resize(inner, inner, { fit: "contain", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const outInfo = await sharp({
    create: { width: targetSize, height: targetSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: fitted, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  console.log(`${path.basename(outPath)}: ${outInfo.width}x${outInfo.height}, ${(outInfo.size / 1024).toFixed(1)}KB`);
}

async function writeQaSheet(coverPath, iconPath, qaPath) {
  fs.mkdirSync(path.dirname(qaPath), { recursive: true });
  const icon3x = await sharp(iconPath).resize(150, 150, { kernel: "nearest" }).png().toBuffer();
  const makeRow = (bg) =>
    sharp({ create: { width: 520, height: 280, channels: 4, background: bg } })
      .composite([
        { input: coverPath, left: 20, top: 20 },
        { input: icon3x, left: 280, top: 65 },
        { input: iconPath, left: 450, top: 115 },
      ])
      .png()
      .toBuffer();
  const [light, dark] = await Promise.all([makeRow("#ffffff"), makeRow("#191919")]);
  await sharp({ create: { width: 520, height: 560, channels: 4, background: "#888888" } })
    .composite([
      { input: light, left: 0, top: 0 },
      { input: dark, left: 0, top: 280 },
    ])
    .png()
    .toFile(qaPath);
  console.log(`QA sheet: ${qaPath}`);
}

const PALETTES = {
  sky: { banner: ["#a8d8f0", "#c9e9f6", "#fde4b8"], hill: "#f7d794" },
  warm: { banner: ["#ffd8a8", "#ffe9c6", "#ffc9a9"], hill: "#f3c18c" },
  pink: { banner: ["#ffcad4", "#ffe5ec", "#fde4cf"], hill: "#f7b2c4" },
};

async function runTransparentPack(opts) {
  const inputDir = opts.input;
  const outputDir = opts.output || path.join(inputDir, "pack");
  if (!inputDir) throw new Error("Missing --input <dir>");
  const files = listImages(inputDir);
  if (files.length < 8 || files.length > 24) {
    throw new Error(`Expected 8-24 images in ${inputDir}, found ${files.length}.`);
  }

  fs.mkdirSync(outputDir, { recursive: true });
  await buildStickers(inputDir, path.join(outputDir, "stickers"), "contain");

  const pick = (oneBased, fallback) => {
    const idx = Number.parseInt(oneBased, 10);
    return files[Number.isInteger(idx) && idx >= 1 && idx <= files.length ? idx - 1 : Math.min(fallback, files.length - 1)];
  };
  const bannerIndices = (opts.banner ? String(opts.banner).split(",") : ["2", "3", "5"]).map((v, i) =>
    pick(v, Math.min(i, files.length - 1)),
  );
  const coverSrc = pick(opts.cover, 1);
  const iconSrc = pick(opts.icon, files.length - 2);
  const guideSrc = pick(opts.guide, 0);
  const thanksSrc = pick(opts.thanks, files.length - 1);

  const [coverCut, iconCut, bLeft, bCenter, bRight, guideCut, thanksCut] = await Promise.all([
    extractCleanCutout(coverSrc, { textMaxY: 0.24 }),
    extractCleanCutout(iconSrc, { textMaxY: 0.24 }),
    extractCleanCutout(bannerIndices[0], { textMaxY: 0.24 }),
    extractCleanCutout(bannerIndices[1], { textMaxY: 0.26 }),
    extractCleanCutout(bannerIndices[2], { textMaxY: 0.24 }),
    extractCleanCutout(guideSrc, { textMaxY: 0.30 }),
    extractCleanCutout(thanksSrc, { textMaxY: 0.23 }),
  ]);

  const coverOut = path.join(outputDir, "cover.png");
  const coverFitted = await sharp(coverCut.buffer)
    .resize(224, 224, { fit: "contain", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const coverInfo = await sharp({ create: { width: 240, height: 240, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: coverFitted, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(coverOut);
  console.log(`cover.png: ${coverInfo.width}x${coverInfo.height}, ${(coverInfo.size / 1024).toFixed(1)}KB`);

  const iconOut = path.join(outputDir, "icon.png");
  {
    const { data, info } = await sharp(iconCut.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    const headH = Math.round(h * 0.78);
    const cropBuf = Buffer.alloc(w * headH * 4);
    const cx = w * 0.52;
    for (let y = 0; y < headH; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const o = (y * w + x) * 4;
        cropBuf[o] = data[o]; cropBuf[o + 1] = data[o + 1]; cropBuf[o + 2] = data[o + 2];
        let a = data[o + 3];
        if (y > headH * 0.60 && a > 0) {
          const nx = (x - cx) / (w * 0.44);
          const ny = (y - headH * 0.54) / (headH * 0.44);
          const d = Math.sqrt(nx * nx + ny * ny);
          if (d >= 1.0) a = 0;
          else if (d > 0.80) {
            const t = (d - 0.80) / 0.20;
            a = Math.round(a * (1 - t * t * (3 - 2 * t)));
          }
        }
        cropBuf[o + 3] = a;
      }
    }
    let minX = w, minY = headH, maxX = -1, maxY = -1;
    for (let y = 0; y < headH; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (cropBuf[(y * w + x) * 4 + 3] >= 16) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    const headTrim = await sharp(cropBuf, { raw: { width: w, height: headH, channels: 4 } })
      .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      .png()
      .toBuffer();
    const iconFitted = await sharp(headTrim)
      .resize(48, 48, { fit: "contain", kernel: "lanczos3", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    const iconInfo = await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: iconFitted, gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toFile(iconOut);
    console.log(`icon.png: ${iconInfo.width}x${iconInfo.height}, ${(iconInfo.size / 1024).toFixed(1)}KB`);
  }

  const pal = PALETTES[opts.palette] || PALETTES.sky;
  const bannerBg = Buffer.from(`
    <svg width="750" height="400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${pal.banner[0]}"/>
          <stop offset="52%" stop-color="${pal.banner[1]}"/>
          <stop offset="100%" stop-color="${pal.banner[2]}"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#fff7e2" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="#fff7e2" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="750" height="400" fill="url(#g)"/>
      <rect width="750" height="400" fill="url(#glow)"/>
      <circle cx="88" cy="72" r="46" fill="#ffffff" opacity="0.28"/>
      <circle cx="672" cy="84" r="54" fill="#ffe9a6" opacity="0.38"/>
      <circle cx="235" cy="52" r="24" fill="#ffffff" opacity="0.32"/>
      <circle cx="545" cy="48" r="28" fill="#ffb8c6" opacity="0.30"/>
      <path d="M0,332 Q188,295 375,326 T750,318 L750,400 L0,400 Z" fill="${pal.hill}" opacity="0.55"/>
      <path d="M180,68 L185,54 L190,68 L204,73 L190,78 L185,92 L180,78 L166,73 Z" fill="#ffcf4a"/>
      <path d="M568,78 L572,67 L576,78 L587,82 L576,86 L572,97 L568,86 L557,82 Z" fill="#ff9eb5"/>
      <circle cx="290" cy="42" r="6" fill="#ff9eb5"/>
      <circle cx="468" cy="46" r="7" fill="#ffcf4a"/>
    </svg>
  `);
  const pLeft = await sharp(bLeft.buffer).resize({ width: 240, kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
  const pCenter = await sharp(bCenter.buffer).resize({ height: 340, kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
  const pRight = await sharp(bRight.buffer).resize({ height: 280, kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
  const bannerOut = path.join(outputDir, "banner.jpg");
  const bannerInfo = await sharp(bannerBg)
    .composite([
      { input: pLeft.data, left: 22, top: Math.max(40, 400 - pLeft.info.height - 48) },
      { input: pRight.data, left: Math.max(0, 750 - pRight.info.width - 14), top: Math.max(0, 400 - pRight.info.height) },
      { input: pCenter.data, left: Math.round((750 - pCenter.info.width) / 2), top: Math.max(0, 400 - pCenter.info.height) },
    ])
    .flatten({ background: pal.banner[1] })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(bannerOut);
  console.log(`banner.jpg: ${bannerInfo.width}x${bannerInfo.height}, ${(bannerInfo.size / 1024).toFixed(1)}KB`);

  const guideBg = Buffer.from(`
    <svg width="750" height="560" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffdca8"/>
          <stop offset="55%" stop-color="#ffecc7"/>
          <stop offset="100%" stop-color="#ffcba4"/>
        </linearGradient>
        <radialGradient id="glow2" cx="50%" cy="50%" r="52%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.65"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="750" height="560" fill="url(#g2)"/>
      <rect width="750" height="560" fill="url(#glow2)"/>
      <circle cx="110" cy="110" r="65" fill="#ffffff" opacity="0.28"/>
      <circle cx="645" cy="130" r="78" fill="#ffb899" opacity="0.28"/>
      <rect x="0" y="486" width="750" height="74" fill="#e8b888" opacity="0.58"/>
      <path d="M135,145 L141,127 L147,145 L165,151 L147,157 L141,175 L135,157 L117,151 Z" fill="#ffb703"/>
      <path d="M605,175 L610,161 L615,175 L629,180 L615,185 L610,199 L605,185 L591,180 Z" fill="#ff8fab"/>
      <path d="M595,102 C595,92 610,87 617,96 C624,87 639,92 639,102 C639,115 617,128 617,128 C617,128 595,115 595,102 Z" fill="#ff758f" opacity="0.82"/>
      <path d="M112,238 C112,230 124,226 130,233 C136,226 148,230 148,238 C148,249 130,259 130,259 C130,259 112,249 112,238 Z" fill="#ff8fab" opacity="0.78"/>
    </svg>
  `);
  const pGuide = await sharp(guideCut.buffer).resize({ width: 500, height: 470, fit: "inside", kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
  const guideOut = path.join(outputDir, "appreciation-guide.jpg");
  const guideInfo = await sharp(guideBg)
    .composite([{ input: pGuide.data, left: Math.round((750 - pGuide.info.width) / 2), top: 560 - pGuide.info.height }])
    .flatten({ background: "#ffecc7" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(guideOut);
  console.log(`appreciation-guide.jpg: ${guideInfo.width}x${guideInfo.height}, ${(guideInfo.size / 1024).toFixed(1)}KB`);

  const thanksBg = Buffer.from(`
    <svg width="750" height="750" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffcad4"/>
          <stop offset="50%" stop-color="#ffe5d9"/>
          <stop offset="100%" stop-color="#ffd6a5"/>
        </linearGradient>
        <radialGradient id="glow3" cx="50%" cy="48%" r="52%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.70"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="750" height="750" fill="url(#g3)"/>
      <rect width="750" height="750" fill="url(#glow3)"/>
      <circle cx="115" cy="125" r="72" fill="#ffffff" opacity="0.30"/>
      <circle cx="645" cy="150" r="85" fill="#ff9ebb" opacity="0.25"/>
      <path d="M105,195 C105,178 130,170 142,185 C154,170 179,178 179,195 C179,217 142,238 142,238 C142,238 105,217 105,195 Z" fill="#ff6b8b" opacity="0.85"/>
      <path d="M582,185 C582,172 601,166 610,177 C619,166 638,172 638,185 C638,201 610,217 610,217 C610,217 582,201 582,185 Z" fill="#ff758f" opacity="0.82"/>
      <path d="M168,112 L174,94 L180,112 L198,118 L180,124 L174,142 L168,124 L150,118 Z" fill="#ffbe0b"/>
      <path d="M555,102 L560,87 L565,102 L580,107 L565,112 L560,127 L555,112 L540,107 Z" fill="#ffbe0b"/>
    </svg>
  `);
  const pThanks = await sharp(thanksCut.buffer).resize({ width: 620, height: 610, fit: "inside", kernel: "lanczos3" }).png().toBuffer({ resolveWithObject: true });
  const thanksOut = path.join(outputDir, "appreciation-thanks.jpg");
  const thanksInfo = await sharp(thanksBg)
    .composite([{ input: pThanks.data, left: Math.round((750 - pThanks.info.width) / 2), top: 750 - pThanks.info.height }])
    .flatten({ background: "#ffe5d9" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toFile(thanksOut);
  console.log(`appreciation-thanks.jpg: ${thanksInfo.width}x${thanksInfo.height}, ${(thanksInfo.size / 1024).toFixed(1)}KB`);

  if (opts.qa) {
    await writeQaSheet(coverOut, iconOut, opts.qa);
  }
}

async function fileToDataUrl(filePath) {
  const bytes = await sharp(filePath).resize(768, 768, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

async function generateViaOpenAI({ apiKey, baseUrl, model, prompt, refPaths, size, transparent }) {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", prompt);
  form.append("size", size);
  form.append("output_format", "png");
  if (transparent) form.append("background", "transparent");
  for (let i = 0; i < refPaths.length; i += 1) {
    const pngBuf = await sharp(refPaths[i]).resize(768, 768, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    form.append("image[]", new Blob([pngBuf], { type: "image/png" }), `ref-${i + 1}.png`);
  }
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI image API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const item = json.data?.[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) {
    const imgRes = await fetch(item.url);
    return Buffer.from(await imgRes.arrayBuffer());
  }
  throw new Error("OpenAI image API returned no image data.");
}

async function generateViaOpenRouter({ apiKey, baseUrl, model, prompt, refPaths, aspectRatio }) {
  const refUrls = await Promise.all(refPaths.map(fileToDataUrl));
  const content = [
    { type: "text", text: prompt },
    ...refUrls.map((url) => ({ type: "image_url", image_url: { url } })),
  ];
  const body = {
    model,
    modalities: ["image", "text"],
    messages: [{ role: "user", content }],
    ...(aspectRatio ? { image_config: { aspect_ratio: aspectRatio } } : {}),
  };
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "wx-sticker-skill",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter image API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  const imgUrl = msg?.images?.[0]?.image_url?.url || msg?.images?.[0]?.url;
  if (!imgUrl) throw new Error(`OpenRouter returned no image. Response snippet: ${JSON.stringify(json).slice(0, 300)}`);
  if (imgUrl.startsWith("data:")) {
    const base64 = imgUrl.split(",")[1];
    return Buffer.from(base64, "base64");
  }
  const imgRes = await fetch(imgUrl);
  return Buffer.from(await imgRes.arrayBuffer());
}

/**
 * Generate raw auxiliary images via OpenAI (OPENAI_API_KEY) or OpenRouter (OPENROUTER_API_KEY)
 * and automatically post-process them into WeChat-compliant banner/cover/icon/appreciation files.
 */
async function runGeneratePack(opts) {
  const inputDir = opts.input;
  const outputDir = opts.output || (inputDir ? path.join(inputDir, "pack") : null);
  if (!inputDir || !outputDir) throw new Error("Usage: build-pack.mjs generate --input <dir> --output <dir> [--theme <desc>] [--refs <f1,f2>] [--qa <path>]");

  const openAiKey = process.env.OPENAI_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (!openAiKey && !openRouterKey) {
    throw new Error(
      "Missing API key. Set OPENAI_API_KEY (recommended, supports native transparent PNG) or OPENROUTER_API_KEY, or use your host agent's image tool + `build-pack.mjs chroma`.",
    );
  }
  const provider = opts.provider || (openAiKey ? "openai" : "openrouter");
  const model =
    opts.model ||
    process.env.WX_STICKER_IMAGE_MODEL ||
    (provider === "openai" ? "gpt-image-1" : "google/gemini-2.5-flash-image-preview");
  const baseUrl =
    opts["base-url"] ||
    process.env.WX_STICKER_IMAGE_BASE_URL ||
    (provider === "openai" ? "https://api.openai.com/v1" : "https://openrouter.ai/api/v1");

  const allFiles = listImages(inputDir);
  const refPaths = opts.refs
    ? String(opts.refs).split(",").map((p) => path.resolve(p.trim()))
    : [allFiles[0], allFiles[Math.floor(allFiles.length / 2)], allFiles[allFiles.length - 1]].filter(Boolean);
  const theme = opts.theme || "the exact same adorable main character and visual style from the reference sticker images";

  fs.mkdirSync(outputDir, { recursive: true });
  const rawDir = path.join(outputDir, ".raw");
  fs.mkdirSync(rawDir, { recursive: true });

  await buildStickers(inputDir, path.join(outputDir, "stickers"), "auto");

  const useTransparentApi = provider === "openai";
  const bgInstruction = useTransparentApi
    ? "Completely transparent background with zero background color, zero shadows, and zero white outline around the subject."
    : "Completely flat, uniform, solid pure chroma-key neon green (#00FF00) background with zero gradients, zero shadows, zero white outline, and zero green elements on the subject.";

  const specs = [
    {
      key: "cover",
      rawFile: path.join(rawDir, "cover-raw.png"),
      size: "1024x1024",
      aspectRatio: "1:1",
      transparent: useTransparentApi,
      prompt: `Create a square 1:1 front-facing full sitting body portrait of ${theme}. Keep the ENTIRE subject completely inside the frame with ~12% empty margin on all four sides (never clipped at edges). ${bgInstruction} ZERO text, zero letters, zero watermarks.`,
    },
    {
      key: "icon",
      rawFile: path.join(rawDir, "icon-raw.png"),
      size: "1024x1024",
      aspectRatio: "1:1",
      transparent: useTransparentApi,
      prompt: `Create a square 1:1 front-facing HEAD-ONLY portrait of ${theme}, clean rounded fluffy chin/neck at bottom with NO shoulders, NO body, and NO props so it stays crystal-clear at 50x50 pixels. Centered with ~15% empty margin on all four sides. ${bgInstruction} ZERO text, zero letters, zero watermarks.`,
    },
    {
      key: "banner",
      rawFile: path.join(rawDir, "banner-raw.png"),
      size: "1536x1024",
      aspectRatio: "16:9",
      transparent: false,
      prompt: `Create a lively wide horizontal banner scene featuring ${theme} with fun signature props on a warm, vibrant pastel non-white background with strong contrast (NOT white, NOT transparent). Keep generous safe margin at the top edge. STRICTLY ZERO text, zero Chinese characters, zero English letters, zero logos, zero watermarks.`,
    },
    {
      key: "guide",
      rawFile: path.join(rawDir, "guide-raw.png"),
      size: "1536x1024",
      aspectRatio: "4:3",
      transparent: false,
      prompt: `Create a warm 4:3 cozy scene featuring ${theme} in an endearing polite "please treat me" pose on a vibrant warm pastel non-white background (NOT white, NOT transparent). STRICTLY ZERO text, zero letters, zero logos, zero watermarks.`,
    },
    {
      key: "thanks",
      rawFile: path.join(rawDir, "thanks-raw.png"),
      size: "1024x1024",
      aspectRatio: "1:1",
      transparent: false,
      prompt: `Create a warm square 1:1 joyful thank-you scene featuring ${theme} beaming happily surrounded by cute floating pink hearts and golden sparkles on a vibrant pastel blush-peach non-white background (NOT white, NOT transparent). STRICTLY ZERO text, zero letters, zero logos, zero watermarks.`,
    },
  ];

  console.log(`Generating 5 auxiliary raw images via ${provider} (${model})...`);
  for (const spec of specs) {
    console.log(`- Generating ${spec.key}...`);
    const buf =
      provider === "openai"
        ? await generateViaOpenAI({ apiKey: openAiKey, baseUrl, model, prompt: spec.prompt, refPaths, size: spec.size, transparent: spec.transparent })
        : await generateViaOpenRouter({ apiKey: openRouterKey, baseUrl, model, prompt: spec.prompt, refPaths, aspectRatio: spec.aspectRatio });
    fs.writeFileSync(spec.rawFile, buf);
  }

  await runChromaPack({
    "cover-raw": path.join(rawDir, "cover-raw.png"),
    "icon-raw": path.join(rawDir, "icon-raw.png"),
    "banner-raw": path.join(rawDir, "banner-raw.png"),
    "guide-raw": path.join(rawDir, "guide-raw.png"),
    "thanks-raw": path.join(rawDir, "thanks-raw.png"),
    output: outputDir,
    qa: opts.qa,
  });
}

async function runChromaPack(opts) {
  const outputDir = opts.output;
  if (!outputDir) throw new Error("Missing --output <dir>");
  fs.mkdirSync(outputDir, { recursive: true });

  const coverOut = path.join(outputDir, "cover.png");
  const iconOut = path.join(outputDir, "icon.png");

  if (opts["cover-raw"]) await softChromaKeyPng(opts["cover-raw"], coverOut, 240, 0.04);
  if (opts["icon-raw"]) await softChromaKeyPng(opts["icon-raw"], iconOut, 50, 0.03);

  if (opts["banner-raw"]) {
    const out = path.join(outputDir, "banner.jpg");
    const info = await sharp(opts["banner-raw"])
      .resize(750, 400, { fit: "cover", position: "top", kernel: "lanczos3" })
      .flatten({ background: "#f2a663" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(out);
    console.log(`banner.jpg: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)}KB`);
  }
  if (opts["guide-raw"]) {
    const out = path.join(outputDir, "appreciation-guide.jpg");
    const info = await sharp(opts["guide-raw"])
      .resize(750, 560, { fit: "cover", position: "top", kernel: "lanczos3" })
      .flatten({ background: "#f5b87a" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(out);
    console.log(`appreciation-guide.jpg: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)}KB`);
  }
  if (opts["thanks-raw"]) {
    const out = path.join(outputDir, "appreciation-thanks.jpg");
    const info = await sharp(opts["thanks-raw"])
      .resize(750, 750, { fit: "cover", position: "center", kernel: "lanczos3" })
      .flatten({ background: "#f7a48a" })
      .jpeg({ quality: 90, mozjpeg: true })
      .toFile(out);
    console.log(`appreciation-thanks.jpg: ${info.width}x${info.height}, ${(info.size / 1024).toFixed(1)}KB`);
  }
  if (opts.qa && fs.existsSync(coverOut) && fs.existsSync(iconOut)) {
    await writeQaSheet(coverOut, iconOut, opts.qa);
  }
}

async function transparentRatio(filePath) {
  const { data, info } = await sharp(filePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  const total = info.width * info.height;
  for (let i = 0; i < total; i += 1) {
    if (data[i * 4 + 3] < 16) clear += 1;
  }
  return clear / Math.max(1, total);
}

async function verifyPack(packDir) {
  const errors = [];
  const checkImg = async (relPath, spec) => {
    const full = path.join(packDir, relPath);
    if (!fs.existsSync(full)) {
      if (spec.required) errors.push(`MISSING: ${relPath}`);
      return;
    }
    const stat = fs.statSync(full);
    const meta = await sharp(full).metadata();
    const fmt = meta.format === "jpeg" ? "jpg" : meta.format;
    const okDim = meta.width === spec.w && meta.height === spec.h;
    const okFmt = spec.formats.includes(fmt);
    const okSize = stat.size <= spec.maxBytes;
    let okAlpha = true;
    let alphaNote = "";
    if (spec.requireTransparent) {
      const ratio = meta.hasAlpha ? await transparentRatio(full) : 0;
      okAlpha = meta.hasAlpha && ratio >= 0.08;
      alphaNote = ` transparent=${(ratio * 100).toFixed(0)}%`;
    } else if (spec.requireOpaque) {
      okAlpha = !meta.hasAlpha;
      alphaNote = meta.hasAlpha ? " HAS_ALPHA!" : " opaque";
    }
    const pass = okDim && okFmt && okSize && okAlpha;
    const status = pass ? "PASS" : "FAIL";
    console.log(`[${status}] ${relPath}: ${meta.width}x${meta.height} ${fmt.toUpperCase()} ${(stat.size / 1024).toFixed(1)}KB${alphaNote}`);
    if (!pass) errors.push(`${relPath}: expected ${spec.w}x${spec.h} ${spec.formats.join("/")} <=${spec.maxBytes / 1024}KB`);
  };

  const stickersDir = path.join(packDir, "stickers");
  if (!fs.existsSync(stickersDir)) {
    errors.push("MISSING: stickers/ directory");
  } else {
    const stickers = listImages(stickersDir);
    if (stickers.length < 8 || stickers.length > 24) {
      errors.push(`stickers count=${stickers.length} (must be 8-24)`);
    }
    for (const file of stickers) {
      await checkImg(path.join("stickers", path.basename(file)), {
        w: 240, h: 240, formats: ["png", "jpg", "gif"], maxBytes: 500 * 1024, required: true,
      });
    }
  }

  await checkImg("banner.jpg", { w: 750, h: 400, formats: ["jpg", "png"], maxBytes: 500 * 1024, required: true, requireOpaque: true });
  await checkImg("cover.png", { w: 240, h: 240, formats: ["png"], maxBytes: 500 * 1024, required: true, requireTransparent: true });
  await checkImg("icon.png", { w: 50, h: 50, formats: ["png"], maxBytes: 100 * 1024, required: true, requireTransparent: true });
  await checkImg("appreciation-guide.jpg", { w: 750, h: 560, formats: ["jpg", "png", "gif"], maxBytes: 500 * 1024, required: false, requireOpaque: true });
  await checkImg("appreciation-thanks.jpg", { w: 750, h: 750, formats: ["jpg", "png", "gif"], maxBytes: 500 * 1024, required: false, requireOpaque: true });

  if (errors.length) {
    console.error("\nVerification FAILED:\n- " + errors.join("\n- "));
    process.exit(1);
  }
  console.log("\nAll WeChat Sticker Open Platform asset checks PASSED.");
}

async function main() {
  const { cmd, opts } = parseArgs(process.argv.slice(2));
  if (cmd === "slice") {
    await sliceGrid(opts);
  } else if (cmd === "stickers") {
    if (!opts.input || !opts.output) throw new Error("Usage: build-pack.mjs stickers --input <dir> --output <dir> [--fit auto|contain|cover]");
    await buildStickers(opts.input, opts.output, opts.fit || "auto");
  } else if (cmd === "transparent") {
    await runTransparentPack(opts);
  } else if (cmd === "generate") {
    await runGeneratePack(opts);
  } else if (cmd === "chroma") {
    await runChromaPack(opts);
  } else if (cmd === "verify") {
    if (!opts.pack) throw new Error("Usage: build-pack.mjs verify --pack <dir>");
    await verifyPack(opts.pack);
  } else {
    console.log("Usage: build-pack.mjs <slice|stickers|transparent|generate|chroma|verify> [options]");
    process.exit(cmd ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
