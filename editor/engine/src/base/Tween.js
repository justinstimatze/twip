/*
 * Copyright 2020 WICKLETS LLC
 *
 * This file is part of Wick Engine.
 *
 * Wick Engine is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Wick Engine is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Wick Engine.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Class representing a tween.
 */
Wick.Tween = class extends Wick.Base {
    static get VALID_EASING_TYPES () {
        return [
            'none',
            'custom',
            'in', 'out', 'in-out',
            'in-cubic', 'out-cubic', 'in-out-cubic',
            'in-quartic', 'out-quartic', 'in-out-quartic',
            'in-quintic', 'out-quintic', 'in-out-quintic',
            'in-sine', 'out-sine', 'in-out-sine',
            'in-exp', 'out-exp', 'in-out-exp',
            'in-circle', 'out-circle', 'in-out-circle',
            'in-back', 'out-back', 'in-out-back',
            'in-bounce', 'out-bounce', 'in-out-bounce'
        ];
    }

    /**
     * The curve a tween uses when its easingType is 'custom': the two control points of a
     * cubic Bézier from (0,0) to (1,1), as [x1, y1, x2, y2]. The default is CSS ease-in-out.
     *
     * x is time and is clamped to [0, 1], because a control point outside that makes the
     * curve fold back on itself and progress run backwards. y is deliberately unclamped —
     * pulling a handle past 1 overshoots and past 0 anticipates, which is the whole reason to
     * want a curve instead of the named list.
     */
    static get DEFAULT_BEZIER () {
        return [0.42, 0, 0.58, 1];
    }

    /**
     * Progress through a curve at time k, for any easingType.
     *
     * Exists so the editor can plot a curve without reaching into a tween instance —
     * the graph in the Inspector draws every easing this way, named ones included, which is
     * what lets grabbing the curve of `out-bounce` turn into a custom curve that starts where
     * the bounce left off rather than somewhere unrelated.
     */
    static sampleEasing (easingType, bezier, k) {
        if (easingType === 'custom') {
            return Wick.Tween.cubicBezierEase(bezier || Wick.Tween.DEFAULT_BEZIER, k);
        }
        var fn = Wick.Tween.prototype._getTweenFunction.call({ easingType: easingType });
        return fn ? fn(k) : k;
    }

    /**
     * A cubic Bézier from (0,0) to (1,1) with control points [x1,y1,x2,y2], evaluated as
     * progress against time.
     *
     * The curve is parametric, so the x the caller has is not the parameter the curve is
     * written in: find the parameter whose x matches, then read that parameter's y. Newton
     * converges in a handful of steps for the curves anyone draws, and bisection catches the
     * ones where it does not — a nearly vertical segment, where the derivative is small
     * enough that a Newton step overshoots the interval.
     *
     * This is the same solve WebKit's UnitBezier does, and it is written the same way in
     * src/lib.rs so the browser preview and the exported SWF agree. `easing_matches_bezier_js`
     * over there pins the two together against sampled output from this function.
     */
    static cubicBezierEase (bezier, k) {
        if (k <= 0) return 0;
        if (k >= 1) return 1;

        var x1 = bezier[0], y1 = bezier[1], x2 = bezier[2], y2 = bezier[3];
        var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
        var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;

        var sampleX = function (t) { return ((ax * t + bx) * t + cx) * t; };
        var sampleY = function (t) { return ((ay * t + by) * t + cy) * t; };
        var slopeX = function (t) { return (3 * ax * t + 2 * bx) * t + cx; };

        var t = k;
        for (var i = 0; i < 8; i++) {
            var error = sampleX(t) - k;
            if (Math.abs(error) < 1e-7) return sampleY(t);
            var slope = slopeX(t);
            if (Math.abs(slope) < 1e-6) break;
            t -= error / slope;
        }

        var lo = 0, hi = 1;
        t = k;
        while (lo < hi) {
            var x = sampleX(t);
            if (Math.abs(x - k) < 1e-7) return sampleY(t);
            if (k > x) lo = t; else hi = t;
            var next = (hi + lo) / 2;
            if (next === t) break;
            t = next;
        }
        return sampleY(t);
    }

    static _calculateTimeValue (tweenA, tweenB, playheadPosition) {
        var tweenAPlayhead = tweenA.playheadPosition;
        var tweenBPlayhead = tweenB.playheadPosition;
        var dist = tweenBPlayhead - tweenAPlayhead;
        var t = (playheadPosition - tweenAPlayhead) / dist;
        return t;
    }

    /**
     * Create a tween
     * @param {number} playheadPosition - the playhead position relative to the frame that the tween belongs to
     * @param {Wick.Transform} transformation - the transformation this tween will apply to child objects
     * @param {number} fullRotations - the number of rotations to add to the tween's transformation
     */
    constructor (args) {
        if(!args) args = {};
        super(args);

        this._playheadPosition = args.playheadPosition || 1;
        this._transformation = args.transformation || new Wick.Transformation();
        this.fullRotations = args.fullRotations === undefined ? 0 : args.fullRotations;
        this.easingType = args.easingType || 'none';
        this.bezier = args.bezier;
        this.tweenMethod = args.tweenMethod || 'normal';

        this._originalLayerIndex = -1;
    }

    /**
     * Create a tween by interpolating two existing tweens.
     * @param {Wick.Tween} tweenA - The first tween
     * @param {Wick.Tween} tweenB - The second tween
     * @param {Number} playheadPosition - The point between the two tweens to use to interpolate
     */
    static interpolate (tweenA, tweenB, playheadPosition) {
        var interpTween = new Wick.Tween();

        // Calculate value (0.0-1.0) to pass to tweening function
        var t = Wick.Tween._calculateTimeValue(tweenA, tweenB, playheadPosition);

        // Interpolate every transformation attribute using the t value
        var transformA = tweenA.transformation;
        var transformB = tweenB.transformation;
        if(tweenA.tweenMethod === 'normal') {
            var paperTransform = {},
                opacity;
            transformA = transformA.paperValues;
            transformB = transformB.paperValues;
        }
        ["x", "y", "scaleX", "scaleY", "rotation", "skew", "opacity"].forEach(propName => {
            var tweenFn = tweenA._getTweenFunction();
            var tt = tweenFn(t);
            var valA = transformA[propName];
            var valB = transformB[propName];
            if(propName === 'rotation') {
                // Constrain rotation values to range of -180 to 180
                // (Disabled for now - a bug in paper.js clamps these for us)
                /*while(valA < -180) valA += 360;
                while(valB < -180) valB += 360;
                while(valA > 180) valA -= 360;
                while(valB > 180) valB -= 360;*/
                // Convert full rotations to 360 degree amounts
                valB += tweenA.fullRotations * 360;
            }
            if(tweenA.tweenMethod === 'skew') interpTween.transformation[propName] = lerp(valA, valB, tt);
            else {
                if(propName === 'opacity') opacity = lerp(valA, valB, tt);
                else paperTransform[propName] = lerp(valA, valB, tt);
            }
        });

        if(tweenA.tweenMethod === 'normal') {
            interpTween.transformation = Wick.Transformation.fromMatrix(
                Wick.Transformation.toMatrixPaper(paperTransform)
            );
            interpTween.transformation.opacity = opacity;
        }

        interpTween.playheadPosition = playheadPosition;
        return interpTween;
    }

    get classname () {
        return 'Tween';
    }

    _serialize (args) {
        var data = super._serialize(args);

        data.playheadPosition = this.playheadPosition;
        data.transformation = this._transformation.values;
        data.fullRotations = this.fullRotations;
        data.easingType = this.easingType;
        data.bezier = this._bezier.slice();
        data.tweenMethod = this.tweenMethod;

        data.originalLayerIndex = this.layerIndex !== -1 ? this.layerIndex : this._originalLayerIndex;

        return data;
    }

    _deserialize (data) {
        super._deserialize(data);

        this.playheadPosition = data.playheadPosition;
        this._transformation = new Wick.Transformation(data.transformation);
        this.fullRotations = data.fullRotations;
        this.easingType = data.easingType;
        // Absent from every file written before custom curves existed, and from anything
        // wickeditor.com writes. The setter falls back to the default, and a file that old
        // cannot say easingType 'custom' either, so it never reads this at all.
        this.bezier = data.bezier;
        this.tweenMethod = data.tweenMethod;

        this._originalLayerIndex = data.originalLayerIndex;
    }

    /**
     * The playhead position of the tween.
     * @type {number}
     */
    get playheadPosition () {
        return this._playheadPosition;
    }

    set playheadPosition (playheadPosition) {
        this._playheadPosition = playheadPosition;
    }

    /**
     * The transformation representing the position, rotation and other elements of the tween.
     * @type {object} 
     */
    get transformation () {
        return this._transformation;
    }

    set transformation (transformation) {
        this._transformation = transformation;
    }

    /**
     * The type of interpolation to use for easing.
     * @type {string}
     */
    get easingType () {
        return this._easingType;
    }

    set easingType (easingType) {
        if(Wick.Tween.VALID_EASING_TYPES.indexOf(easingType) === -1) {
            console.warn('Invalid easingType. Valid easingTypes: ')
            console.warn(Wick.Tween.VALID_EASING_TYPES);
            return;
        }
        this._easingType = easingType;
    }

    /**
     * The control points of the custom curve, [x1, y1, x2, y2]. Only consulted when
     * easingType is 'custom'; carried regardless, so switching to a named easing and back
     * does not lose the curve somebody drew.
     * @type {number[]}
     */
    get bezier () {
        return this._bezier;
    }

    set bezier (bezier) {
        if(!Array.isArray(bezier) || bezier.length !== 4 || bezier.some(n => typeof n !== 'number' || !isFinite(n))) {
            this._bezier = Wick.Tween.DEFAULT_BEZIER;
            return;
        }
        var clamp = n => Math.max(0, Math.min(1, n));
        this._bezier = [clamp(bezier[0]), bezier[1], clamp(bezier[2]), bezier[3]];
    }

    /**
     * Choose a curve for this segment from where it sits in the motion, and switch to it.
     *
     * The rule is the one an animator applies by hand. A segment with nothing before it
     * starts from rest, so it accelerates. A segment whose far end is the last key comes to
     * rest, so it decelerates. A segment with motion on both sides is in the middle of
     * something already moving and should not slow down and speed up again, so it stays
     * linear. A lone segment does both.
     *
     * Easing here governs the span from this tween to the NEXT one, which is why the far end
     * asks about the key after the next rather than about this one.
     */
    autoSmooth () {
        var tweens = this.parentFrame
            ? this.parentFrame.tweens.slice().sort((a, b) => a.playheadPosition - b.playheadPosition)
            : [this];
        var i = tweens.findIndex(tween => tween === this);
        var startsFromRest = i <= 0;
        var comesToRest = i === -1 || i + 2 >= tweens.length;

        this.easingType = 'custom';
        if(startsFromRest && comesToRest) this.bezier = [0.42, 0, 0.58, 1];
        else if(startsFromRest) this.bezier = [0.42, 0, 1, 1];
        else if(comesToRest) this.bezier = [0, 0, 0.58, 1];
        else this.bezier = [0, 0, 1, 1];
        return this._bezier;
    }

    /**
     *
     */
    get tweenMethod () {
        return this._tweenMethod;
    }
    set tweenMethod (tweenMethod) {
        if (tweenMethod === 'skew') this._tweenMethod = 'skew';
        else this._tweenMethod = 'normal';
    }

    /**
     * Remove this tween from its parent frame.
     */
    remove () {
        this.parent.removeTween(this);
    }

    /**
     * Set the transformation of a clip to this tween's transformation.
     * @param {Wick.Clip} clip - the clip to apply the tween transforms to.
     */
    applyTransformsToClip (clip) {
        clip.transformation = this.transformation.copy();
    }

    /**
     * The tween that comes after this tween in the parent frame.
     * @returns {Wick.Tween}
     */
    getNextTween () {
        if(!this.parentFrame) return null;

        var frontTween = this.parentFrame.seekTweenInFront(this.playheadPosition+1);
        return frontTween;
    }

    /**
     * Prevents tweens from existing outside of the frame's length. Call this after changing the length of the parent frame.
     */
    restrictToFrameSize () {
        var playheadPosition = this.playheadPosition;

        // Remove tween if playheadPosition is out of bounds
        if(playheadPosition < 1 || playheadPosition > this.parentFrame.length) {
            this.remove();
        }
    }

    /**
     * The index of the parent layer of this tween.
     * @type {number}
     */
    get layerIndex () {
        return this.parentLayer ? this.parentLayer.index : -1;
    }

    /**
     * The index of the layer that this tween last belonged to. Used when copying and pasting tweens.
     * @type {number}
     */
    get originalLayerIndex () {
        return this._originalLayerIndex;
    }

     /* retrieve Tween.js easing functions by name */
    _getTweenFunction () {
        if(this.easingType === 'custom') {
            var bezier = this.bezier || Wick.Tween.DEFAULT_BEZIER;
            return function (k) { return Wick.Tween.cubicBezierEase(bezier, k); };
        }
        return {
            'none': TWEEN.Easing.Linear.None,
            'in': TWEEN.Easing.Quadratic.In,
            'out': TWEEN.Easing.Quadratic.Out,
            'in-out': TWEEN.Easing.Quadratic.InOut,
            'in-cubic': TWEEN.Easing.Cubic.In,
            'out-cubic': TWEEN.Easing.Cubic.Out,
            'in-out-cubic': TWEEN.Easing.Cubic.InOut,
            'in-quartic': TWEEN.Easing.Quartic.In,
            'out-quartic': TWEEN.Easing.Quartic.Out,
            'in-out-quartic': TWEEN.Easing.Quartic.InOut,
            'in-quintic': TWEEN.Easing.Quintic.In,
            'out-quintic': TWEEN.Easing.Quintic.Out,
            'in-out-quintic': TWEEN.Easing.Quintic.InOut,
            'in-sine': TWEEN.Easing.Sinusoidal.In,
            'out-sine': TWEEN.Easing.Sinusoidal.Out,
            'in-out-sine': TWEEN.Easing.Sinusoidal.InOut,
            'in-exp': TWEEN.Easing.Exponential.In,
            'out-exp': TWEEN.Easing.Exponential.Out,
            'in-out-exp': TWEEN.Easing.Exponential.InOut,
            'in-circle': TWEEN.Easing.Circular.In,
            'out-circle': TWEEN.Easing.Circular.Out,
            'in-out-circle': TWEEN.Easing.Circular.InOut,
            'in-back': TWEEN.Easing.Back.In,
            'out-back': TWEEN.Easing.Back.Out,
            'in-out-back': TWEEN.Easing.Back.InOut,
            'in-bounce': TWEEN.Easing.Bounce.In,
            'out-bounce': TWEEN.Easing.Bounce.Out,
            'in-out-bounce': TWEEN.Easing.Bounce.InOut,
        }[this.easingType];
    }
}
