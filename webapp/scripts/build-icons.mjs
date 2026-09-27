// Draws every app icon (web, installed web app, Android) from one mark: a
// white tick on a near-black tile, the same as public/icon.svg.
// Run with `node scripts/build-icons.mjs` after changing the mark.
import sharp from "sharp";

const INK = "#1d1d20";
const tick = (s) => `<path d="M20 33.5l8 8 16-18" fill="none" stroke="#fff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(32 32) scale(${s}) translate(-32 -32)"/>`;
// A rounded tile, for places that show the image as it is.
const tile = (s = 1) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="15" fill="${INK}"/>${tick(s)}</svg>`;
// Edge to edge, for places that cut their own shape (iOS, maskable, Android round).
const square = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${INK}"/>${tick(s)}</svg>`;
const circle = (s) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="${INK}"/>${tick(s)}</svg>`;
// Android adaptive foreground: the tick alone, inside the 66/108 safe zone.
const fore = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${tick(0.72)}</svg>`;

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 72 * (size / 64) * 2 }).resize(size, size).png().toFile(file);
const res = "android/app/src/main/res";

await Promise.all([
  png(tile(), 192, "public/icons/Todo-192.png"),
  png(tile(), 512, "public/icons/Todo-512.png"),
  png(square(0.8), 192, "public/icons/Todo-maskable-192.png"),
  png(square(0.8), 512, "public/icons/Todo-maskable-512.png"),
  png(square(0.95), 180, "public/icons/apple-touch-icon.png"),
  png(tile(), 288, `${res}/drawable-nodpi/splash_icon.png`),
  ...Object.entries({ mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }).flatMap(([d, k]) => [
    png(tile(), 48 * k, `${res}/mipmap-${d}/ic_launcher.png`),
    png(circle(0.9), 48 * k, `${res}/mipmap-${d}/ic_launcher_round.png`),
    png(fore, 108 * k, `${res}/mipmap-${d}/ic_launcher_foreground.png`),
  ]),
]);
console.log("icons written");
