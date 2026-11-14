// What is saved: the pets, the size and the theme. Pure helpers over that one value;
// main.js reads it with shared(KEY) and writes it with setShared(KEY, value).
import { PETS } from "./pets.js";
import { SIZES } from "./engine.js";

export const KEY = "pets";
export const MAX_PETS = 20;
export const SIZE_NAMES = ["nano", "small", "medium", "large"];
export const THEMES = ["none", "forest", "castle", "beach", "winter", "autumn", "library"];
// Upstream starts at nano (30 px), sized for a wide editor panel. In a Herdr sidebar
// that is too small to see, so this starts one step below upstream's largest.
export const DEFAULT_SIZE = "medium";

// A size is one of upstream's four names, or a whole number of pixels for the pet's
// box, for when none of the four suits a panel ("pets.size-45").
export const MIN_BOX = 20;
export const MAX_BOX = 160;
const validSize = (size) => SIZE_NAMES.includes(size) || (Number.isInteger(size) && size >= MIN_BOX && size <= MAX_BOX);

// The pet's box in pixels.
export const boxOf = (size) => (typeof size === "number" ? size : SIZES[size]);

// The nearest of the four names: a theme's pictures and ground exist only for those.
export function namedSize(size) {
  if (typeof size !== "number") return size;
  return SIZE_NAMES.reduce((best, name) => (Math.abs(SIZES[name] - size) < Math.abs(SIZES[best] - size) ? name : best));
}

// Where the ground is in each theme's picture, px above the bottom (upstream themes.ts).
const FLOORS = {
  none: { nano: 0, small: 0, medium: 0, large: 0 },
  forest: { nano: 23, small: 30, medium: 40, large: 65 },
  castle: { nano: 45, small: 60, medium: 80, large: 120 },
  beach: { nano: 45, small: 60, medium: 80, large: 120 },
  winter: { nano: 18, small: 20, medium: 30, large: 45 },
  autumn: { nano: 7, small: 9, medium: 15, large: 20 },
  library: { nano: 16, small: 22, medium: 32, large: 44 },
};

export const floorFor = (theme, size) => FLOORS[theme]?.[namedSize(size)] ?? 0;

const pick = (list, rng) => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];

export const randomName = (type, rng) => pick(PETS[type].names, rng);

export const newId = (now, rng) => `${now.toString(36)}-${Math.floor(rng() * 1e9).toString(36)}`;

// Whatever was saved, as a value the rest of the mod can trust.
export function load(raw) {
  const saved = raw && typeof raw === "object" ? raw : {};
  const pets = [];
  const ids = new Set();
  for (const p of Array.isArray(saved.pets) ? saved.pets : []) {
    if (pets.length >= MAX_PETS) break;
    if (!p || typeof p !== "object" || typeof p.id !== "string" || ids.has(p.id)) continue;
    // A type must be a string naming one of PETS' own entries: not an array that
    // reads as "dog", and not "constructor", which every object has.
    const def = typeof p.type === "string" && Object.hasOwn(PETS, p.type) ? PETS[p.type] : null;
    if (!def) continue; // a pet type this version no longer has
    ids.add(p.id);
    pets.push({
      id: p.id,
      type: p.type,
      color: def.colors.includes(p.color) ? p.color : def.colors[0],
      name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : def.names[0],
    });
  }
  return {
    pets,
    size: validSize(saved.size) ? saved.size : DEFAULT_SIZE,
    theme: THEMES.includes(saved.theme) ? saved.theme : "none",
  };
}

// Each returns a new saved value; the one passed in is left alone.
export function addPet(state, pet) {
  if (state.pets.length >= MAX_PETS) return state;
  return load({ ...state, pets: [...state.pets, pet] });
}

export const removePet = (state, id) => ({ ...state, pets: state.pets.filter((p) => p.id !== id) });

export function renamePet(state, id, name) {
  const clean = String(name ?? "").trim();
  if (!clean) return state;
  return { ...state, pets: state.pets.map((p) => (p.id === id ? { ...p, name: clean } : p)) };
}

export const removeAll = (state) => ({ ...state, pets: [] });
export function withSize(state, size) {
  // A command spells a pixel size as text: "45".
  const value = typeof size === "string" && /^\d+$/.test(size) ? Number(size) : size;
  return validSize(value) ? { ...state, size: value } : state;
}
export const withTheme = (state, theme) => (THEMES.includes(theme) ? { ...state, theme } : state);

// What a key command does to the saved value: "size-<name>", "theme-<name>" or
// "remove-all" ("pets.size-large" in keys.json). Null for any other command.
export function applyCommand(state, command) {
  const c = String(command ?? "");
  if (c === "remove-all") return removeAll(state);
  for (const [prefix, change] of [["size-", withSize], ["theme-", withTheme]]) {
    if (!c.startsWith(prefix)) continue;
    const next = change(state, c.slice(prefix.length));
    return next === state ? null : next;
  }
  return null;
}
