import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceSize, reconcile, hover, drawing } from "../mods/pets/roster.js";
import { enter } from "../mods/pets/engine.js";

const ENV = { width: 400, height: 300, floor: 0 };
const half = () => 0.5;
const rex = { id: "a", type: "dog", color: "brown", name: "Rex" };
const tom = { id: "b", type: "cat", color: "black", name: "Tom" };
// Sprites as art.js gives them; the dog's idle is 115 x 90 and its lie 140 x 75.
const sprite = (label, width, height) => ({ right: `data/pets/dog/brown_${label}_8fps.gif`, left: `data/pets/dog/brown_${label}_8fps.left.gif`, width, height });
const DOG = { idle: sprite("idle", 115, 90), lie: sprite("lie", 140, 75), walk: sprite("walk", 120, 85), walk_fast: sprite("walk_fast", 120, 85), swipe: sprite("swipe", 115, 90) };
const loaded = () => DOG;
const none = () => null;

test("referenceSize is the idle sprite in the box, or the box without sprites", () => {
  assert.deepEqual(referenceSize(DOG, 30), { w: 30, h: 23 });
  assert.deepEqual(referenceSize(null, 30), { w: 30, h: 30 });
  assert.deepEqual(referenceSize({ walk: sprite("walk", 120, 85) }, 30), { w: 30, h: 21 });
});

test("reconcile spawns a saved pet and reports a change", () => {
  const live = {};
  assert.equal(reconcile(live, [rex], loaded, 30, ENV, 0, half), true);
  assert.equal(live.a.state, "sit-idle");
  assert.deepEqual([live.a.w, live.a.h], [30, 23]);
  assert.equal(reconcile(live, [rex], loaded, 30, ENV, 100, half), false); // nothing new
});

test("reconcile drops a pet that is no longer saved and follows a rename", () => {
  const live = {};
  reconcile(live, [rex, tom], loaded, 30, ENV, 0, half);
  assert.equal(reconcile(live, [{ ...rex, name: "Max" }], loaded, 30, ENV, 10, half), true);
  assert.deepEqual(Object.keys(live), ["a"]);
  assert.equal(live.a.name, "Max");
});

test("a pet without sprites waits where it is", () => {
  const live = {};
  reconcile(live, [rex], none, 30, ENV, 0, half);
  assert.equal(reconcile(live, [rex], none, 30, ENV, 60000, half), false); // long past its 5 s hold
  assert.equal(live.a.state, "sit-idle");
  assert.equal(reconcile(live, [rex], loaded, 30, ENV, 60000, half), true); // sprites arrived
  assert.notEqual(live.a.state, "sit-idle");
});

test("reconcile steps a pet whose leg is over", () => {
  const live = {};
  reconcile(live, [rex], loaded, 30, ENV, 0, half);
  assert.equal(reconcile(live, [rex], loaded, 30, ENV, 4999, half), false);
  assert.equal(reconcile(live, [rex], loaded, 30, ENV, 5000, () => 0), true);
  assert.equal(live.a.state, "walk-right");
});

test("reconcile refits pets when the panel narrows or the floor moves", () => {
  const live = {};
  reconcile(live, [rex], loaded, 30, ENV, 0, half);
  enter(live.a, "sit-idle", { x: 300, y: 0 }, ENV, 0, half);
  assert.equal(reconcile(live, [rex], loaded, 30, { width: 200, height: 300, floor: 23 }, 10, half), true);
  assert.deepEqual([live.a.leg.fromX, live.a.leg.fromY], [160, 23]);
});

test("hover makes a pet with sprites react, and leaves one without alone", () => {
  const live = {};
  reconcile(live, [rex], loaded, 30, ENV, 0, half);
  assert.equal(hover(live.a, null, ENV, 100, half), false);
  assert.equal(live.a.leg.bubble, null);
  assert.equal(hover(live.a, DOG, ENV, 100, half), true);
  assert.equal(live.a.leg.bubble, "👋");
});

test("drawing gives the leg's end, the time left on the axis that moves, and the sprite", () => {
  const live = {};
  reconcile(live, [rex], loaded, 30, ENV, 0, half);
  enter(live.a, "walk-right", { x: 50, y: 0 }, ENV, 1000, half);
  const d = drawing(live.a, DOG, 30, 4000);
  assert.deepEqual([d.x, d.y], [350, 0]);
  assert.equal(d.moveX, 7000); // a 10 s walk, 3 s in
  assert.equal(d.moveY, 0); // feet stay on the ground: no glide on this axis
  assert.deepEqual(d.sprite, { path: "data/pets/dog/brown_walk_8fps.gif", w: 30, h: 21 });
  assert.equal(d.bubble, null);
});

test("drawing of a pet standing still glides on neither axis", () => {
  const live = {};
  reconcile(live, [rex], loaded, 30, ENV, 0, half);
  const d = drawing(live.a, DOG, 30, 100);
  assert.deepEqual([d.moveX, d.moveY], [0, 0]);
});

test("drawing uses the mirrored file when the pet faces left", () => {
  const live = {};
  reconcile(live, [rex], loaded, 30, ENV, 0, half);
  enter(live.a, "walk-left", { x: 300, y: 0 }, ENV, 0, half);
  assert.equal(drawing(live.a, DOG, 30, 0).sprite.path, "data/pets/dog/brown_walk_8fps.left.gif");
});

test("drawing falls back to idle for an animation the pet lacks, and to the emoji without sprites", () => {
  const live = {};
  reconcile(live, [rex], loaded, 30, ENV, 0, half);
  enter(live.a, "lie", { x: 10, y: 0 }, ENV, 0, half);
  const { lie, ...withoutLie } = DOG;
  assert.equal(drawing(live.a, withoutLie, 30, 0).sprite.path, "data/pets/dog/brown_idle_8fps.gif");
  const d = drawing(live.a, null, 30, 0);
  assert.equal(d.sprite, null);
  assert.deepEqual([d.w, d.h], [30, 23]);
});

test("drawing of a climb glides only upward", () => {
  const live = {};
  reconcile(live, [tom], () => ({ idle: sprite("idle", 135, 95), wallclimb: sprite("wallclimb", 65, 115) }), 30, ENV, 0, half);
  enter(live.b, "climb-wall-left", { x: 0, y: 0 }, ENV, 0, half);
  const d = drawing(live.b, { idle: sprite("idle", 135, 95), wallclimb: sprite("wallclimb", 65, 115) }, 30, 2000);
  assert.deepEqual([d.x, d.y, d.moveX, d.moveY], [0, 100, 0, 8000]);
  assert.deepEqual([d.sprite.w, d.sprite.h], [17, 30]);
});
