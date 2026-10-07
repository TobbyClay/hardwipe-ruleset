import { MODULE_ID, escapeHTML } from "./hardwipe-state.js";
import { CyberwareManager } from "./hardwipe-cyberware.js";

/** Keep individual Hit Dice in the native short-rest dialog and retain its one rest summary. */
export class ShortRestManager {
  static _dialogs = new Map();
  static _initialized = false;

  static initialize() {
    if (this._initialized) return;
    const NativeDialog = CONFIG.DND5E.restTypes.short?.dialogClass;
    if (!NativeDialog || !globalThis.libWrapper?.register) return;
    this._initialized = true;
    const Dialog = createShortRestDialog(NativeDialog);
    // Retain the native rest message and its request/resource metadata, replacing only its prose.
    libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype._displayRestResultMessage", async function(wrapped, config, result) {
      const message = await wrapped(config, result);
      const summary = config?.[MODULE_ID]?.hitDiceRecovery;
      if (config.type === "short" && summary && message) {
        await message.update({
          content: `<p>${escapeHTML(game.i18n.format("HARDWIPE.Rest.Completed", { name: this.name, ...summary }))}</p>`,
          [`flags.${MODULE_ID}.hitDiceRecovery`]: { ...summary, completed: true }
        });
      }
      return message;
    }, "WRAPPER");
    Hooks.on("dnd5e.preShortRest", (actor, config) => {
      if (!config.dialog || actor.type === "group" || !actor.isOwner || config.dialogClass !== NativeDialog) return;
      const open = this._dialogs.get(actor.uuid);
      if (open) {
        open.bringToFront();
        return false;
      }
      config.dialogClass = Dialog;
      config.autoHD = false;
    });
  }
}

/** Healing, dice spent, each roll and the rest abilities used, for the chat summary (the rest receipt prints them). */
function recoverySummary(history, abilities = []) {
  return {
    healing: history.reduce((sum, entry) => sum + entry.healing, 0),
    spent: history.reduce((sum, entry) => sum + entry.spent, 0),
    rolls: history.map(({ denomination, formula, faces, bonus, total, healing }) => ({ denomination, formula, faces, bonus, total, healing })),
    abilities: abilities.map(({ name, detail }) => ({ name, detail }))
  };
}

/** The monitor's colour: red under a third of max HP, blue under two thirds, green above. */
const BANDS = ["critical", "stable", "healthy"];
function healthBand(fraction) {
  return fraction < 1 / 3 ? "critical" : fraction < 2 / 3 ? "stable" : "healthy";
}

/** Seconds for the monitor's sweep to cross the trace. */
const SWEEP_SECONDS = 3;

/**
 * The med-scan monitor's heart trace, drawn in a 396 x 64 box. From a third of max HP up it is a steady
 * rhythm. While critical it is an arrhythmia: uneven gaps with a tremor on the line, beats of uneven
 * height, and now and then a wide, inverted beat. A fixed seed keeps that shape the same between renders.
 * The sweep's head follows the trace at a constant horizontal speed (keyPoints map each vertex's x to its
 * distance along the path), and its phase comes from the clock so a re-render doesn't restart it.
 */
function tracePath(fraction, uid) {
  const amp = 6 + 22 * Math.max(0, Math.min(1, fraction));
  const points = [[0, 34]];
  let x = 0;
  if (fraction >= 1 / 3) {
    while (x < 396) {
      x += 26;
      points.push([x, 34], [x + 4, 34 - amp * 0.2], [x + 7, 34], [x + 10, 34], [x + 12, 34 - amp], [x + 15, 34 + amp * 0.7],
        [x + 18, 34], [x + 24, 34], [x + 28, 34 - amp * 0.25], [x + 33, 34]);
      x += 33;
    }
  } else {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const peak = Math.max(amp, 20);
    while (x < 396) {
      const gap = 14 + random() * 46;
      for (let step = 5; step < gap; step += 5) points.push([x + step, 34 + (random() - 0.5) * 5]);
      x += gap;
      const a = peak * (0.35 + random() * 0.8);
      if (random() < 0.3) {
        points.push([x, 34], [x + 5, 34 + a * 0.55], [x + 11, 34 - a * 0.9], [x + 17, 34 + a * 0.35], [x + 24, 34]);
        x += 24;
      } else {
        points.push([x, 34], [x + 3, 34 - a * 0.15], [x + 6, 34], [x + 8, 34 - a], [x + 10, 34 + a * 0.6], [x + 13, 34], [x + 19, 34 - a * 0.2], [x + 23, 34]);
        x += 23;
      }
    }
  }
  const d = points.map(([px, py], index) => `${index ? "L" : "M"}${px} ${+py.toFixed(1)}`).join(" ");
  const lengths = [0];
  for (let index = 1; index < points.length; index++) {
    lengths.push(lengths[index - 1] + Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]));
  }
  const end = points.at(-1)[0];
  const total = lengths.at(-1);
  return {
    d, end, uid, dur: SWEEP_SECONDS,
    begin: -((Date.now() / 1000) % SWEEP_SECONDS),
    keyTimes: points.map(([px]) => +(px / end).toFixed(4)).join(";"),
    keyPoints: lengths.map(length => +(length / total).toFixed(4)).join(";")
  };
}

/** Everything the monitor shows: vitals, the HP bar (had, each die's healing, the next die's range) and the dice. */
function monitorContext(dialog, context) {
  const actor = dialog.actor;
  const hp = actor.system.attributes.hp;
  const max = Math.max(1, Number(hp.effectiveMax ?? hp.max) || 1);
  const value = Number(hp.value) || 0;
  const start = Math.min(dialog._startHP ?? value, value);
  const pct = n => Math.max(0, Math.min(100, n / max * 100));
  const healing = dialog._history.reduce((sum, entry) => sum + entry.healing, 0);
  const band = healthBand(value / max);

  // Dice left of each size, out of the character's total (class levels; an NPC's own pool).
  const totals = {};
  for (const cls of actor.itemTypes?.class ?? []) {
    const size = cls.system.hd?.denomination;
    if (size) totals[size] = (totals[size] ?? 0) + (Number(cls.system.hd.max ?? cls.system.levels) || 0);
  }
  if (actor.system.isNPC) totals[`d${actor.system.attributes.hd.denomination}`] = Number(actor.system.attributes.hd.max) || 0;
  const dice = (context.hitDice?.options ?? []).map(option => {
    const total = Math.max(totals[option.value] ?? 0, option.number);
    return {
      value: option.value, number: option.number, total, empty: !option.number,
      selected: option.value === context.hitDice.denomination,
      pips: Array.from({ length: Math.min(total, 10) }, (_, index) => index < option.number)
    };
  });

  // The next die's possible healing, from the selected size and CON (as the native dialog computes it).
  const size = Number(context.hitDice?.denomination?.slice(1));
  const con = Number(actor.system.abilities?.con?.mod) || 0;
  const range = size && context.hitDice?.canRoll && value < max
    ? { min: Math.max(1 + con, 1), max: Math.max(size + con, 1) } : null;
  return {
    name: actor.name, img: actor.img, value, max, start, healing,
    band, bandLabel: game.i18n.localize(`HARDWIPE.Rest.Band.${band}`), steady: band !== "critical", trace: tracePath(value / max, `hw-ecg-${actor.id}`),
    had: pct(start), mark: pct(start),
    segments: dialog._history.filter(entry => entry.healing > 0).map(entry => ({ healing: entry.healing, width: pct(entry.healing) })),
    ghost: range ? Math.min(pct(range.max), 100 - pct(value)) : 0,
    range: range ? `${range.min}–${range.max}` : "",
    dice
  };
}

/** Features that recover spell slots on a short rest, with the class whose level sets the budget. Neither recovers above level 5. */
const SLOT_RECOVERY = { "arcane-recovery": "wizard", "natural-recovery": "druid" };
const SLOT_RECOVERY_MAX_LEVEL = 5;

/**
 * Features to use during the rest: activities that activate on a short rest (dnd5e lists the same ones
 * on its rest card), plus Arcane Recovery and Natural Recovery, whose older versions activate otherwise.
 */
function restAbilities(actor) {
  const periods = CONFIG.DND5E.restTypes.short?.activationPeriods ?? ["shortRest"];
  const found = [];
  for (const item of actor.items) {
    const activities = item.system.activities;
    if (!activities?.size) continue;
    const slotClass = SLOT_RECOVERY[item.system.identifier] ?? null;
    let list = activities.filter(activity => periods.includes(activity.activation?.type));
    if (!list.length && slotClass) list = [activities.find(activity => /recover/i.test(activity.name)) ?? activities.contents[0]];
    for (const activity of list) found.push({ item, activity, slotClass, key: `${item.id}.${activity.id}` });
  }
  return found;
}

/** The uses an activity spends: its own, or its item's. */
function usesOf(item, activity) {
  if (activity.uses?.max) return activity.uses;
  return item.system.uses?.max ? item.system.uses : null;
}

/**
 * Expended slots a recovery feature can bring back. The budget is half the class level, rounded up, in
 * combined slot levels. One pip per expended slot; a pip is off-limits when picking up to it would pass the budget.
 */
function slotRecovery(actor, slotClass, picks = {}) {
  const budget = Math.ceil((Number(actor.classes?.[slotClass]?.system.levels) || 0) / 2);
  const used = Object.entries(picks).reduce((sum, [level, count]) => sum + Number(level) * count, 0);
  const rows = [];
  for (let level = 1; level <= SLOT_RECOVERY_MAX_LEVEL; level++) {
    const slot = actor.system.spells?.[`spell${level}`];
    const expended = Math.max(0, (Number(slot?.max) || 0) - (Number(slot?.value) || 0));
    if (!expended) continue;
    const picked = picks[level] ?? 0;
    rows.push({
      level, label: game.i18n.format("HARDWIPE.Rest.SlotLevel", { level }),
      slots: Array.from({ length: expended }, (_, index) => ({
        count: index + 1, on: index < picked, off: index >= picked && used + (index + 1 - picked) * level > budget
      }))
    });
  }
  return { budget, used, rows };
}

/**
 * What else completing the rest brings back, as dnd5e recovers it: item and activity uses (with New Day's
 * periods when it is ticked), pact slots and resources, then Hardwipe's queued implants.
 */
function restGains(actor, config) {
  const rest = CONFIG.DND5E.restTypes.short ?? {};
  const periods = [];
  if (config?.newDay && dnd5e.settings.calendarConfig?.manualRecovery) periods.push("day", "dawn", "dusk");
  periods.push(...(rest.recoverPeriods ?? ["sr"]));
  const gains = [];
  const ratio = (value, max) => `${value}/${max}`;
  const fromUses = (label, data, rollData) => {
    if (!data?.max || !data.spent || !data.recovery?.length) return;
    const period = periods.find(p => data.recovery.some(recovery => recovery.period === p));
    const profile = period && data.recovery.find(recovery => recovery.period === period);
    if (!profile || profile.type === "loseAll") return;
    if (profile.type === "recoverAll") return gains.push({ label, value: `${ratio(data.value, data.max)} → ${ratio(data.max, data.max)}` });
    if (!profile.formula) return;
    try {
      const roll = new Roll(profile.formula, rollData);
      if (!roll.isDeterministic) return gains.push({ label, value: `+${profile.formula}` });
      const after = Math.min(data.max, data.value + (Number(roll.evaluateSync().total) || 0));
      if (after > data.value) gains.push({ label, value: `${ratio(data.value, data.max)} → ${ratio(after, data.max)}` });
    } catch { /* dnd5e reports a broken recovery formula when the rest runs. */ }
  };
  for (const item of actor.items) {
    if (item.isHidden) continue;
    const rollData = item.getRollData();
    fromUses(item.name, item.system.uses, rollData);
    for (const activity of item.system.activities ?? []) {
      fromUses(activity.name && activity.name !== item.name ? `${item.name} · ${activity.name}` : item.name, activity.uses, rollData);
    }
  }
  const slotTypes = rest.recoverSpellSlotTypes ?? new Set(["pact"]);
  for (const [key, slot] of Object.entries(actor.system.spells ?? {})) {
    if (!slotTypes.has(slot?.type) || !(Number(slot.max) > Number(slot.value))) continue;
    const level = key.match(/^spell(\d)$/)?.[1];
    gains.push({
      label: level ? game.i18n.format("HARDWIPE.Receipt.Slots", { level }) : game.i18n.localize("HARDWIPE.Receipt.Pact"),
      value: `${ratio(slot.value, slot.max)} → ${ratio(slot.max, slot.max)}`
    });
  }
  for (const [key, resource] of Object.entries(actor.system.resources ?? {})) {
    if (!resource?.sr || !Number.isNumeric(resource.max) || !(Number(resource.max) > Number(resource.value))) continue;
    gains.push({ label: resource.label || key, value: `${ratio(resource.value, resource.max)} → ${ratio(resource.max, resource.max)}` });
  }
  for (const { item, pending, blocked } of CyberwareManager.restOutcome(actor)) {
    gains.push({ label: item.name, value: game.i18n.localize(`HARDWIPE.Rest.Implant.${blocked ?? pending}`), held: !!blocked });
  }
  return gains;
}

function createShortRestDialog(NativeDialog) {
  return class HardwipeShortRestDialog extends NativeDialog {
    static DEFAULT_OPTIONS = {
      classes: ["hardwipe-short-rest"],
      actions: {
        rollHitDie: HardwipeShortRestDialog._rollHitDie,
        useRestAbility: HardwipeShortRestDialog._useRestAbility,
        pickSlot: HardwipeShortRestDialog._pickSlot,
        recoverSlots: HardwipeShortRestDialog._recoverSlots,
        cancelSlots: HardwipeShortRestDialog._cancelSlots
      },
      position: { width: 420 }
    };

    static PARTS = {
      ...NativeDialog.PARTS,
      content: { template: "modules/hardwipe-ruleset/templates/short-rest.hbs" }
    };

    _history = [];
    _abilities = []; // Rest abilities used in this dialog: { key, name, detail }.
    _slotPick = null; // The spell-slot picker that is open: { key, picks: { level: count } }.
    _rolling = null; // A die roll or ability in progress; other actions and closing wait for it.
    _selectedDenomination = null;
    _summaryPosted = false;
    _closeRequested = false;
    _closing = null;

    constructor(options = {}) {
      super(options);
      // HP when the dialog opened: the monitor's bar shows each die's healing on top of it.
      this._startHP = Number(this.actor.system.attributes?.hp?.value) || 0;
      ShortRestManager._dialogs.set(this.actor.uuid, this);
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      if (context.hitDice?.options.some(o => o.value === this._selectedDenomination && o.number > 0)) {
        context.hitDice.denomination = this._selectedDenomination;
      }
      context.recovery = {
        history: this._history,
        healing: this._history.reduce((sum, entry) => sum + entry.healing, 0),
        spent: this._history.reduce((sum, entry) => sum + entry.spent, 0)
      };
      context.busy = !!this._rolling || this._closeRequested;
      context.monitor = monitorContext(this, context);
      context.abilities = restAbilities(this.actor).map(({ item, activity, slotClass, key }) => {
        const uses = usesOf(item, activity);
        const done = this._abilities.find(entry => entry.key === key);
        const picking = this._slotPick?.key === key;
        const pick = picking ? slotRecovery(this.actor, slotClass, this._slotPick.picks) : null;
        return {
          key, img: item.img, name: item.name,
          // An activity's own name when it has one (an unnamed one shows its type, e.g. "Midi Use").
          sub: done?.detail ?? (slotClass ? game.i18n.localize("HARDWIPE.Rest.SlotHint")
            : activity._source?.name && activity.name !== item.name ? activity.name : game.i18n.localize("HARDWIPE.Rest.UseHint")),
          uses: uses ? `${uses.value}/${uses.max}` : "",
          done: !!done,
          locked: !!done || context.busy || picking || activity.canUse === false || (uses ? uses.value < 1 : false),
          pick: pick && {
            ...pick,
            rule: game.i18n.format("HARDWIPE.Rest.SlotRule", { budget: pick.budget, max: SLOT_RECOVERY_MAX_LEVEL }),
            tally: game.i18n.format("HARDWIPE.Rest.SlotTally", { used: pick.used, budget: pick.budget })
          }
        };
      });
      context.gains = restGains(this.actor, this.config);
      return context;
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      // The whole monitor takes the patient's health colour.
      for (const band of BANDS) this.element.classList.toggle(`is-${band}`, band === context.monitor?.band);
    }

    async _prepareFooterContext(context, options) {
      context = await super._prepareFooterContext(context, options);
      if (this._rolling || this._closeRequested) {
        context.buttons?.forEach(button => { button.disabled = true; });
      }
      return context;
    }

    /** Native rollHitDie handles class choice, CON, modifiers, consumption, HP caps and hooks. */
    static async _rollHitDie(event, target) {
      if (this._rolling || this._closeRequested) return;
      const denomination = this.form.elements.denom?.value;
      if (!denomination) return;
      this._selectedDenomination = denomination;
      // Preserve the native rest form settings across the partial re-render.
      const data = new foundry.applications.ux.FormDataExtended(this.form);
      foundry.utils.mergeObject(this.config, this._processFormData(event, this.form, data));
      this.config.autoHD = false;
      this._setBusy(true);
      this._rolling = this._roll(denomination);
      try {
        await this._rolling;
      } finally {
        this._rolling = null;
        if (!this._closeRequested) {
          this._setBusy(false);
          await this.render();
        }
      }
    }

    async _roll(denomination) {
      const beforeHP = this.actor.system.attributes.hp.value;
      const beforeHD = this.actor.system.attributes.hd.value;
      const result = await this.actor.rollHitDie({ denomination }, { configure: false }, { create: false });
      const rolls = Array.isArray(result) ? result : result ? [result] : [];
      if (!rolls.length) return;
      const total = rolls.reduce((sum, roll) => sum + Number(roll.total), 0);
      // The faces rolled and the flat bonus (CON and any modifiers) behind the total.
      const faces = rolls.flatMap(roll => roll.dice.flatMap(die => die.results.filter(r => r.active !== false).map(r => r.result)));
      const bonus = total - faces.reduce((sum, face) => sum + face, 0);
      const healing = Math.max(0, this.actor.system.attributes.hp.value - beforeHP);
      const signedBonus = bonus ? `${bonus > 0 ? "+" : "−"} ${Math.abs(bonus)}` : "";
      this._history.push({
        number: this._history.length + 1,
        denomination,
        total,
        healing,
        spent: Math.max(0, beforeHD - this.actor.system.attributes.hd.value),
        // Read as dice plus bonus ("1d10 + 2"), not the system's max(1, ...) floor.
        formula: `${faces.length || 1}${denomination}${signedBonus ? ` ${signedBonus}` : ""}`,
        faces,
        bonus: signedBonus,
        capped: healing < total
      });
    }

    /** Use a rest ability. A spell-slot recovery feature opens its slot picker instead; its use is spent on Recover slots. */
    static async _useRestAbility(event, target) {
      if (this._rolling || this._closeRequested) return;
      const found = restAbilities(this.actor).find(entry => entry.key === target.dataset.key);
      if (!found) return;
      if (found.slotClass) {
        this._slotPick = { key: found.key, picks: {} };
        await this.render();
        return;
      }
      await this._runAbility(found, () => found.activity.use({ event }), game.i18n.localize("HARDWIPE.Rest.Used"));
    }

    static async _pickSlot(event, target) {
      if (!this._slotPick || this._rolling) return;
      const level = Number(target.dataset.level);
      const count = Number(target.dataset.count);
      // Clicking the last picked pip of a level drops it again.
      this._slotPick.picks[level] = this._slotPick.picks[level] === count ? count - 1 : count;
      await this.render();
    }

    static async _cancelSlots() {
      if (this._rolling) return;
      this._slotPick = null;
      await this.render();
    }

    static async _recoverSlots(event) {
      if (this._rolling || this._closeRequested) return;
      const pick = this._slotPick;
      const found = pick && restAbilities(this.actor).find(entry => entry.key === pick.key);
      if (!found) return;
      const chosen = Object.entries(pick.picks).filter(([, count]) => count > 0);
      const { budget, used } = slotRecovery(this.actor, found.slotClass, pick.picks);
      if (!chosen.length || used > budget) return;
      this._slotPick = null;
      const detail = chosen.map(([level, count]) => game.i18n.format("HARDWIPE.Rest.SlotsBack", { level, count })).join(" · ");
      await this._runAbility(found, async () => {
        // Spend the feature's use directly, then bring the slots back. The feature's own use would roll its
        // "combined spell levels" formula, a budget the picker already enforces; the rest receipt records the use.
        const uses = usesOf(found.item, found.activity);
        if (!uses || uses.value < 1) return false;
        const path = uses === found.activity.uses ? `system.activities.${found.activity.id}.uses.spent` : "system.uses.spent";
        await found.item.update({ [path]: Number(uses.spent) + 1 });
        const spells = this.actor.system.spells;
        await this.actor.update(Object.fromEntries(chosen.map(([level, count]) => {
          const slot = spells[`spell${level}`];
          return [`system.spells.spell${level}.value`, Math.min(Number(slot.max), Number(slot.value) + count)];
        })));
        return true;
      }, detail);
    }

    /** Run an ability like a die roll: the dialog is busy until it settles, and a successful use is logged. */
    async _runAbility(found, run, detail) {
      this._setBusy(true);
      this._rolling = (async () => {
        if (await run()) this._abilities.push({ key: found.key, name: found.item.name, detail });
      })();
      try {
        await this._rolling;
      } finally {
        this._rolling = null;
        if (!this._closeRequested) {
          this._setBusy(false);
          await this.render();
        }
      }
    }

    _setBusy(busy) {
      this.element?.classList.toggle("is-busy", busy);
      this.element?.querySelectorAll("button[type=submit], [data-action=rollHitDie], [data-action=useRestAbility], [data-action=recoverSlots], [name=denom]")
        .forEach(control => { control.disabled = busy; });
    }

    async _onChangeForm(formConfig, event) {
      this._selectedDenomination = this.form.elements.denom?.value ?? null;
      const result = await super._onChangeForm(formConfig, event);
      // New Day changes what the rest restores.
      if (event.target?.name === "newDay") {
        this.config.newDay = !!event.target.checked;
        await this.render();
      }
      return result;
    }

    async _onSubmitForm(formConfig, event) {
      event.preventDefault();
      if (this._rolling || this._closeRequested) return;
      return super._onSubmitForm(formConfig, event);
    }

    close(options = {}) {
      if (this._closing) return this._closing;
      this._closeRequested = true;
      this._setBusy(true);
      this._closing = this._close(options);
      return this._closing;
    }

    async _close(options) {
      // Closing during a roll must wait for its committed HP/HD updates and ledger entry.
      try { await this._rolling; } catch { /* Native roll failure already rejects its action. */ }
      try {
        const summary = recoverySummary(this._history, this._abilities);
        if (this.rested) {
          this.config[MODULE_ID] = { ...this.config[MODULE_ID], hitDiceRecovery: summary };
        }
        if (!this.rested && !this._summaryPosted && this.config.chat !== false && (this._history.length || this._abilities.length)) {
          this._summaryPosted = true;
          const data = {
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            flavor: game.i18n.localize("HARDWIPE.Rest.Recovery"),
            content: `<p>${escapeHTML(game.i18n.format("HARDWIPE.Rest.Interrupted", {
              name: this.actor.name, ...summary
            }))}</p>`,
            flags: { [MODULE_ID]: { hitDiceRecovery: { ...summary, completed: false } } }
          };
          ChatMessage.applyMode(data, CONFIG.Dice.BasicRoll.getMessageMode());
          await ChatMessage.create(data);
        }
      } finally {
        try { await super.close(options); }
        finally {
          if (ShortRestManager._dialogs.get(this.actor.uuid) === this) ShortRestManager._dialogs.delete(this.actor.uuid);
        }
      }
    }
  };
}
