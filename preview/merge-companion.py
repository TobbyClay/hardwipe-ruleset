"""Build a merged Ready Set Midi 14.0.10.2 companion.

Base: the live install's bundle (Hardwipe cover bridge, JS sha cea0bbb7...).
Added: only the wall-effects hunks of preview/Workflow.wall-effects.patch, in their
compiled form as found in the tested preview bundle (JS sha 40cbb1e4...).
Usage: python -I merge.py <live module dir> <out module dir>
"""
import hashlib, shutil, sys
from pathlib import Path

src, out = Path(sys.argv[1]), Path(sys.argv[2])
BASE_SHA = "cea0bbb749fa570d49af2404ddeb2f51f6580f141b08e3a58a25c021472ff38b"

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
        if (!hasPendingWallReview() && configSettings.autoRemoveInstantaneousTemplate && this.templateUuids.length > 0 && this.activity.duration?.units === "inst") {
          for (const tUuid of this.templateUuids) {
            if (!blfxActive) {
              const elapsed = Date.now() - (this.workflowStartTime ?? 0);
              let timeout = AAActive ? Math.max(elapsedTimeRequired - elapsed, 1) : 1;
              timeout = Math.max(elapsedTimeRequired, timeout);
              setTimeout(() => {
                if (!hasPendingWallReview()) fromUuidSync(tUuid)?.delete();
              }, timeout);
            } else {
              setTimeout(() => {
                if (!hasPendingWallReview()) fromUuidSync(tUuid)?.delete();
              }, elapsedTimeRequired);'''),
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
print("merged", hashlib.sha256(text.encode("utf-8")).hexdigest())
