// Pet behaviour. vscode-pets moves every pet a few pixels each 100 ms; here a state
// becomes one leg (where to, how long) that Herdr animates natively, and the engine
// is only asked again when the leg is over. Pure: no Herdr, the clock and the random
// source are arguments.
//
// Coordinates: x is the sprite's left edge, y its bottom edge above the panel's bottom.
// env: { width, height, floor } in the same pixels. A pet carries its drawn size (w, h).
import { PETS } from "./pets.js";

export const TICK = 100; // upstream's frame, ms; hold times below are in ticks
export const SIZES = { nano: 30, small: 40, medium: 55, large: 110 };

// How each upstream state plays. face null: keep the way the pet faces.
// air: off the ground (upstream's isStateAboveGround).
export const STATES = {
  "sit-idle": { sprite: "idle", face: "right", hold: 50 },
  lie: { sprite: "lie", face: "right", hold: 50 },
  "stand-right": { sprite: "stand", face: "right", hold: 60 },
  "stand-left": { sprite: "stand", face: "left", hold: 60 },
  swipe: { sprite: "swipe", face: null, hold: 15 },
  "walk-right": { sprite: "walk", face: "right", move: "right", factor: 1, hold: 60 },
  "walk-left": { sprite: "walk", face: "left", move: "left", factor: 1, hold: 60 },
  "run-right": { sprite: "walk_fast", face: "right", move: "right", factor: 1.6, hold: 130 },
  "run-left": { sprite: "walk_fast", face: "left", move: "left", factor: 1.6, hold: 130 },
  "climb-wall-left": { sprite: "wallclimb", face: "left", move: "up", air: true },
  "wall-hang-left": { sprite: "wallgrab", face: "left", hold: 50, air: true },
  "wall-dig-left": { sprite: "walldig", face: "left", hold: 60, air: true },
  "wall-nap": { sprite: "wallnap", face: "right", hold: 50, air: true },
  "jump-down-left": { sprite: "fall_from_grab", face: "right", move: "down", air: true },
  land: { sprite: "land", face: "left", hold: 10, air: true },
};

const CLIMB_SPEED = 1; // px per tick, unless the pet says otherwise
const FALL_SPEED = 5;
const CLIMB_HEIGHT = 100;

// The sprite files a pet type needs: one per state it can be in, plus the hover reaction.
export function spritesFor(type) {
  const out = new Set(["swipe"]);
  for (const state of Object.keys(PETS[type].sequence)) out.add(STATES[state].sprite);
  return [...out];
}

const rightEdge = (pet, env) => Math.max(0, Math.floor(env.width * 0.95) - pet.w);
const travel = (px, pxPerSec) => Math.max(TICK, Math.round((px / pxPerSec) * 1000));

// How high this pet climbs to, as [lowest, highest], or null when the panel is too short.
function climbRange(def, pet, env) {
  if (def.climbRange) {
    const lo = Math.max(pet.h * 2, env.height * def.climbRange[0]);
    const hi = Math.min(env.height - pet.h, env.height * def.climbRange[1]);
    return hi >= lo ? [lo, hi] : null;
  }
  return env.height >= CLIMB_HEIGHT + pet.h ? [CLIMB_HEIGHT, CLIMB_HEIGHT] : null;
}

// Puts the pet in `state` at `pos` and returns the leg that plays it.
export function enter(pet, state, pos, env, now, rng) {
  const def = PETS[pet.type];
  const s = STATES[state];
  const y = s.air ? pos.y : env.floor;
  const leg = {
    state,
    sprite: s.sprite,
    face: s.face ?? pet.face,
    fromX: pos.x, toX: pos.x,
    fromY: y, toY: y,
    start: now,
    duration: (s.hold ?? 0) * TICK,
    bubble: null,
  };
  const speed = pet.pxPerSec * (s.factor ?? 1);
  if ((s.move === "right" || s.move === "left") && speed > 0) {
    leg.toX = s.move === "right" ? rightEdge(pet, env) : 0;
    leg.duration = travel(Math.abs(leg.toX - leg.fromX), speed);
  } else if (s.move === "up") {
    const [lo, hi] = climbRange(def, pet, env) ?? [y, y];
    leg.toY = Math.round(lo + rng() * (hi - lo));
    leg.duration = travel(Math.abs(leg.toY - y), (def.climbSpeed ?? CLIMB_SPEED) * 10);
  } else if (s.move === "down") {
    leg.toY = env.floor;
    leg.duration = travel(Math.abs(y - env.floor), (def.fallSpeed ?? FALL_SPEED) * 10);
  }
  pet.state = state;
  pet.face = leg.face;
  pet.leg = leg;
  return leg;
}

// A new pet from a saved one ({ id, type, color, name }), somewhere on the ground.
export function spawn(saved, box, env, now, rng) {
  const def = PETS[saved.type];
  const pet = {
    id: saved.id, type: saved.type, color: saved.color, name: saved.name,
    w: box, h: box,
    // Upstream: speed px per tick, 0.7x to 1.3x per pet. Ten ticks a second.
    pxPerSec: def.speed * (def.speedFactor ?? 1) * (0.7 + rng() * 0.6) * 10,
    face: "right",
    state: def.start,
    held: null, // the state a hover interrupted
    leg: null,
  };
  const x = Math.min(Math.floor(rng() * env.width * 0.7), rightEdge(pet, env));
  enter(pet, def.start, { x, y: env.floor }, env, now, rng);
  return pet;
}

// Where the pet is now, part-way through its leg.
export function positionAt(leg, now) {
  const f = leg.duration > 0 ? Math.min(1, Math.max(0, (now - leg.start) / leg.duration)) : 1;
  return { x: leg.fromX + (leg.toX - leg.fromX) * f, y: leg.fromY + (leg.toY - leg.fromY) * f };
}

function nextState(pet, env, rng) {
  const def = PETS[pet.type];
  let options = def.sequence[pet.state] ?? [def.start];
  if (!climbRange(def, pet, env)) options = options.filter((s) => s !== "climb-wall-left");
  if (options.length === 0) return def.start;
  return options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
}

// Call often. True when the leg had ended and the pet started a new one.
export function step(pet, env, now, rng) {
  if (now < pet.leg.start + pet.leg.duration) return false;
  const pos = { x: pet.leg.toX, y: pet.leg.toY };
  const state = pet.held ?? nextState(pet, env, rng);
  pet.held = null;
  enter(pet, state, pos, env, now, rng);
  return true;
}

function bubbleFor(pet, rng) {
  const def = PETS[pet.type];
  if (def.bubbles) return def.bubbles[Math.min(def.bubbles.length - 1, Math.floor(rng() * def.bubbles.length))];
  return def.bubbleByColor?.[pet.color] ?? def.bubble ?? "👋";
}

// The pointer came over the pet: it stops where it is, reacts, then carries on.
// False when it can't (already reacting, or off the ground).
export function swipe(pet, env, now, rng) {
  if (pet.state === "swipe" || STATES[pet.state].air) return false;
  const pos = positionAt(pet.leg, now);
  pet.held = pet.state;
  enter(pet, "swipe", pos, env, now, rng).bubble = bubbleFor(pet, rng);
  return true;
}

// The panel, the sprite size or the theme changed. Replans a leg that no longer fits;
// true when it did.
export function refit(pet, env, now, rng) {
  const air = !!STATES[pet.state].air;
  const edge = rightEdge(pet, env);
  const pos = positionAt(pet.leg, now);
  const fits = pet.leg.toX <= edge && pos.x <= edge && (air || (pet.leg.fromY === env.floor && pet.leg.toY === env.floor));
  if (fits) return false;
  const bubble = pet.leg.bubble;
  enter(pet, pet.state, { x: Math.min(pos.x, edge), y: pos.y }, env, now, rng).bubble = bubble;
  return true;
}
