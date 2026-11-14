import { test } from "node:test";
import assert from "node:assert/strict";
import { PETS } from "../mods/pets/pets.js";
import { STATES, SIZES, spritesFor, spawn, enter, step, swipe, refit, positionAt } from "../mods/pets/engine.js";
import { seq } from "./helpers.mjs";

const ENV = { width: 400, height: 300, floor: 0 };
const half = () => 0.5; // a pet of exactly its type's speed, and the middle option
const dog = (env = ENV) => spawn({ id: "a", type: "dog", color: "brown", name: "Rex" }, SIZES.nano, env, 0, half);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not ${expected}`);

test("the engine can play every state in every pet's table", () => {
  for (const def of Object.values(PETS)) {
    for (const state of Object.keys(def.sequence)) assert.ok(STATES[state], `${def.label}: unknown state ${state}`);
  }
});

test("spritesFor lists one file label per playable state plus swipe", () => {
  assert.deepEqual(spritesFor("dog").sort(), ["idle", "lie", "swipe", "walk", "walk_fast"]);
  assert.ok(spritesFor("cat").includes("wallclimb"));
});

test("spawn gives upstream's speed in pixels per second and starts in the start state", () => {
  const pet = dog();
  near(pet.pxPerSec, 30); // dog speed 3 px per 100 ms tick
  assert.equal(pet.state, "sit-idle");
  assert.equal(pet.leg.fromX, 140); // floor(0.5 * 400 * 0.7)
  near(spawn({ id: "s", type: "squirrel", color: "gray", name: "S" }, 30, ENV, 0, half).pxPerSec, 57.5); // 5 x 1.15
});

test("spawn spreads speed from 0.7x to 1.3x", () => {
  const make = (r) => spawn({ id: "a", type: "dog", color: "brown", name: "R" }, 30, ENV, 0, () => r).pxPerSec;
  near(make(0), 21);
  near(make(1), 39);
});

test("idle and stand hold for upstream's tick counts", () => {
  const pet = dog();
  assert.equal(pet.leg.duration, 5000);
  assert.equal(pet.leg.toX, pet.leg.fromX);
  assert.equal(enter(pet, "stand-left", { x: 10, y: 0 }, ENV, 0, half).duration, 6000);
  assert.equal(pet.face, "left");
});

test("walk-right glides to 95% of the width less the sprite", () => {
  const pet = dog();
  const leg = enter(pet, "walk-right", { x: 50, y: 0 }, ENV, 1000, half);
  assert.equal(leg.toX, 350); // floor(400 * 0.95) - 30
  assert.equal(leg.duration, 10000); // 300 px at 30 px/s
  assert.equal(leg.sprite, "walk");
  assert.equal(leg.face, "right");
});

test("walk-left glides to the left wall; running is 1.6 times faster", () => {
  const pet = dog();
  assert.equal(enter(pet, "walk-left", { x: 300, y: 0 }, ENV, 0, half).toX, 0);
  const run = enter(pet, "run-left", { x: 300, y: 0 }, ENV, 0, half);
  assert.equal(run.duration, 6250); // 300 px at 48 px/s
  assert.equal(run.sprite, "walk_fast");
});

test("a leg never lasts less than one tick", () => {
  assert.equal(enter(dog(), "walk-left", { x: 0, y: 0 }, ENV, 0, half).duration, 100);
});

test("a pet with speed 0 holds in place for the walk state's hold time", () => {
  const rocky = spawn({ id: "r", type: "rocky", color: "gray", name: "Rocky" }, 30, ENV, 0, half);
  const walk = enter(rocky, "walk-right", { x: 80, y: 0 }, ENV, 0, half);
  assert.deepEqual([walk.toX, walk.duration], [80, 6000]);
  assert.equal(enter(rocky, "run-right", { x: 80, y: 0 }, ENV, 0, half).duration, 13000);
});

test("positionAt interpolates and clamps", () => {
  const leg = enter(dog(), "walk-right", { x: 50, y: 0 }, ENV, 1000, half);
  assert.deepEqual(positionAt(leg, 1000), { x: 50, y: 0 });
  assert.deepEqual(positionAt(leg, 6000), { x: 200, y: 0 });
  assert.deepEqual(positionAt(leg, 99999), { x: 350, y: 0 });
});

test("step waits for the leg, then picks the next state with the random source", () => {
  const pet = dog();
  assert.equal(step(pet, ENV, 4999, half), false);
  // sit-idle -> [walk-right, run-right, lie]
  assert.equal(step(pet, ENV, 5000, seq(0)), true);
  assert.equal(pet.state, "walk-right");
  assert.equal(pet.leg.start, 5000);
  assert.equal(pet.leg.fromX, 140);
  const other = dog();
  step(other, ENV, 5000, seq(0.99));
  assert.equal(other.state, "lie");
});

test("a fixed random source gives a fixed walk", () => {
  const run = () => {
    const pet = dog();
    const seen = [];
    let now = 0;
    const rng = seq(0.1, 0.9, 0.4, 0.7, 0.2);
    for (let i = 0; i < 5; i++) { now = pet.leg.start + pet.leg.duration; step(pet, ENV, now, rng); seen.push(pet.state); }
    return seen;
  };
  assert.deepEqual(run(), run());
});

test("hover stops the pet mid-leg, shows a bubble, then it carries on", () => {
  const pet = dog();
  enter(pet, "walk-right", { x: 50, y: 0 }, ENV, 0, half);
  assert.equal(swipe(pet, ENV, 5000, half), true);
  assert.equal(pet.state, "swipe");
  assert.deepEqual([pet.leg.fromX, pet.leg.toX, pet.leg.duration], [200, 200, 1500]);
  assert.equal(pet.leg.bubble, "👋");
  assert.equal(pet.leg.face, "right"); // keeps facing the way it walked
  assert.equal(swipe(pet, ENV, 5100, half), false); // already reacting
  assert.equal(step(pet, ENV, 6500, half), true);
  assert.equal(pet.state, "walk-right");
  assert.deepEqual([pet.leg.fromX, pet.leg.toX], [200, 350]);
  assert.equal(pet.held, null);
});

test("a pet on the wall ignores the pointer", () => {
  const cat = spawn({ id: "c", type: "cat", color: "brown", name: "Tom" }, 30, ENV, 0, half);
  enter(cat, "climb-wall-left", { x: 0, y: 0 }, ENV, 0, half);
  assert.equal(swipe(cat, ENV, 100, half), false);
  assert.equal(cat.state, "climb-wall-left");
});

test("bubbles follow upstream's per-pet reactions", () => {
  const bubble = (type, color, rng = half) => {
    const pet = spawn({ id: "x", type, color, name: "N" }, 30, ENV, 0, half);
    swipe(pet, ENV, 10, rng);
    return pet.leg.bubble;
  };
  assert.equal(bubble("finley", "blue"), "Hi! 👋");
  assert.equal(bubble("skeleton", "orange"), "🎃");
  assert.equal(bubble("skeleton", "blue"), "☠️");
  assert.equal(bubble("squirrel", "gray", seq(0)), "🌰?");
});

test("climbing goes to 100 px at 10 px/s; jumping down falls at 50 px/s", () => {
  const cat = spawn({ id: "c", type: "cat", color: "brown", name: "Tom" }, 30, ENV, 0, half);
  const up = enter(cat, "climb-wall-left", { x: 0, y: 0 }, ENV, 0, half);
  assert.deepEqual([up.fromY, up.toY, up.duration, up.sprite], [0, 100, 10000, "wallclimb"]);
  const hang = enter(cat, "wall-hang-left", { x: 0, y: 100 }, ENV, 0, half);
  assert.deepEqual([hang.fromY, hang.toY, hang.duration], [100, 100, 5000]);
  const down = enter(cat, "jump-down-left", { x: 0, y: 100 }, ENV, 0, half);
  assert.deepEqual([down.toY, down.duration, down.face], [0, 2000, "right"]);
});

test("a ground state always stands on the theme's floor", () => {
  const env = { ...ENV, floor: 23 };
  const leg = enter(dog(env), "sit-idle", { x: 10, y: 0 }, env, 0, half);
  assert.deepEqual([leg.fromY, leg.toY], [23, 23]);
});

test("the squirrel climbs to a share of the panel height, faster", () => {
  const sq = spawn({ id: "s", type: "squirrel", color: "gray", name: "S" }, 30, ENV, 0, half);
  const up = enter(sq, "climb-wall-left", { x: 0, y: 0 }, ENV, 0, half);
  assert.equal(up.toY, 165); // halfway between 30% and 80% of 300
  assert.equal(up.duration, 3000); // 165 px at 55 px/s
});

test("a panel too short to climb never picks the wall", () => {
  const short = { width: 400, height: 120, floor: 0 };
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const cat = spawn({ id: "c", type: "cat", color: "brown", name: "Tom" }, 30, short, 0, half);
    enter(cat, "walk-left", { x: 0, y: 0 }, short, 0, half);
    step(cat, short, 100, () => r);
    assert.notEqual(cat.state, "climb-wall-left");
  }
  // walk-left -> [sit-idle, climb-wall-left, walk-right, run-right]
  const tall = spawn({ id: "c", type: "cat", color: "brown", name: "Tom" }, 30, ENV, 0, half);
  enter(tall, "walk-left", { x: 0, y: 0 }, ENV, 0, half);
  step(tall, ENV, 100, () => 0.3);
  assert.equal(tall.state, "climb-wall-left");
});

test("refit replans a leg that ends outside a narrower panel", () => {
  const pet = dog();
  enter(pet, "walk-right", { x: 50, y: 0 }, ENV, 0, half);
  assert.equal(refit(pet, ENV, 1000, half), false);
  const narrow = { width: 200, height: 300, floor: 0 };
  assert.equal(refit(pet, narrow, 1000, half), true);
  assert.deepEqual([pet.leg.fromX, pet.leg.toX, pet.leg.start], [80, 160, 1000]);
});

test("refit pulls back a pet standing beyond the new edge and moves it to a new floor", () => {
  const pet = dog();
  enter(pet, "sit-idle", { x: 300, y: 0 }, ENV, 0, half);
  refit(pet, { width: 200, height: 300, floor: 0 }, 10, half);
  assert.equal(pet.leg.fromX, 160);
  assert.equal(refit(pet, { width: 200, height: 300, floor: 45 }, 20, half), true);
  assert.deepEqual([pet.leg.fromY, pet.leg.toY], [45, 45]);
});
