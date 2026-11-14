// Pets: the vscode-pets animals living in a Herdr panel. They are decoration: you add,
// name and remove them. Click + to add one; right-click a pet or the ground for more.
// Opened with props { role } this same mod is one of its dialogs (see dialogs.js).
import { View, div, image } from "gpui-kit";
import { shared, setShared, theme, settings, props, notify, nextCommand } from "herdr";
import { PETS } from "./pets.js";
import { SIZES } from "./engine.js";
import { reconcile, hover, drawing } from "./roster.js";
import { KEY, load, floorFor, applyCommand } from "./store.js";
import { loadPet, loadTheme } from "./art.js";
import { DIALOGS, openPicker, openMenu } from "./dialogs.js";

// How often legs are checked. This does arithmetic only; the panel is redrawn only
// when a pet starts a new leg. Motion itself is Herdr's native transition.
const CHECK_MS = 200;
const RETRY_MS = 60000; // a failed download is tried again after this long
// A load that has said nothing for this long is taken for dead (Herdr can stop a
// script without telling it) and is started again.
const STALL_MS = 120000;
const SNAP_MS = 150; // a change of place that is not a walk or a climb
const BUBBLE_H = 20;
const zoom = () => (Number(settings()?.zoom) > 0 ? Number(settings().zoom) : 1);
const artKey = (pet) => `${pet.type}/${pet.color}`;
// A cache entry that holds a loaded value: not one still loading, not a failure.
const loaded = (entry) => (entry && !entry.pending && !entry.error ? entry : null);

export default class Pets extends View {
  init(_p, cx) {
    const role = props()?.role;
    this.dialog = typeof role === "string" && Object.hasOwn(DIALOGS, role) ? DIALOGS[role] : null;
    this.closed = false;
    if (this.dialog) return this.dialog.init(this, cx);
    this.width = 220;
    this.height = 300;
    this.env = { width: this.width, height: this.height, floor: 0 };
    this.live = {}; // pet id -> the engine's pet
    this.art = {}; // "type/colour" -> sprites | { pending: <since> } | { error, at }
    this.scenes = {}; // "theme/kind/size" -> pictures | { pending } | { error, at }
    cx.timer.every(CHECK_MS, (cx) => this.check(cx));
    // keys.json can bind "pets.spawn", "pets.remove-all", "pets.size-<name>" and
    // "pets.theme-<name>".
    cx.spawn(async () => {
      for (;;) {
        const c = await nextCommand();
        try {
          const next = applyCommand(load(shared(KEY)), c);
          if (next) setShared(KEY, next);
          else if (c === "spawn") openPicker();
        } catch (e) {
          console.log(`pets: command ${c} failed: ${e?.message ?? e}`); // and keep listening
        }
      }
    });
  }

  // Herdr calls this when a dialog goes; work it left running checks the flag.
  async close() {
    this.closed = true;
  }

  // Loads in the background; `job` resolves with the value or rejects with the reason.
  want(cache, key, job, failed, cx) {
    const cur = cache[key];
    if (loaded(cur)) return;
    if (cur?.pending && Date.now() - cur.pending < STALL_MS) return;
    if (cur?.error && Date.now() - cur.at < RETRY_MS) return;
    const first = !cur;
    const mine = (cache[key] = { pending: Date.now() });
    cx.spawn(async (cx) => {
      let result;
      try {
        result = await job();
      } catch (e) {
        result = { error: String(e?.message ?? e), at: Date.now() };
        if (first) notify({ title: failed, body: result.error, level: "warning" });
      }
      if (cache[key] === mine) cache[key] = result; // not if a later try took over
      cx.notify();
    });
  }

  sceneKey(state) {
    return `${state.theme}/${settings()?.dark === false ? "light" : "dark"}/${state.size}`;
  }

  // A saved pet's loaded sprites, or null while there are none.
  sprites(p) {
    return loaded(this.art[artKey(p)])?.sprites ?? null;
  }

  check(cx) {
    const state = load(shared(KEY));
    let scene = null;
    if (state.theme !== "none") {
      const dark = settings()?.dark !== false;
      const key = this.sceneKey(state);
      this.want(this.scenes, key, () => loadTheme(state.theme, dark, state.size), `Couldn't load the ${state.theme} theme`, cx);
      scene = loaded(this.scenes[key]);
    }
    for (const p of state.pets) {
      this.want(this.art, artKey(p), () => loadPet(p.type, p.color), `Couldn't load ${p.name} the ${p.type}`, cx);
    }
    // Pets stand on a theme's ground only once its picture is there to stand on.
    this.env = { width: this.width, height: this.height, floor: scene ? floorFor(state.theme, state.size) : 0 };
    if (reconcile(this.live, state.pets, (p) => this.sprites(p), SIZES[state.size], this.env, Date.now(), Math.random)) cx.notify();
  }

  render(cx) {
    if (this.dialog) return this.dialog.render(this, cx);
    const t = theme();
    const now = Date.now();
    const state = load(shared(KEY));
    const box = SIZES[state.size];
    const scene = state.theme === "none" ? null : loaded(this.scenes[this.sceneKey(state)]);

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
      if (!(pic.width > 0)) return; // stepping by nothing would never reach the edge
      for (let x = 0; x < this.width; x += pic.width) {
        root.child(image(pic.path).absolute().left(x).top(this.height - pic.height).w(pic.width).h(pic.height));
      }
    };
    if (scene?.background) tile(scene.background);

    for (const p of state.pets) {
      const pet = this.live[p.id];
      if (!pet) continue; // the next check spawns it
      const d = drawing(pet, this.sprites(p), box, now);
      // The element is one box high whatever the sprite's height, and the picture
      // stands on its bottom: a pet's animations differ in height, and its feet must
      // not move when it changes from one to another.
      const w = d.sprite?.w ?? d.w;
      const h = d.sprite?.h ?? d.h;
      root.child(
        div()
          .id(`pet-${pet.id}`)
          .absolute()
          .w(w)
          .h(box)
          .left(d.x)
          .top(this.height - d.y - box)
          // The time left in the glide: right whether or not a redraw restarts it.
          .transition("left", { duration: d.moveX || SNAP_MS, easing: "linear" })
          .transition("top", { duration: d.moveY || SNAP_MS, easing: "linear" })
          .on_hover((over, cx) => {
            if (over && hover(pet, this.sprites(p), this.env, Date.now(), Math.random)) cx.notify();
          })
          .on_mouse_down("right", (_e, cx) => {
            cx.stop_propagation();
            openMenu({ menu: "pet", pet: pet.id });
          })
          .child(
            d.sprite
              ? image(d.sprite.path).absolute().left(0).top(box - h).w(w).h(h)
              : div().absolute().left(0).top(box - h).w(w).h(h).flex().items_center().justify_center()
                  .text_size(Math.round(h * 0.8)).child(PETS[pet.type].emoji),
          )
          .when(!!d.bubble, (el) =>
            el.child(
              div().absolute().left(0).top(box - h - BUBBLE_H).px(5).rounded(8).whitespace_nowrap()
                .bg(t.popover).border_1().border_color(t.border)
                .text_size(11).text_color(t.foreground).child(d.bubble),
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
