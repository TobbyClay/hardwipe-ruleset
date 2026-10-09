/* globals

*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { WalledTemplateCone } from "./WalledTemplateCone.js";
import { pixelsToGridUnits } from "../geometry/util.js";

export class WalledTemplateRoundedCone extends WalledTemplateCone {

  /**
   * Original cone SWADE shape
   * https://gitlab.com/peginc/swade/-/blob/develop/src/module/canvas/SwadeMeasuredTemplate.ts
   * @param {object} [opts]     Optional values to temporarily override the ones in this instance.
   * @returns {PIXI.Polygon}
   */
  calculateOriginalShape({ direction, angle, distance } = {}) {
    if ( !this.template._getConeShape ) return super.calculateOriginalShape({ direction, angle, distance }); // In case SWADE is not present.
    direction ??= this.direction;
    angle ??= this.angle;
    distance ??= this.distance;

    // Convert to degrees and grid units for Foundry method.
    // direction = Math.toDegrees(direction);
    // angle = Math.toDegrees(angle);
    // distance = pixelsToGridUnits(distance);
    const width = this.template?.document?.width ?? pixelsToGridUnits(this.width);

    // if ( !angle ) return foundry.canvas.placeables.MeasuredTemplate.getConeShape(pixelsToGridUnits(distance), Math.toDegrees(direction), Math.toDegrees(angle));
    return this.template._getConeShape(direction, angle, distance, width);
  }
}
