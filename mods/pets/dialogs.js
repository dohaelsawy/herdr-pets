// The mod's three overlays, each opened as this same mod with props { role }:
// the picker (add a pet), the rename prompt, and the right-click menus.
// Each is { init(view, cx), render(view, cx) }; main.js hands its view over.
import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { shared, setShared, theme, props, openOverlay, closeOverlay, notify } from "herdr";
import { PETS, TYPES } from "./pets.js";
import { KEY, MAX_PETS, SIZE_NAMES, THEMES, load, addPet, removePet, renamePet, removeAll, withSize, withTheme, randomName, newId } from "./store.js";
import { EXTENSION_ONLY } from "./sources.js";
import { extensionMedia, loadPet } from "./art.js";

// The mod's folder name. If an install renames the folder, change this to match.
export const MOD = "pets";

export const openPicker = () => openOverlay({ mod: MOD, kind: "dialog", width: 420, height: 540, props: { role: "picker" } });
export const openRename = (pet) => openOverlay({ mod: MOD, kind: "dialog", width: 340, height: 170, props: { role: "rename", pet } });
// what: { menu: "ground" } or { menu: "pet", pet: <id> }. The heights fit each menu's rows.
export const openMenu = (what) =>
  openOverlay({ mod: MOD, kind: "popup", at: "pointer", width: 200, height: what.menu === "pet" ? 90 : 400, props: { role: "menu", ...what } });

const close = () => closeOverlay(props().overlay);
const save = (change) => setShared(KEY, change(load(shared(KEY))));
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
const pretty = (s) => cap(s.replaceAll("_", " ").replaceAll("-", " "));

const button = (t, id, text, primary, action) =>
  h_flex().id(id).h(32).px(14).items_center().rounded(8)
    .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
    .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
    .hover((s) => s.opacity(0.88)).on_click(action).child(text);

// ---- add a pet ------------------------------------------------------------------

const picker = {
  init(v, cx) {
    v.filter = "";
    v.type = null;
    v.color = null;
    v.busy = 0; // when the fetch in progress started, or 0
    v.error = "";
    v.extension = null; // null: not known yet
    v.search = InputState.new({ placeholder: "Search pets…" });
    v.search.on("change", (_e, cx) => { v.filter = v.search.value(); cx.notify(); });
    v.name = InputState.new({ placeholder: "Name" });
    v.search.focus();
    cx.timer.after(300, () => v.search.focus());
    cx.spawn(async (cx) => {
      v.extension = !!(await extensionMedia());
      cx.notify();
    });
  },

  choose(v, type) {
    v.type = type;
    v.color = PETS[type].colors[0];
    v.error = "";
    v.name = InputState.new({ value: randomName(type, Math.random), placeholder: "Name" });
    v.name.on("submit", (_e, cx) => picker.add(v, cx));
  },

  add(v, cx) {
    // A fetch that has said nothing for two minutes is dead: let Add start another.
    if (v.busy && Date.now() - v.busy < 120000) return;
    if (!v.type || load(shared(KEY)).pets.length >= MAX_PETS) return;
    const pet = {
      id: newId(Date.now(), Math.random),
      type: v.type,
      color: v.color,
      name: v.name.value().trim() || randomName(v.type, Math.random),
    };
    const started = (v.busy = Date.now());
    v.error = "";
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        await loadPet(pet.type, pet.color); // no sprites, no pet
        if (v.closed || v.busy !== started) return; // closed, or a later try took over
        save((s) => addPet(s, pet));
        close();
      } catch (e) {
        if (v.closed || v.busy !== started) return;
        v.busy = 0;
        v.error = String(e?.message ?? e);
        notify({ title: `Couldn't add the ${pretty(pet.type).toLowerCase()}`, body: v.error, level: "error" });
        cx.notify();
      }
    });
  },

  render(v) {
    const t = theme();
    const full = load(shared(KEY)).pets.length >= MAX_PETS;
    const f = v.filter.trim().toLowerCase();
    const shown = TYPES.filter((type) => !f || type.includes(f) || pretty(type).toLowerCase().includes(f)); // "rubber duck" too
    const locked = (type) => v.extension === false && EXTENSION_ONLY.includes(type);
    const def = v.type ? PETS[v.type] : null;
    return v_flex().id("pets-picker").size_full().min_h(0).p(18).gap(10).bg(t.popover).text_color(t.foreground)
      .child(h_flex().items_center().justify_between()
        .child(div().text_size(15).font_semibold().child("Add a pet"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(Input.new(v.search).h(34).flex_none().px(10).rounded(8).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.5).text_color(t.foreground))
      .child(div().flex_1().min_h(0).overflow_y_scrollbar().child(
        v_flex().gap(2).children(shown.map((type) => {
          const off = locked(type);
          const row = h_flex().id(`pick-${type}`).h(30).px(8).gap(8).items_center().rounded(6)
            .bg(type === v.type ? t.selected : "#00000000")
            .child(div().w(22).text_size(15).child(PETS[type].emoji))
            .child(div().text_size(12.5).text_color(off ? t.dim : t.foreground).child(pretty(type)));
          if (off) return row.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child("Needs the vscode-pets extension installed in an editor."));
          return row.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { picker.choose(v, type); cx.notify(); });
        })))
      )
      .when(!!def, (el) => el
        .child(h_flex().flex_wrap().gap(6).children(def.colors.map((color) =>
          div().id(`color-${color}`).px(8).h(24).flex().items_center().rounded(12).border_1()
            .border_color(color === v.color ? t.accent : t.input).bg(color === v.color ? t.selected : t.raised)
            .text_size(11.5).cursor_pointer().on_click((_e, cx) => { v.color = color; cx.notify(); })
            .child(pretty(color)))))
        .child(Input.new(v.name).h(34).flex_none().px(10).rounded(8).border_1().border_color(t.input)
          .bg(t.background).text_size(12.5).text_color(t.foreground)))
      .when(!!v.error, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(v.error)))
      .when(full, (el) => el.child(div().text_size(11.5).text_color(t.muted).child(`${MAX_PETS} pets is the limit. Remove one to add another.`)))
      .child(h_flex().gap(8).justify_end()
        .child(button(t, "pets-cancel", "Cancel", false, () => close()))
        .when(!!def && !full, (el) => el.child(button(t, "pets-add", v.busy ? "Fetching…" : "Add", true, (_e, cx) => picker.add(v, cx)))));
  },
};

// ---- rename ---------------------------------------------------------------------

const rename = {
  init(v, cx) {
    const pet = load(shared(KEY)).pets.find((p) => p.id === props().pet);
    const name = pet?.name ?? "";
    v.input = InputState.new({ value: name });
    if (name) v.input.set_selected_range({ start: 0, end: name.length });
    v.input.on("submit", () => rename.submit(v));
    v.input.focus();
    cx.timer.after(300, () => v.input.focus());
  },

  submit(v) {
    const id = props().pet;
    save((s) => renamePet(s, id, v.input.value()));
    close();
  },

  render(v) {
    const t = theme();
    return v_flex().id("pets-rename").w_full().min_h(0).p(18).gap(12).bg(t.popover).text_color(t.foreground)
      .child(div().text_size(15).font_semibold().child("Rename pet"))
      .child(Input.new(v.input).h(36).px(10).rounded(9).border_1().border_color(t.accent)
        .bg(t.background).text_size(12.8).text_color(t.foreground))
      .child(h_flex().gap(8).justify_end()
        .child(button(t, "pets-rename-cancel", "Cancel", false, () => close()))
        .child(button(t, "pets-rename-save", "Save", true, () => rename.submit(v))));
  },
};

// ---- right-click menus ----------------------------------------------------------

// Rows: { label } is a heading, { text, run, on } an item (on: shows a check mark).
function menuRows(p, state) {
  if (p.menu === "pet") {
    const pet = state.pets.find((x) => x.id === p.pet);
    if (!pet) return [{ label: "This pet is gone" }];
    return [
      { label: `${pet.name} the ${pretty(pet.type).toLowerCase()}` },
      { text: "Rename…", run: () => openRename(pet.id) },
      { text: "Remove", run: () => save((s) => removePet(s, pet.id)) },
    ];
  }
  return [
    { text: "Add pet…", run: () => openPicker() },
    { label: "Theme" },
    ...THEMES.map((name) => ({ text: cap(name), on: state.theme === name, run: () => save((s) => withTheme(s, name)) })),
    { label: "Size" },
    ...SIZE_NAMES.map((name) => ({ text: cap(name), on: state.size === name, run: () => save((s) => withSize(s, name)) })),
    { label: "" },
    { text: "Remove all", run: () => save(removeAll) },
  ];
}

const menu = {
  init() {},

  render() {
    const t = theme();
    const rows = menuRows(props() ?? {}, load(shared(KEY)));
    return v_flex().id("pets-menu").w_full().p(4).bg(t.popover).text_color(t.foreground).text_size(12.5)
      .children(rows.map((row, i) => {
        if (row.label !== undefined) {
          return div().h(row.label ? 22 : 7).px(8).flex().items_center().text_size(11).text_color(t.dim).truncate().child(row.label);
        }
        return h_flex().id(`pets-menu-${i}`).h(26).px(8).gap(6).items_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.hover))
          .on_click(() => { close(); row.run(); })
          .child(div().w(12).text_color(t.accent).child(row.on ? "✓" : ""))
          .child(div().child(row.text));
      }));
  },
};

export const DIALOGS = { picker, rename, menu };
