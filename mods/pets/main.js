// Pets: the vscode-pets animals living in a Herdr panel. They are decoration: you add,
// name and remove them. Click + to add one; right-click a pet or the ground for more.
// Opened with props { role } this same mod is one of its dialogs (see dialogs.js).
import { View, div, image } from "gpui-kit";
import { shared, setShared, theme, settings, props, notify, nextCommand } from "herdr";
import { PETS } from "./pets.js";
import { SIZES, spawn, step, swipe, refit } from "./engine.js";
import { KEY, load, floorFor, removeAll } from "./store.js";
import { fit } from "./sources.js";
import { loadPet, loadTheme } from "./art.js";
import { DIALOGS, openPicker, openMenu } from "./dialogs.js";

// How often legs are checked. This does arithmetic only; the panel is redrawn only
// when a pet starts a new leg. Motion itself is Herdr's native transition.
const CHECK_MS = 200;
const RETRY_MS = 60000; // a failed download is tried again after this long
const zoom = () => (Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1);
const artKey = (pet) => `${pet.type}/${pet.color}`;

export default class Pets extends View {
  init(_p, cx) {
    this.dialog = DIALOGS[props()?.role] ?? null;
    if (this.dialog) return this.dialog.init(this, cx);
    this.width = 220;
    this.height = 300;
    this.env = { width: this.width, height: this.height, floor: 0 };
    this.live = {}; // pet id -> the engine's pet
    this.art = {}; // "type/colour" -> sprites | "loading" | { error, at }
    this.scenes = {}; // "theme/kind/size" -> pictures | "loading" | { error, at }
    cx.timer.every(CHECK_MS, (cx) => this.check(cx));
    // keys.json can bind "pets.spawn" and "pets.remove-all".
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        if (c === "spawn") openPicker();
        else if (c === "remove-all") setShared(KEY, removeAll(load(shared(KEY))));
      }
    });
  }

  // Loads in the background; `job` resolves with the value or rejects with the reason.
  want(cache, key, job, failed, cx) {
    const cur = cache[key];
    if (cur === "loading" || (cur && !cur.error)) return;
    if (cur?.error && Date.now() - cur.at < RETRY_MS) return;
    const first = !cur;
    cache[key] = "loading";
    cx.spawn(async (cx) => {
      try {
        cache[key] = await job();
      } catch (e) {
        cache[key] = { error: String(e?.message ?? e), at: Date.now() };
        if (first) notify({ title: failed, body: cache[key].error, level: "warning" });
      }
      cx.notify();
    });
  }

  sceneKey(state) {
    return `${state.theme}/${settings()?.dark === false ? "light" : "dark"}/${state.size}`;
  }

  // A pet's sprite for its current leg, or null while there is none to show.
  sprite(pet, box) {
    const sprites = this.art[artKey(pet)]?.sprites;
    if (!sprites) return null;
    const s = sprites[pet.leg.sprite] ?? sprites.idle ?? sprites.walk ?? Object.values(sprites)[0];
    return { path: pet.leg.face === "left" ? s.left : s.right, ...fit(s.width, s.height, box) };
  }

  check(cx) {
    const now = Date.now();
    const state = load(shared(KEY));
    const box = SIZES[state.size];
    const env = (this.env = { width: this.width, height: this.height, floor: floorFor(state.theme, state.size) });
    let changed = false;
    const saved = new Set();
    for (const p of state.pets) {
      saved.add(p.id);
      this.want(this.art, artKey(p), () => loadPet(p.type, p.color), `Couldn't load ${p.name} the ${p.type}`, cx);
      let pet = this.live[p.id];
      if (!pet) {
        pet = this.live[p.id] = spawn(p, box, env, now, Math.random);
        changed = true;
      }
      pet.name = p.name;
      // The engine works with one size per pet: its idle sprite's, drawn in the box.
      const sprites = this.art[artKey(p)]?.sprites;
      const ref = sprites && (sprites.idle ?? sprites.walk ?? Object.values(sprites)[0]);
      const size = ref ? fit(ref.width, ref.height, box) : { w: box, h: box };
      pet.w = size.w;
      pet.h = size.h;
      if (refit(pet, env, now, Math.random)) changed = true;
      // No sprites yet (or none to be had): it waits where it is, as its emoji.
      if (sprites && step(pet, env, now, Math.random)) changed = true;
    }
    for (const id of Object.keys(this.live)) {
      if (!saved.has(id)) {
        delete this.live[id];
        changed = true;
      }
    }
    if (state.theme !== "none") {
      const dark = settings()?.dark !== false;
      this.want(this.scenes, this.sceneKey(state), () => loadTheme(state.theme, dark, state.size), `Couldn't load the ${state.theme} theme`, cx);
    }
    if (changed) cx.notify();
  }

  render(cx) {
    if (this.dialog) return this.dialog.render(this, cx);
    const t = theme();
    const now = Date.now();
    const state = load(shared(KEY));
    const box = SIZES[state.size];
    const scene = state.theme === "none" ? null : this.scenes[this.sceneKey(state)];

    const root = div()
      .id("pets-panel")
      .relative()
      .size_full()
      .overflow_hidden()
      .bg(t.chrome)
      .on_size_change((size, cx) => {
        // The size comes in zoomed px, but everything here is drawn in unzoomed units.
        const width = size.width / zoom();
        const height = size.height / zoom();
        if (Math.abs(width - this.width) > 1 || Math.abs(height - this.height) > 1) {
          this.width = width;
          this.height = height;
          cx.notify();
        }
      })
      .on_mouse_down("right", () => openMenu({ menu: "ground" }));

    // Upstream repeats a theme's picture along the bottom edge.
    const tile = (pic) => {
      for (let x = 0; x < this.width; x += pic.width) {
        root.child(image(pic.path).absolute().left(x).top(this.height - pic.height).w(pic.width).h(pic.height));
      }
    };
    if (scene?.background) tile(scene.background);

    for (const p of state.pets) {
      const pet = this.live[p.id];
      if (!pet) continue; // the next check spawns it
      const leg = pet.leg;
      const sprite = this.sprite(pet, box);
      const w = sprite?.w ?? pet.w;
      const h = sprite?.h ?? pet.h;
      const moving = leg.toX !== leg.fromX || leg.toY !== leg.fromY;
      // What is left of the leg: right whether or not a redraw restarts the transition.
      const duration = moving ? Math.max(1, leg.start + leg.duration - now) : 150;
      root.child(
        div()
          .id(`pet-${pet.id}`)
          .absolute()
          .w(w)
          .h(h)
          .left(leg.toX)
          .top(this.height - leg.toY - h)
          .transition("left", { duration, easing: "linear" })
          .transition("top", { duration, easing: "linear" })
          .on_hover((over, cx) => {
            if (over && swipe(pet, this.env, Date.now(), Math.random)) cx.notify();
          })
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            openMenu({ menu: "pet", pet: pet.id });
          })
          .child(
            sprite
              ? image(sprite.path).w(w).h(h)
              : div().size_full().flex().items_center().justify_center().text_size(Math.round(h * 0.8)).child(PETS[pet.type].emoji),
          )
          .when(!!leg.bubble, (el) =>
            el.child(
              div().absolute().left(0).top(-20).px(5).rounded(8).bg(t.popover).border_1().border_color(t.border)
                .text_size(11).text_color(t.foreground).child(leg.bubble),
            )),
      );
    }

    if (scene?.foreground) tile(scene.foreground);

    if (state.pets.length === 0) {
      root.child(
        div().absolute().inset_0().flex().items_center().justify_center().px(12)
          .text_size(12).text_color(t.dim).child("No pets yet. Click + to add one."),
      );
    }
    return root.child(
      div()
        .id("pets-add")
        .absolute().top(6).right(8).size(20).flex().items_center().justify_center().rounded(6)
        .text_size(15).text_color(t.muted).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click(() => openPicker())
        .on_mouse_down("right", (_e, cx) => cx.stop_propagation())
        .child("+"),
    );
  }
}
