// Where sprite files are and what they are called. Pure: names and numbers only.

// Editors' extension folders, under the home directory.
export const EDITOR_DIRS = [".vscode/extensions", ".vscode-insiders/extensions", ".cursor/extensions", ".vscode-oss/extensions"];

const PREFIX = "tonybaloney.vscode-pets-";

// Pets whose art is not in the upstream GitHub repo: they need the installed extension.
export const EXTENSION_ONLY = ["cat", "frog", "bunny", "squirrel"];

// Of a folder's entries, the newest vscode-pets one ("tonybaloney.vscode-pets-1.37.0"), or null.
export function newestExtension(names) {
  const version = (n) => n.slice(PREFIX.length).split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const found = names.filter((n) => n.startsWith(PREFIX));
  found.sort((a, b) => {
    const [x, y] = [version(a), version(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    }
    return 0;
  });
  return found.at(-1) ?? null;
}

// Upstream's file name for one animation. Colours with a space use an underscore on disk.
export const spriteName = (color, label) => `${color.replaceAll(" ", "_")}_${label}_8fps.gif`;

// The mirrored copy this mod writes next to it.
export const leftName = (name) => name.replace(/\.gif$/, ".left.gif");

export const rawUrl = (tag, rel) => `https://raw.githubusercontent.com/tonybaloney/vscode-pets/${tag}/media/${rel.split("/").map(encodeURIComponent).join("/")}`;

// A theme's two pictures for this size and appearance, relative to media/.
export function themeFiles(theme, dark, size) {
  const kind = dark ? "dark" : "light";
  return {
    background: `backgrounds/${theme}/background-${kind}-${size}.png`,
    foreground: `backgrounds/${theme}/foreground-${kind}-${size}.png`,
  };
}

// The size a sprite is drawn at: inside a box, never enlarged (upstream's max-width/max-height),
// and never thinner than a pixel.
export function fit(width, height, box) {
  const k = Math.min(1, box / width, box / height);
  return { w: Math.max(1, Math.round(width * k)), h: Math.max(1, Math.round(height * k)) };
}

export function pngSize(bytes) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || sig.some((v, i) => bytes[i] !== v)) throw new Error("not a PNG");
  const be32 = (p) => ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
  const size = { width: be32(16), height: be32(20) };
  // A picture is tiled across the panel by its width, so a size of 0 must never get out.
  if (size.width === 0 || size.height === 0) throw new Error("not a PNG");
  return size;
}
