import { MODULE_ID, escapeHTML, StrikesManager, DownedManager, isCharacter } from "./hardwipe-state.js";
import { CyberwareManager } from "./hardwipe-cyberware.js";

/**
 * Rest receipts: every rest summary in chat (short, long, and a short rest closed early) prints as a
 * safehouse slip. What came back is read from the rest's own record (dnd5e's deltas, Hardwipe's Hit Dice
 * ledger) and snapshotted when the message is created, so the slip stays true to that moment.
 * Players who can't see the character get the HP and Hit Dice lines only, as dnd5e's own card does.
 */
const SNAPSHOT = "restReceipt";
const RECOVERY = "hitDiceRecovery";
const INSTALLED_KEY = `flags.${MODULE_ID}.cyberware.installed`;

export function registerRestReceipts() {
  Hooks.on("preCreateChatMessage", message => snapshot(message));
  Hooks.once("setup", () => Hooks.on("dnd5e.renderChatMessage", (message, html) => renderReceipt(message, html)));
}

function restActor(message) {
  return message.getAssociatedActor?.() ?? ChatMessage.implementation.getSpeakerActor(message.speaker);
}

function isRestMessage(message) {
  if (message.flags?.[MODULE_ID]?.[RECOVERY]) return true;
  return message.type === "rest" && restActor(message)?.type !== "group";
}

const t = (key, data) => data ? game.i18n.format(`HARDWIPE.Receipt.${key}`, data) : game.i18n.localize(`HARDWIPE.Receipt.${key}`);
const signed = n => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;
const ratio = (value, max) => Number.isFinite(Number(max)) && Number(max) > 0 ? `${value}/${max}` : "";

/* Snapshot ------------------------------------------------------------------------------------ */

function snapshot(message) {
  if (!isRestMessage(message)) return;
  const actor = restActor(message);
  if (!actor) return;
  const hp = actor.system.attributes?.hp;
  const deltas = message.type === "rest" ? message.system?.deltas : null;
  const hpDelta = (deltas?.actor ?? []).find(d => d.keyPath === "system.attributes.hp.value")?.delta ?? 0;
  const long = message.system?.type === "long";
  const character = isCharacter(actor) && !actor.statuses?.has("dead");
  const data = {
    hp: hp ? { value: Number(hp.value) || 0, max: Number(hp.effectiveMax ?? hp.max) || 0, delta: hpDelta } : null,
    hd: actor.system.attributes?.hd ? { value: actor.system.attributes.hd.value, max: actor.system.attributes.hd.max } : null,
    lines: deltaLines(deltas, actor),
    implants: implantLines(deltas, actor),
    // A long rest clears Strikes and Downed right after this message (Hardwipe's rest rules).
    strikes: long && character ? StrikesManager.get(actor) : 0,
    downed: long && character && DownedManager.isDowned(actor)
  };
  message.updateSource({ [`flags.${MODULE_ID}.${SNAPSHOT}`]: data });
}

/** One line per resource that came back: hit dice, spell slots, item and activity uses, anything else dnd5e recorded. */
function deltaLines(deltas, actor) {
  if (!deltas) return [];
  const lines = [];
  for (const { keyPath, delta } of deltas.actor ?? []) {
    if (keyPath === "system.attributes.hp.value") continue;
    // An NPC's own Hit Dice pool.
    if (keyPath === "system.attributes.hd.spent") {
      const hd = actor.system.attributes.hd;
      lines.push({ kind: "hd", label: t("HitDice", { die: `d${hd.denomination}` }), delta: -delta, after: ratio(hd.value, hd.max) });
      continue;
    }
    const slot = keyPath.match(/^system\.spells\.(?:spell(\d)|(pact))\.value$/);
    const spell = slot ? foundry.utils.getProperty(actor, keyPath.replace(/\.value$/, "")) : null;
    lines.push({
      label: slot ? (slot[2] ? t("Pact") : t("Slots", { level: slot[1] })) : attributeLabel(keyPath, { actor }),
      delta: keyPath.endsWith(".spent") ? -delta : delta, after: spell ? ratio(spell.value, spell.max) : ""
    });
  }
  for (const [id, list] of Object.entries(deltas.item ?? {})) {
    const item = actor.items.get(id);
    if (!item) continue;
    for (const { keyPath, delta } of list) {
      // Implant installs are printed in their own section; their equip toggle is part of the install.
      if (keyPath === INSTALLED_KEY || (keyPath === "system.equipped" && CyberwareManager.isCyberware(item))) continue;
      const value = keyPath.endsWith(".spent") ? -delta : delta;
      if (keyPath === "system.hd.spent") {
        lines.push({ kind: "hd", label: t("HitDice", { die: item.system.hd.denomination }), delta: value, after: ratio(item.system.hd.value, item.system.hd.max) });
        continue;
      }
      const activity = keyPath.match(/^system\.activities\.([^.]+)\.uses\.spent$/);
      if (activity) {
        const source = item.system.activities?.get(activity[1]);
        const name = source?.name && source.name !== item.name ? `${item.name} · ${source.name}` : item.name;
        lines.push({ label: name, delta: value, after: source ? ratio(source.uses.value, source.uses.max) : "" });
        continue;
      }
      if (keyPath === "system.uses.spent") {
        lines.push({ label: item.name, delta: value, after: ratio(item.system.uses.value, item.system.uses.max) });
        continue;
      }
      lines.push({ label: `${item.name} · ${attributeLabel(keyPath, { item, prefixItemName: false })}`, delta: value, after: "" });
    }
  }
  return lines;
}

function attributeLabel(keyPath, options) {
  try {
    const label = dnd5e.utils.getHumanReadableAttributeLabel?.(keyPath, options);
    if (label) return label;
  } catch { /* Fall back to the key's last part. */ }
  return keyPath.split(".").filter(part => !["system", "value"].includes(part)).pop() ?? keyPath;
}

/** Implants installed or removed by this rest, then those still queued (no Ripperdoc, or the rest wasn't finished). */
function implantLines(deltas, actor) {
  const lines = [];
  for (const [id, list] of Object.entries(deltas?.item ?? {})) {
    const change = list.find(d => d.keyPath === INSTALLED_KEY);
    const item = actor.items.get(id);
    if (change && item) lines.push({ name: item.name, state: change.delta > 0 ? "installed" : "removed" });
  }
  for (const item of actor.items) {
    if (!CyberwareManager.isCyberware(item)) continue;
    const pending = CyberwareManager.getState(item).pending;
    if (pending) lines.push({ name: item.name, state: pending === "install" ? "queued" : "queuedRemoval" });
  }
  return lines;
}

/* Rendering ----------------------------------------------------------------------------------- */

function line(label, value, after = "", extra = "") {
  return `<div class="hardwipe-receipt-line${extra}"><span class="k">${escapeHTML(label)}</span><span class="dots"></span>`
    + `<span class="v">${escapeHTML(value)}</span><span class="n">${escapeHTML(after)}</span></div>`;
}

/** The rest's own duration from its flavor ("Short Rest (1 hour)" -> "1 hour"). */
function durationOf(message) {
  const match = String(message.flavor ?? "").match(/\(([^)]+)\)\s*$/);
  return match ? match[1] : "";
}

/** A rack number for the slip, steady per character. */
function rackOf(actor) {
  const id = String(actor?.id ?? "");
  return String(([...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 90) + 10).padStart(2, "0");
}

function rollRows(recovery, message) {
  const rows = recovery?.rolls?.length ? recovery.rolls.map(roll => ({
    die: roll.denomination, detail: [roll.formula, (roll.faces ?? []).join(" + ") + (roll.bonus ? ` ${roll.bonus}` : "")].join(" → "), value: roll.healing
  })) : message.type === "rest" && message.system?.type === "short" ? (message.rolls ?? []).map(roll => ({
    die: roll.dice?.[0] ? `d${roll.dice[0].faces}` : "", detail: `${roll.formula} → ${roll.total}`, value: roll.total
  })) : [];
  return rows.map((row, index) => `<div class="hardwipe-receipt-roll"><span>#${index + 1}</span><span class="dn">${escapeHTML(row.die)}</span>`
    + `<span class="f">${escapeHTML(row.detail)}</span><span class="v">${escapeHTML(signed(row.value))}</span></div>`).join("");
}

function renderReceipt(message, html) {
  const element = html?.querySelector ? html : html?.[0];
  if (!element || !isRestMessage(message) || !message.isContentVisible) return;
  const content = element.querySelector(".message-content");
  if (!content || content.querySelector(":scope > .hardwipe-receipt-wrap")) return;
  const actor = restActor(message);
  const data = message.flags?.[MODULE_ID]?.[SNAPSHOT] ?? {};
  const recovery = message.flags?.[MODULE_ID]?.[RECOVERY];
  const observer = !actor || actor.testUserPermission(game.user, "OBSERVER");
  const incomplete = recovery?.completed === false;
  const type = incomplete ? "short" : message.system?.type ?? "short";
  const title = game.i18n.localize(CONFIG.DND5E.restTypes?.[type]?.label ?? `DND5E.REST.${type === "long" ? "Long" : "Short"}.Label`);

  // Hit points: the Hit Dice ledger on a short rest, dnd5e's HP delta otherwise.
  // A short rest that spent its dice outside Hardwipe's dialog (automatic spending) carries them as rolls.
  const autoRolled = type === "short" && !recovery ? (message.rolls ?? []).reduce((sum, roll) => sum + Number(roll.total || 0), 0) : 0;
  const healing = recovery ? recovery.healing : data.hp?.delta || autoRolled;
  const hpAfter = observer && data.hp ? ratio(data.hp.value, data.hp.max) : "";
  const rows = [line(t("HP"), signed(healing), hpAfter)];
  rows.push(rollRows(recovery, message));
  if (recovery) rows.push(line(t("HitDiceAll"), signed(-recovery.spent), observer && data.hd ? ratio(data.hd.value, data.hd.max) : ""));
  const lines = observer ? data.lines ?? [] : data.lines?.filter(entry => entry.kind === "hd") ?? [];
  for (const entry of lines) rows.push(line(entry.label, signed(entry.delta), entry.after));
  const abilities = observer ? recovery?.abilities ?? [] : [];
  for (const ability of abilities) {
    rows.push(line(ability.name, t("Used")));
    // What it did (Arcane Recovery's slots) on its own line under it.
    if (ability.detail && ability.detail !== t("Used")) rows.push(`<div class="hardwipe-receipt-line is-sub">${escapeHTML(ability.detail)}</div>`);
  }

  // Chrome and status: implants, Strikes and Downed cleared.
  const status = [];
  if (observer) {
    if (data.strikes > 0) status.push(line(t("Strikes"), t("Cleared"), `${data.strikes}→0`));
    if (data.downed) status.push(line(t("Downed"), t("Cleared")));
    for (const implant of data.implants ?? []) {
      status.push(line(implant.name, t(`Implant.${implant.state}`)));
      if (implant.state.startsWith("queued")) status.push(`<div class="hardwipe-receipt-line is-sub">${escapeHTML(t(incomplete ? "QueuedIncomplete" : "QueuedNoDoc"))}</div>`);
    }
  }

  const patched = (healing > 0 ? 1 : 0) + lines.filter(entry => entry.delta > 0).length + abilities.length + (data.strikes > 0 ? 1 : 0) + (data.downed ? 1 : 0)
    + (data.implants ?? []).filter(implant => implant.state === "installed").length;
  const full = observer && !incomplete && type === "long" && data.hp && data.hp.value >= data.hp.max;
  const stamp = incomplete ? `<div class="hardwipe-receipt-stamp is-void">${escapeHTML(t("Incomplete"))}</div>`
    : full ? `<div class="hardwipe-receipt-stamp">${escapeHTML(t("FullyPatched"))}</div>` : "";
  const quip = t(incomplete ? "QuipIncomplete" : type === "long" ? "QuipLong" : "QuipShort");
  const meta = incomplete ? t("CutShort") : durationOf(message);

  const receipt = document.createElement("div");
  receipt.className = "hardwipe-receipt-wrap";
  receipt.innerHTML = `<div class="hardwipe-receipt ${incomplete ? "is-incomplete" : `is-${type}`}">
    <div class="hardwipe-receipt-head"><div class="hardwipe-receipt-logo">${escapeHTML(t("Logo"))}</div>
      <div class="hardwipe-receipt-sub">${escapeHTML(t("Sub", { rack: rackOf(actor) }))}</div></div>
    <div class="hardwipe-receipt-title">${escapeHTML(title)}</div>
    <div class="hardwipe-receipt-meta"><span>${escapeHTML(actor?.name ?? message.alias ?? "")}</span><span>${escapeHTML(meta)}</span></div>
    <hr>${rows.join("")}
    ${status.length ? `<hr><div class="hardwipe-receipt-sect">${escapeHTML(t("Chrome"))}</div>${status.join("")}` : ""}
    <hr><div class="hardwipe-receipt-total"><span>${escapeHTML(t("Patched"))}</span><span>${patched}</span></div>
    ${stamp}
    <div class="hardwipe-receipt-barcode"></div>
    <div class="hardwipe-receipt-foot">${escapeHTML(t("Foot"))}</div>
    <div class="hardwipe-receipt-foot is-quip">${escapeHTML(quip)}</div>
  </div>`;
  // dnd5e's rest card may list activities to use after the rest; they stay, under the slip.
  const activities = content.querySelector(".activities");
  content.replaceChildren(receipt);
  if (activities) content.append(activities);
  element.classList.add("hardwipe-rest-message");
}
