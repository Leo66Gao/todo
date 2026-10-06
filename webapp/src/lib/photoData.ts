// A photo made ready to send to the AI: scaled down (a phone photo is far
// bigger than reading it needs) and re-encoded as JPEG, so it uploads fast
// and costs fewer tokens.

const MAX_SIDE = 2048;

/** The photo as a JPEG data URL, at most 2048 px on its longer side. */
export async function photoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error("That photo couldn’t be opened. Try a JPEG or PNG.");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("That photo couldn’t be opened.");
  // White behind transparent PNGs, so the text stays readable as JPEG.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}
