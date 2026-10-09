/* globals
canvas,
*/
"use strict";

import {
  getRegionFlagUpdateData,
  isManagedWalledRegionDocument,
  refreshPreviewEffectiveRegionData,
  refreshPreviewEffectiveRegionDataFromSourceHandle
} from "./Region.js";

export const PATCHES = {};
PATCHES.BASIC = {};

function _updateDragPreview(wrapped, event) {
  const out = wrapped(event);
  refreshPreviewEffectiveRegionData(event.interactionData.preview.document);
  return out;
}

function _onDragMove(wrapped, event) {
  const preview = event.interactionData.preview?.document;
  const handle = event.interactionData.handle;
  if ( !isManagedWalledRegionDocument(preview) ) return wrapped(event);
  if ( !["translate", "rotate", "scale"].includes(handle?.name) ) return wrapped(event);

  canvas._onDragCanvasPan(event);
  const { destination } = event.interactionData;
  if ( refreshPreviewEffectiveRegionDataFromSourceHandle(preview, handle.name, destination, { snap: false }) ) return true;
  return wrapped(event);
}

function _prepareDragDropUpdate(wrapped, event) {
  const result = wrapped(event);
  const preview = event.interactionData.preview?.document;
  if ( !isManagedWalledRegionDocument(preview) ) return result;

  const flagUpdate = getRegionFlagUpdateData(preview);
  if ( !flagUpdate ) return result;

  if ( Array.isArray(result) ) {
    const [data, options] = result;
    return [foundry.utils.mergeObject(data, flagUpdate, { inplace: false }), options];
  }

  return foundry.utils.mergeObject(result, flagUpdate, { inplace: false });
}

PATCHES.BASIC.WRAPS = { _onDragMove, _updateDragPreview, _prepareDragDropUpdate };
