import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PETS, load, addPet, removePet, renamePet, removeAll, withSize, withTheme, floorFor, randomName, newId, applyCommand, boxOf, namedSize } from "../mods/pets/store.js";
import { PETS } from "../mods/pets/pets.js";

const rex = { id: "a", type: "dog", color: "brown", name: "Rex" };

test("load gives defaults for nothing saved", () => {
  assert.deepEqual(load(undefined), { pets: [], size: "medium", theme: "none" });
  assert.deepEqual(load("garbage"), { pets: [], size: "medium", theme: "none" });
});

test("load keeps good pets and drops broken ones", () => {
  const state = load({
    pets: [rex, null, { id: 5, type: "dog" }, { id: "b", type: "dragon", color: "red", name: "X" }, { id: "a", type: "cat", color: "black", name: "Dup" }],
    size: "huge",
    theme: "forest",
  });
  assert.deepEqual(state, { pets: [rex], size: "medium", theme: "forest" }); // "huge" is not a size
});

test("load repairs a colour the pet does not come in and an empty name", () => {
  const [pet] = load({ pets: [{ id: "c", type: "crab", color: "blue", name: "  " }] }).pets;
  assert.equal(pet.color, PETS.crab.colors[0]);
  assert.equal(pet.name, PETS.crab.names[0]);
});

test("load stops at the limit", () => {
  const many = Array.from({ length: MAX_PETS + 5 }, (_, i) => ({ ...rex, id: `p${i}` }));
  assert.equal(load({ pets: many }).pets.length, MAX_PETS);
});

test("addPet appends, and does nothing at the limit", () => {
  let state = load(undefined);
  state = addPet(state, rex);
  assert.deepEqual(state.pets, [rex]);
  for (let i = 0; i < MAX_PETS + 3; i++) state = addPet(state, { ...rex, id: `p${i}` });
  assert.equal(state.pets.length, MAX_PETS);
});

test("removePet, renamePet and removeAll leave the original value alone", () => {
  const state = load({ pets: [rex, { ...rex, id: "b", name: "Max" }] });
  assert.deepEqual(removePet(state, "a").pets.map((p) => p.id), ["b"]);
  assert.equal(renamePet(state, "b", "  Bo ").pets[1].name, "Bo");
  assert.equal(renamePet(state, "b", "   "), state); // an empty name changes nothing
  assert.deepEqual(removeAll(state).pets, []);
  assert.equal(state.pets.length, 2);
});

test("withSize and withTheme ignore values that do not exist", () => {
  const state = load(undefined);
  assert.equal(withSize(state, "large").size, "large");
  assert.equal(withSize(state, "giant"), state);
  assert.equal(withTheme(state, "castle").theme, "castle");
  assert.equal(withTheme(state, "space"), state);
});

test("floorFor gives upstream's ground heights", () => {
  assert.equal(floorFor("none", "large"), 0);
  assert.equal(floorFor("forest", "nano"), 23);
  assert.equal(floorFor("castle", "large"), 120);
  assert.equal(floorFor("library", "medium"), 32);
});

test("randomName picks from the pet's own names", () => {
  assert.equal(randomName("dog", () => 0), PETS.dog.names[0]);
  assert.equal(randomName("dog", () => 0.999999), PETS.dog.names.at(-1));
  assert.equal(randomName("finley", () => 0.5), "Finley");
});

test("newId is built from the clock and the random source", () => {
  assert.equal(newId(1000, () => 0.5), "rs-89oqgw");
  assert.notEqual(newId(1000, () => 0.1), newId(1000, () => 0.2));
});

test("load drops a type that is only a built-in object member", () => {
  for (const type of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    assert.deepEqual(load({ pets: [{ id: "x", type, color: "red", name: "X" }, rex] }).pets, [rex], type);
  }
});

test("addPet ignores a pet whose id is already there", () => {
  const state = addPet(load({ pets: [rex] }), { ...rex, name: "Twin" });
  assert.deepEqual(state.pets, [rex]);
});

test("load drops a pet whose type is not a string", () => {
  for (const type of [{ toString: 1 }, ["dog"], 7, null, undefined]) {
    assert.deepEqual(load({ pets: [{ id: "x", type, color: "brown", name: "X" }, rex] }).pets, [rex], JSON.stringify(type));
  }
});

test("applyCommand changes size, theme and the list from a command's name", () => {
  const state = load({ pets: [rex], size: "nano", theme: "none" });
  assert.equal(applyCommand(state, "size-large").size, "large");
  assert.equal(applyCommand(state, "theme-forest").theme, "forest");
  assert.deepEqual(applyCommand(state, "remove-all").pets, []);
  assert.deepEqual(applyCommand(state, "size-large").pets, [rex]); // the rest is kept
});

test("applyCommand gives null for a command that does not change the saved state", () => {
  const state = load(undefined);
  for (const command of ["spawn", "size-huge", "theme-space", "size-", "nonsense", "", undefined]) {
    assert.equal(applyCommand(state, command), null, String(command));
  }
});

test("a size can be a number of pixels as well as one of the four names", () => {
  const state = load(undefined);
  assert.equal(withSize(state, 45).size, 45);
  assert.equal(withSize(state, "45").size, 45); // as a command spells it
  assert.equal(load({ size: 45 }).size, 45);
  assert.equal(applyCommand(state, "size-45").size, 45);
  assert.equal(applyCommand(state, "size-small").size, "small");
});

test("a pixel size outside 20 to 160, or not a whole number, is refused", () => {
  const state = load(undefined);
  for (const bad of [19, 161, 0, -45, 45.5, "45px", "", NaN, null]) assert.equal(withSize(state, bad), state, String(bad));
  assert.equal(load({ size: 500 }).size, "medium");
  assert.equal(applyCommand(state, "size-500"), null);
});

test("boxOf gives the pixel box for a name or a number", () => {
  assert.deepEqual(["nano", "small", "medium", "large", 45].map(boxOf), [30, 40, 55, 110, 45]);
});

test("namedSize picks the nearest of the four sizes, for a theme's pictures and floor", () => {
  assert.equal(namedSize("large"), "large");
  assert.deepEqual([20, 34, 36, 45, 48, 80, 83, 160].map(namedSize), ["nano", "nano", "small", "small", "medium", "medium", "large", "large"]);
  assert.equal(floorFor("forest", 45), 30); // the small picture's ground
  assert.equal(floorFor("none", 45), 0);
});
