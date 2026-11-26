import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// Adapted from soda's foreground-density boundary search. Keep generation private.
function findCuts(values, length) {
  const cuts = [0];
  const boundaries = [];
  const radius = Math.max(1, Math.round(length / 3 * 0.24));
  for (let index = 1; index < 3; index += 1) {
    const ideal = length * index / 3;
    let chosen = Math.round(ideal);
    let bestScore = Infinity;
    let density = 1;
    for (let pos = Math.max(1, Math.round(ideal) - radius); pos <= Math.min(length - 2, Math.round(ideal) + radius); pos += 1) {
      const value = (values[pos - 1] + values[pos] + values[pos + 1]) / 3;
      const score = value + 0.012 * Math.abs(pos - ideal) / radius;
      if (score < bestScore) {
        bestScore = score;
        chosen = pos;
        density = value;
      }
    }
    // Busy bands offer no reliable signal: retain the equal split for visual review.
    cuts.push(density > 0.15 ? Math.round(ideal) : chosen);
    boundaries.push({ ideal: Math.round(ideal), chosen: cuts.at(-1), density, uncertain: density > 0.15 });
  }
  cuts.push(length);
  return { cuts, boundaries };
}

export async function sliceGrid(opts) {
  if (typeof opts.input !== "string" || typeof opts.output !== "string") {
    throw new Error("Usage: build-pack.mjs slice --input <grid-image> --output <new-directory> [--mode auto|equal]");
  }
  const mode = opts.mode || "auto";
  if (!["auto", "equal"].includes(mode)) throw new Error("--mode must be auto or equal.");
  const image = await sharp(opts.input).rotate().ensureAlpha().png().toBuffer();
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (width < 30 || height < 30) throw new Error("Grid image must be at least 30×30 pixels.");
  const columns = new Float64Array(width);
  const rows = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset], g = data[offset + 1], b = data[offset + 2], a = data[offset + 3];
      const white = Math.min(r, g, b) >= 238 && Math.max(r, g, b) - Math.min(r, g, b) <= 10;
      if (a >= 24 && !white) {
        columns[x] += 1 / height;
        rows[y] += 1 / width;
      }
    }
  }
  const x = findCuts(columns, width);
  const y = findCuts(rows, height);
  if (mode === "equal") {
    x.cuts = [0, Math.round(width / 3), Math.round(width * 2 / 3), width];
    y.cuts = [0, Math.round(height / 3), Math.round(height * 2 / 3), height];
  }
  // Refuse existing output directories so stale images cannot enter a later pack.
  const output = path.resolve(opts.output);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output);
  const files = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const name = `${String(row * 3 + col + 1).padStart(2, "0")}.png`;
      const box = { left: x.cuts[col], top: y.cuts[row], width: x.cuts[col + 1] - x.cuts[col], height: y.cuts[row + 1] - y.cuts[row] };
      await sharp(image).extract(box).png().toFile(path.join(output, name));
      files.push({ name, ...box });
    }
  }
  const warnings = [];
  if (width !== height) warnings.push("Non-square canvas: confirm the source really contains 3 columns × 3 rows.");
  if ([...x.boundaries, ...y.boundaries].some((item) => item.uncertain)) warnings.push("Busy separator bands: equal cuts used there. Inspect for clipped subjects/text; retry --mode equal if needed.");
  const report = { source: path.resolve(opts.input), width, height, mode, cuts: { x: x.cuts, y: y.cuts }, boundaries: { x: x.boundaries, y: y.boundaries }, warnings, files };
  await fs.writeFile(path.join(output, "slice-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Saved 9 PNGs (left to right, top to bottom) to ${output}`);
  for (const warning of warnings) console.warn(`WARNING: ${warning}`);
  console.log("Inspect all 9 images before building a submission pack. Background and alpha are preserved; slicing does not remove backgrounds.");
  return report;
}
