import { test } from "node:test";
import assert from "node:assert/strict";
import { PETS, TYPES, UPSTREAM_TAG } from "../mods/pets/pets.js";

test("there is a table for each of upstream's 27 pets", () => {
  assert.equal(TYPES.length, 27);
  assert.equal(UPSTREAM_TAG, "1.37.0");
  for (const type of ["dog", "cat", "crab", "rubber-duck", "raccoon", "zappy"]) assert.ok(PETS[type], type);
});

test("every pet has an emoji, a speed, colours and names", () => {
  for (const def of Object.values(PETS)) {
    assert.ok(def.emoji, `${def.label}: emoji`);
    assert.ok(Number.isInteger(def.speed) && def.speed >= 0 && def.speed <= 5, `${def.label}: speed`);
    assert.ok(def.colors.length > 0, `${def.label}: colours`);
    assert.ok(def.names.length > 0, `${def.label}: names`);
  }
  assert.deepEqual(PETS.dog.colors, ["black", "brown", "white", "red", "akita"]);
  assert.equal(PETS.dog.speed, 3);
  assert.equal(PETS.rocky.speed, 0);
});

test("every table is closed: each next state has its own row", () => {
  for (const def of Object.values(PETS)) {
    assert.ok(def.sequence[def.start], `${def.label}: start state has no row`);
    for (const [state, next] of Object.entries(def.sequence)) {
      assert.ok(next.length > 0, `${def.label}: ${state} leads nowhere`);
      for (const n of next) assert.ok(def.sequence[n], `${def.label}: ${state} -> ${n} has no row`);
    }
  }
});

test("the ball and friend states are gone from every table", () => {
  const all = JSON.stringify(PETS);
  for (const dropped of ["chase", "idle-with-ball", "chase-friend"]) assert.ok(!all.includes(`"${dropped}"`), dropped);
});

test("a repeated next state is kept, because upstream uses repeats as weights", () => {
  const next = PETS.bunny.sequence["stand-left"];
  assert.ok(next.length > new Set(next).size);
});

test("what upstream does in code is carried as data", () => {
  assert.equal(PETS.finley.bubble, "Hi! 👋");
  assert.equal(PETS.skeleton.bubbleByColor.orange, "🎃");
  assert.deepEqual(PETS.squirrel.climbRange, [0.3, 0.8]);
  assert.equal(PETS.squirrel.speedFactor, 1.15);
});

test("names are clean text, even where upstream has an apostrophe in a comment", () => {
  for (const def of Object.values(PETS)) {
    for (const name of def.names) {
      const shown = `${def.label}: ${JSON.stringify(name)}`;
      assert.equal(name, name.trim(), shown);
      assert.ok(name.length > 0 && !name.includes("\n") && !name.includes("//") && !name.startsWith(","), shown);
    }
  }
  assert.deepEqual(PETS.squirrel.names.slice(7, 10), ["Conker", "Bucky", "Guinevere"]);
});
