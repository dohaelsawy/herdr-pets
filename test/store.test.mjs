import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_PETS, load, addPet, removePet, renamePet, removeAll, withSize, withTheme, floorFor, randomName, newId } from "../mods/pets/store.js";
import { PETS } from "../mods/pets/pets.js";

const rex = { id: "a", type: "dog", color: "brown", name: "Rex" };

test("load gives defaults for nothing saved", () => {
  assert.deepEqual(load(undefined), { pets: [], size: "nano", theme: "none" });
  assert.deepEqual(load("garbage"), { pets: [], size: "nano", theme: "none" });
});

test("load keeps good pets and drops broken ones", () => {
  const state = load({
    pets: [rex, null, { id: 5, type: "dog" }, { id: "b", type: "dragon", color: "red", name: "X" }, { id: "a", type: "cat", color: "black", name: "Dup" }],
    size: "huge",
    theme: "forest",
  });
  assert.deepEqual(state, { pets: [rex], size: "nano", theme: "forest" });
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
