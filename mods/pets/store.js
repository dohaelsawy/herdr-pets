// What is saved: the pets, the size and the theme. Pure helpers over that one value;
// main.js reads it with shared(KEY) and writes it with setShared(KEY, value).
import { PETS } from "./pets.js";

export const KEY = "pets";
export const MAX_PETS = 20;
export const SIZE_NAMES = ["nano", "small", "medium", "large"];
export const THEMES = ["none", "forest", "castle", "beach", "winter", "autumn", "library"];

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

export const floorFor = (theme, size) => FLOORS[theme]?.[size] ?? 0;

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
    size: SIZE_NAMES.includes(saved.size) ? saved.size : "nano",
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
export const withSize = (state, size) => (SIZE_NAMES.includes(size) ? { ...state, size } : state);
export const withTheme = (state, theme) => (THEMES.includes(theme) ? { ...state, theme } : state);
