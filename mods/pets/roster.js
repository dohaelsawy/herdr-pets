// Keeps the pets on screen in step with the saved list, and says what to draw for
// each. Pure: main.js calls this from its timer and its render.
import { spawn, step, swipe, refit } from "./engine.js";
import { fit } from "./sources.js";

// The size the engine reckons with for a pet: its idle sprite's, drawn in the box.
// Without sprites it is the box itself.
export function referenceSize(sprites, box) {
  const ref = sprites && (sprites.idle ?? sprites.walk ?? Object.values(sprites)[0]);
  return ref ? fit(ref.width, ref.height, box) : { w: box, h: box };
}

// Brings `live` (pet id -> the engine's pet, changed in place) up to date.
//   saved:     [{ id, type, color, name }], from the store
//   spritesOf: (saved pet) -> its loaded sprites, or null while there are none
// True when something changed that needs a redraw.
export function reconcile(live, saved, spritesOf, box, env, now, rng) {
  let changed = false;
  const ids = new Set();
  for (const p of saved) {
    ids.add(p.id);
    let pet = live[p.id];
    if (!pet) {
      pet = live[p.id] = spawn(p, box, env, now, rng);
      changed = true;
    }
    pet.name = p.name;
    const sprites = spritesOf(p);
    const size = referenceSize(sprites, box);
    pet.w = size.w;
    pet.h = size.h;
    if (refit(pet, env, now, rng)) changed = true;
    // No sprites yet, or none to be had: it waits where it is, as its emoji.
    if (sprites && step(pet, env, now, rng)) changed = true;
  }
  for (const id of Object.keys(live)) {
    if (!ids.has(id)) {
      delete live[id];
      changed = true;
    }
  }
  return changed;
}

// The pointer came over a pet. Only a pet that has sprites reacts; true when it did.
export function hover(pet, sprites, env, now, rng) {
  return !!sprites && swipe(pet, env, now, rng);
}

// What to draw for a pet now.
//   x, y:      where its box ends up: left edge, and bottom edge above the panel's bottom
//   moveX/Y:   ms left of the glide on that axis, or 0 when it does not move on it
//   sprite:    { path, w, h }, to stand on the bottom of the box; null: draw the emoji
//   w, h:      the size to give the element when there is no sprite
//   bubble:    text to show above it, or null
// A sprite's animations differ in height, so the caller must keep the box a fixed
// height and stand the picture on its bottom: then `y` never depends on the sprite.
export function drawing(pet, sprites, box, now) {
  const leg = pet.leg;
  const left = Math.max(1, Math.round(leg.start + leg.duration - now));
  const s = sprites && (sprites[leg.sprite] ?? sprites.idle ?? sprites.walk ?? Object.values(sprites)[0]);
  return {
    x: leg.toX,
    y: leg.toY,
    moveX: leg.toX !== leg.fromX ? left : 0,
    moveY: leg.toY !== leg.fromY ? left : 0,
    sprite: s ? { path: leg.face === "left" ? s.left : s.right, ...fit(s.width, s.height, box) } : null,
    w: pet.w,
    h: pet.h,
    bubble: leg.bubble,
  };
}
