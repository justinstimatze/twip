describe('Wick.Tween', function() {
    describe('#constructor', function () {
        it('should instantiate', function () {
            var tween = new Wick.Tween();
            expect(tween.classname).to.equal('Tween');
        });
    });

    describe('#interpolate', function () {
        it('should tween position correctly', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1,
                }),
                fullRotations: 0,
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 100,
                    y: 200,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 1);
            expect(tweenC.transformation.x).to.equal(0);
            expect(tweenC.transformation.y).to.equal(0);
            expect(tweenC.transformation.scaleX).to.equal(1);
            expect(tweenC.transformation.scaleY).to.equal(1);
            expect(tweenC.transformation.rotation).to.equal(0);
            expect(tweenC.transformation.opacity).to.equal(1);
            expect(tweenC.fullRotations).to.equal(0);

            var tweenD = Wick.Tween.interpolate(tweenA, tweenB, 2);
            expect(tweenD.transformation.x).to.equal(50);
            expect(tweenD.transformation.y).to.equal(100);
            expect(tweenD.transformation.scaleX).to.equal(1);
            expect(tweenD.transformation.scaleY).to.equal(1);
            expect(tweenD.transformation.rotation).to.equal(0);
            expect(tweenD.transformation.opacity).to.equal(1);
            expect(tweenD.fullRotations).to.equal(0);
        });

        it('should tween scale correctly', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 2,
                    scaleY: 3,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 2);
            expect(tweenC.transformation.x).to.equal(0);
            expect(tweenC.transformation.y).to.equal(0);
            expect(tweenC.transformation.scaleX).to.equal(1.5);
            expect(tweenC.transformation.scaleY).to.equal(2.0);
            expect(tweenC.transformation.rotation).to.equal(0);
            expect(tweenC.transformation.opacity).to.equal(1);
        });

        it('should tween rotation correctly', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 180,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 2);
            expect(tweenC.transformation.x).to.equal(0);
            expect(tweenC.transformation.y).to.equal(0);
            expect(tweenC.transformation.scaleX).to.equal(1);
            expect(tweenC.transformation.scaleY).to.equal(1);
            expect(tweenC.transformation.rotation).to.equal(90);
            expect(tweenC.transformation.opacity).to.equal(1);
        });

        it('should tween rotation correctly (using no. of rotations param)', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 1,
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 180,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 2);
            expect(tweenC.transformation.x).to.equal(0);
            expect(tweenC.transformation.y).to.equal(0);
            expect(tweenC.transformation.scaleX).to.equal(1);
            expect(tweenC.transformation.scaleY).to.equal(1);
            // The lerp reaches 270 (0 -> 180 + 360*fullRotations, halfway), but tweenMethod
            // 'normal' round-trips through Transformation.toMatrixPaper/fromMatrix, and a
            // 2D matrix cannot tell 270 from -90 — atan2 only ever returns (-180, 180].
            // Asserting the literal 270 was therefore unsatisfiable by construction. What
            // is worth pinning is the ORIENTATION, and that assertion has teeth: before the
            // sign fix in Transformation.js:145 this came back +90, a different matrix and a
            // visibly wrong quarter turn. Each frame re-interpolates from the keys rather
            // than chaining, so nothing downstream needs the accumulated 270 as a number.
            const rotation = tweenC.transformation.rotation;
            expect(((rotation % 360) + 360) % 360).to.be.closeTo(270, 1e-9);
            expect(tweenC.transformation.opacity).to.equal(1);
        });

        it('should tween opacity correctly', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 0.0,
                }),
                fullRotations: 0,
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 2);
            expect(tweenC.transformation.x).to.equal(0);
            expect(tweenC.transformation.y).to.equal(0);
            expect(tweenC.transformation.scaleX).to.equal(1);
            expect(tweenC.transformation.scaleY).to.equal(1);
            expect(tweenC.transformation.rotation).to.equal(0);
            expect(tweenC.transformation.opacity).to.equal(0.5);
        });
    });

    describe('#interpolate (easingType = "in")', function () {
        it('should tween position correctly', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
                easingType: 'in',
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 100,
                    y: 200,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 2);

            expect(tweenC.transformation.x).to.equal(TWEEN.Easing.Quadratic.In(0.5) * 100);
            expect(tweenC.transformation.y).to.equal(TWEEN.Easing.Quadratic.In(0.5) * 200);
            expect(tweenC.transformation.scaleX).to.equal(1);
            expect(tweenC.transformation.scaleY).to.equal(1);
            expect(tweenC.transformation.rotation).to.equal(0);
            expect(tweenC.transformation.opacity).to.equal(1);
            expect(tweenC.fullRotations).to.equal(0);
        });
    });

    describe('#interpolate (easingType = "out")', function () {
        it('should tween position correctly', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
                easingType: 'out',
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 100,
                    y: 200,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 2);

            expect(tweenC.transformation.x).to.equal(TWEEN.Easing.Quadratic.Out(0.5) * 100);
            expect(tweenC.transformation.y).to.equal(TWEEN.Easing.Quadratic.Out(0.5) * 200);
            expect(tweenC.transformation.scaleX).to.equal(1);
            expect(tweenC.transformation.scaleY).to.equal(1);
            expect(tweenC.transformation.rotation).to.equal(0);
            expect(tweenC.transformation.opacity).to.equal(1);
            expect(tweenC.fullRotations).to.equal(0);
        });
    });

    describe('#interpolate (easingType = "in-out")', function () {
        it('should tween position correctly', function() {
            var tweenA = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 0,
                    y: 0,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
                easingType: 'in-out',
            });
            var tweenB = new Wick.Tween({
                playheadPosition: 3,
                transformation: new Wick.Transformation({
                    x: 100,
                    y: 200,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    opacity: 1.0,
                }),
                fullRotations: 0,
            });
            var tweenC = Wick.Tween.interpolate(tweenA, tweenB, 2);

            expect(tweenC.transformation.x).to.equal(TWEEN.Easing.Quadratic.InOut(0.5) * 100);
            expect(tweenC.transformation.y).to.equal(TWEEN.Easing.Quadratic.InOut(0.5) * 200);
            expect(tweenC.transformation.scaleX).to.equal(1);
            expect(tweenC.transformation.scaleY).to.equal(1);
            expect(tweenC.transformation.rotation).to.equal(0);
            expect(tweenC.transformation.opacity).to.equal(1);
            expect(tweenC.fullRotations).to.equal(0);
        });
    });

    describe('#applyTransformsToClip', function () {
        it('applyTransformsToClip should work correctly', function () {
            var tween = new Wick.Tween({
                playheadPosition: 1,
                transformation: new Wick.Transformation({
                    x: 100,
                    y: 150,
                    scaleX: 2,
                    scaleY: 0.5,
                    rotation: 180,
                    opacity: 0,
                }),
                fullRotations: 0,
            });
            var clip = new Wick.Clip();
            tween.applyTransformsToClip(clip);
            expect(clip.transformation).to.not.equal(tween.transformation);
            expect(clip.transformation.x).to.equal(tween.transformation.x);
            expect(clip.transformation.y).to.equal(tween.transformation.y);
            expect(clip.transformation.scaleX).to.equal(tween.transformation.scaleX);
            expect(clip.transformation.scaleY).to.equal(tween.transformation.scaleY);
            expect(clip.transformation.rotation).to.equal(tween.transformation.rotation);
            expect(clip.transformation.opacity).to.equal(tween.transformation.opacity);
        });
    });

    describe('#getNextTween', function () {
        it('should return the next tween in the frame', function () {
            var frame = new Wick.Frame({start: 10, end: 20});
            var tween1 = new Wick.Tween({playheadPosition: 1});
            var tween2 = new Wick.Tween({playheadPosition: 5});
            var tween3 = new Wick.Tween({playheadPosition: 9});
            frame.addTween(tween1);
            frame.addTween(tween2);
            frame.addTween(tween3);
            expect(tween1.getNextTween()).to.equal(tween2);
            expect(tween2.getNextTween()).to.equal(tween3);
            expect(tween3.getNextTween()).to.equal(null);
        });
    });
});
