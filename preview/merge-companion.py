"""Build Hardwipe's Ready Set Midi 14.0.10.2 companion.

Base: the cover-bridge bundle (Hardwipe's ranged-cover hooks, JS sha cea0bbb7...).
Added, as compiled hunks that must each match exactly once:
- the wall-effects hunks of preview/Workflow.wall-effects.patch (as in the tested preview bundle, JS 40cbb1e4...);
- an instantaneous area kept for a GM wall review is removed once the review is decided;
- the reaction and bonus-action markers are deleted after Foundry marks them expired at the turn start, not in
  the same instant (that race showed the GM "dnd5ereaction000 does not exist" at every turn change).
Usage: python -I merge.py <cover-bridge module dir> <out module dir>
"""
import hashlib, re, shutil, sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
BASE_SHA = "cea0bbb749fa570d49af2404ddeb2f51f6580f141b08e3a58a25c021472ff38b"
RELEASE_DOWNLOAD = "https://github.com/TobbyClay/hardwipe-ruleset/releases/download/v0.7.48/ready-set-midi-14.0.10.2.zip"

HUNKS = [
("count helper", '''// src/module/Workflow.ts
function getUsageButtons(message) {''', '''// src/module/Workflow.ts
function countPlacedTemplateAreas(document2) {
  if (document2.documentName !== "Region") return 1;
  const walled = document2.flags?.["walled-regions"];
  const shapes = Array.isArray(walled?.sourceShapes) ? walled.sourceShapes : Array.isArray(document2.shapes) ? document2.shapes : [];
  return shapes.filter((shape) => shape && typeof shape === "object" && !shape.hole).length;
}
function getUsageButtons(message) {'''),
("count helper name", '''    minAttackTotal = -100;
    __name(getUsageButtons, "getUsageButtons");''', '''    minAttackTotal = -100;
    __name(countPlacedTemplateAreas, "countPlacedTemplateAreas");
    __name(getUsageButtons, "getUsageButtons");'''),
("templateUuid setter", '''        this.persistFields({ templateUuid, templateUuids: this.templateUuids });''', '''        this.placedTemplateCount = this.templateUuids.reduce((count, uuid) => {
          const document2 = fromUuidSync(uuid);
          return count + (document2 ? countPlacedTemplateAreas(document2) : 0);
        }, 0);
        this.forcePersistFields({ templateUuid, templateUuids: this.templateUuids });'''),
("needTemplate", '''        return this.expectedTemplateCount > 0 && this.templateUuids.length < this.expectedTemplateCount;''',
 '''        return this.expectedTemplateCount > 0 && this.placedTemplateCount < this.expectedTemplateCount;'''),
("reset count", '''          this.expectedTemplateCount = 0;
        }
        this.templateUuids = [];
        if (this.activity instanceof MidiSummonActivity''', '''          this.expectedTemplateCount = 0;
        }
        this.templateUuids = [];
        this.placedTemplateCount = 0;
        if (this.activity instanceof MidiSummonActivity'''),
("processPlacedTemplates", '''        const expectedCount = Number(activity?.target?.template?.count) || 1;
        if (templates.length < expectedCount) {
          for (const tDoc of templates) {
            try {''', '''        const expectedCount = Number((activity ?? this.activity)?.target?.template?.count) || 1;
        const documents = /* @__PURE__ */ new Map();
        for (const template of templates) {
          const scene = template.parent;
          const region = template._id ? (scene ?? canvas.scene)?.regions.get(template._id) : void 0;
          const document2 = region ?? template;
          if (document2.uuid) documents.set(document2.uuid, document2);
        }
        const placedCount = [...documents.values()].reduce((count, document2) => count + countPlacedTemplateAreas(document2), 0);
        if (placedCount < expectedCount) {
          for (const tDoc of documents.values()) {
            try {'''),
("processPlacedTemplates store", '''        for (const tDoc of templates) {
          const regionDoc = tDoc._id ? canvas.scene?.regions.get(tDoc._id) : void 0;
          const docToStore = regionDoc ?? tDoc;
          this.templateUuid = docToStore.uuid;
          await this.setupTemplateCleanup(docToStore);
          if (regionDoc && activity) {''', '''        for (const tDoc of documents.values()) {
          const regionDoc = tDoc.documentName === "Region" ? tDoc : void 0;
          this.templateUuid = tDoc.uuid;
          await this.setupTemplateCleanup(tDoc);
          if (regionDoc && activity) {'''),
("processPlacedTemplates count", '''        this.placedTemplateCount = templates.length;
        this.selectAllTemplateTargets(activity);''', '''        this.selectAllTemplateTargets(activity);'''),
("AwaitTemplate", '''        if (this.templateUuids.length >= this.expectedTemplateCount) {''', '''        if (this.placedTemplateCount >= this.expectedTemplateCount) {'''),
("cleanup review guard", '''        if (configSettings.autoRemoveInstantaneousTemplate && this.templateUuids.length > 0 && this.activity.duration?.units === "inst") {
          for (const tUuid of this.templateUuids) {
            if (!blfxActive) {
              const elapsed = Date.now() - (this.workflowStartTime ?? 0);
              let timeout = AAActive ? Math.max(elapsedTimeRequired - elapsed, 1) : 1;
              timeout = Math.max(elapsedTimeRequired, timeout);
              setTimeout(() => {
                fromUuidSync(tUuid)?.delete();
              }, timeout);
            } else {
              setTimeout(() => {
                fromUuidSync(tUuid)?.delete();
              }, elapsedTimeRequired);''', '''        const hasPendingWallReview = /* @__PURE__ */ __name(() => {
          const state = game.messages.get(this.itemCardId)?.flags?.["hardwipe-ruleset"]?.coverAttack;
          return state?.mode === "area" && state.pending;
        }, "hasPendingWallReview");
        // An area under a pending GM wall review stays for the GM to verify, then goes once the review is decided.
        const removeWhenDecided = /* @__PURE__ */ __name((tUuid) => {
          if (!hasPendingWallReview()) return void fromUuidSync(tUuid)?.delete()?.catch?.(() => {});
          const cardId = this.itemCardId;
          const stop = /* @__PURE__ */ __name(() => {
            Hooks.off("updateChatMessage", updateHook);
            Hooks.off("deleteChatMessage", deleteHook);
          }, "stop");
          const updateHook = Hooks.on("updateChatMessage", (message) => {
            if (message.id !== cardId || hasPendingWallReview()) return;
            stop();
            void fromUuidSync(tUuid)?.delete()?.catch?.(() => {});
          });
          const deleteHook = Hooks.on("deleteChatMessage", (message) => {
            if (message.id === cardId) stop();
          });
        }, "removeWhenDecided");
        if (configSettings.autoRemoveInstantaneousTemplate && this.templateUuids.length > 0 && this.activity.duration?.units === "inst") {
          for (const tUuid of this.templateUuids) {
            if (!blfxActive) {
              const elapsed = Date.now() - (this.workflowStartTime ?? 0);
              let timeout = AAActive ? Math.max(elapsedTimeRequired - elapsed, 1) : 1;
              timeout = Math.max(elapsedTimeRequired, timeout);
              setTimeout(() => {
                removeWhenDecided(tUuid);
              }, timeout);
            } else {
              setTimeout(() => {
                removeWhenDecided(tUuid);
              }, elapsedTimeRequired);'''),
("reaction marker expiry", '''  if (force || !installedModules.get("times-up")) {
    await actor.effects.get(getStaticID("reaction"))?.delete();
  }''', '''  if (force || !installedModules.get("times-up")) {
    // At its holder's turn start Foundry marks this marker expired; deleting it here at the same moment made that
    // update fail ("dnd5ereaction000 does not exist"). deleteExpiredActionMarker removes it once marked.
    // Combat end and rests (force) still remove it directly.
    const marker = actor.effects.get(getStaticID("reaction"));
    if (marker && (force || !turnExpiringMarker(marker))) await marker.delete();
  }'''),
("bonus action marker expiry", '''  if (force || !installedModules.get("times-up")) {
    await actor.effects.get(getStaticID("bonusaction"))?.delete();
  }''', '''  if (force || !installedModules.get("times-up")) {
    const marker = actor.effects.get(getStaticID("bonusaction"));
    if (marker && (force || !turnExpiringMarker(marker))) await marker.delete();
  }'''),
("expired marker cleanup", '''  if (force) await actor.update({ flags: { [MODULE_ID]: { actions: { bonusActionsUsed: 0, bonus: false, "-=bonusActionCombatRound": null } } } });
}
function needsReactionCheck(actor) {''', '''  if (force) await actor.update({ flags: { [MODULE_ID]: { actions: { bonusActionsUsed: 0, bonus: false, "-=bonusActionCombatRound": null } } } });
}
function turnExpiringMarker(effect) {
  return ["turnStart", "targetStart"].includes(effect?.duration?.expiry);
}
// Foundry marks turn-expiring markers expired at the turn start; the preferred GM then removes them, in that order.
function deleteExpiredActionMarker(effect, changes) {
  if (changes?.duration?.expired !== true) return;
  if (effect.id !== getStaticID("reaction") && effect.id !== getStaticID("bonusaction")) return;
  if (!preferredActiveGM()?.isSelf || installedModules.get("times-up")) return;
  void effect.delete().catch(() => {});
}
Hooks.on("updateActiveEffect", deleteExpiredActionMarker);
function needsReactionCheck(actor) {'''),
("auto-place count", '''            await this.setupTemplateCleanup(docToStore);
          }
          this.placedTemplateCount = templates.length;
          this.selectAllTemplateTargets();''', '''            await this.setupTemplateCleanup(docToStore);
          }
          this.selectAllTemplateTargets();'''),
("constructor count", '''        this.expectedTemplateCount = activityHasAreaTarget(this.activity) ? 1 : 0;
        this.templateUuids = [];
        this.needsDamage''', '''        this.expectedTemplateCount = activityHasAreaTarget(this.activity) ? 1 : 0;
        this.templateUuids = [];
        this.placedTemplateCount = 0;
        this.needsDamage'''),
]

js = (src / "ready-set-midi.js").read_bytes()
assert hashlib.sha256(js).hexdigest() == BASE_SHA, "unexpected base bundle"
text = js.decode("utf-8")
for name, old, new in HUNKS:
    n = text.count(old)
    assert n == 1, f"{name}: anchor found {n} times"
    text = text.replace(old, new)
if out.exists():
    shutil.rmtree(out)
shutil.copytree(src, out)
(out / "ready-set-midi.js").write_bytes(text.encode("utf-8"))
# Foundry installs the companion from the Hardwipe release it ships with, so its manifest names that release.
manifest = (out / "module.json").read_text(encoding="utf-8")
download = re.search(r'"download": "([^"]*)"', manifest)
assert download, "module.json has no download URL"
manifest = manifest.replace(download.group(0), f'"download": "{RELEASE_DOWNLOAD}"')
(out / "module.json").write_text(manifest, encoding="utf-8")
print("merged", hashlib.sha256(text.encode("utf-8")).hexdigest())
