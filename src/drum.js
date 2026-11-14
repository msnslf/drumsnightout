
const POSE_FRAME_COUNT = 4;

const POSES = ["pose1", "pose2", "pose3"];

class Drum {
  constructor(index) {
    this.index = index;

    this.view = new PIXI.Container();
    this.spinner = new PIXI.Container(); // rotates around the drum's centre
    this.body = new PIXI.Container();
    this.view.addChild(this.spinner);
    this.spinner.addChild(this.body);

    this.sprite = null;
    this.sheet = null;

    this.stick = new DrumStick(index);
    this.view.addChild(this.stick.gfx);

    this.reset();
  }

  reset() {
    this.squishLevel = 0;
    this.misses = 0;

    // Start in pose 1.
    this.currentPose = 1;

    this.spinBeat = -Infinity;

    this.stick.reset();
  }

  get isPancake() {
    return this.squishLevel >= CONFIG.SQUISHES_TO_PANCAKE;
  }

  useSpritesheet(sheet) {
    this.sheet = sheet;

    // Validate all three pose animations.
    for (const name of POSES) {
      const frames = sheet.animations[name];

      if (!frames?.length) {
        throw new Error(
          `Spritesheet is missing the "${name}" animation.`
        );
      }

      if (frames.length !== POSE_FRAME_COUNT) {
        throw new Error(
          `"${name}" must contain exactly ${POSE_FRAME_COUNT} frames.`
        );
      }
    }

    this.sprite = new PIXI.Sprite(
      sheet.animations.pose1[0]
    );

    this.sprite.anchor.set(0.5, 1);

    this.body.addChild(this.sprite);
  }

  // Successful hit: advance to the next pose, at the same point in the beat.
  dance() {
    this.currentPose = (this.currentPose % 3) + 1;
  }

  // One full turn over one beat, starting at `beat`.
  spin(beat) {
    this.spinBeat = beat;
  }

  // A missed note. Returns true if this miss summoned the drum stick.
  miss(beat) {
    this.misses++;

    if (this.misses >= this.missesPerSquish) {
      this.misses = 0;

      this.stick.strike(beat, () => {
        this.squishLevel++;
      });
      this.onStick?.(this.squishLevel + 1, this.stick.landBeat); // squish level it will land at

      return true;
    }

    return false;
  }

  // animRate scales the pose loop; change it only on even beats.
  update(beat, animRate = 1) {
    const pressed = this.stick.pressing(beat);

    const beatFrac = beat - Math.floor(beat);

    // Persistent squash level + temporary squash during impact.
    const level = Math.min(
      this.squishLevel,
      CONFIG.SQUISHES_TO_PANCAKE
    );

    const flat = level / CONFIG.SQUISHES_TO_PANCAKE;

    let sy = 1 - 0.75 * flat;
    let sx = 1 + 0.6 * flat;

    if (pressed) {
      sy *= 0.6;
      sx *= 1.2;
    }

    // Bounce on every beat.
    const bounce = this.isPancake
      ? 0
      : Math.sin(Math.PI * beatFrac) * 6;

    this.body.scale.set(sx, sy);
    this.body.y = -bounce;

    const spinT = beat - this.spinBeat;
    const mid = ((this.sprite?.texture.height ?? 96) / 2) * sy;
    this.spinner.pivot.y = this.spinner.y = -mid;
    this.spinner.rotation = spinT >= 0 && spinT < 1 ? spinT * 2 * Math.PI : 0;

    this.stick.update(beat, -96 * sy - bounce);

    // SPRITESHEET ANIMATION
    if (this.sprite) {
      const poseName = `pose${this.currentPose}`;
      const frames = this.sheet.animations[poseName];

      const phase = beat * animRate - Math.floor(beat * animRate);

      const frameIndex = Math.min(
        POSE_FRAME_COUNT - 1,
        Math.floor(phase * POSE_FRAME_COUNT)
      );

      this.sprite.texture = frames[frameIndex];
    }
  }

  
}


// The stick god's drumstick: falls 0.5 beat onto the beat, holds, lifts.

class DrumStick {
  constructor(drumIndex) {
    this.drumIndex = drumIndex;
    this.gfx = new PIXI.Graphics();

    const ink = CONFIG.INK;
    const paper = CONFIG.PAPER;

    // Drawn with its tip at (0, 0), pointing down.
    this.gfx.roundRect(-22, -620, 44, 600, 18)
      .fill(paper)
      .stroke({ width: 5, color: ink });

    this.gfx.ellipse(0, -20, 30, 24)
      .fill(paper)
      .stroke({ width: 5, color: ink });
    this.gfx.rotation = 0.15;

    this.reset();
  }

  reset() {
    this.landBeat = -Infinity;
    this.onLand = null;
    this.gfx.visible = false;
  }

  strike(beat, onLand) {
    this.landBeat = Math.ceil(beat + 0.5);
    this.onLand = onLand;

    Clock.atBeat(this.landBeat, (time) => Music.squish(time, this.drumIndex));
  }

  pressing(beat) {
    return beat >= this.landBeat && beat < this.landBeat + 0.5;
  }

  update(beat, landY) {
    const t = beat - (this.landBeat - 0.5);

    if (t < 0 || t > 2) {
      this.gfx.visible = false;
      return;
    }

    if (this.onLand && beat >= this.landBeat) {
      const cb = this.onLand;
      this.onLand = null;
      cb();
    }

    this.gfx.visible = true;

    let y;

    const rest = landY - 4;

    if (t < 0.5) {
      y = lerp(-800, rest, (t / 0.5) ** 2);
    } else if (t < 1) {
      y = rest;
    } else {
      y = lerp(rest, -800, ease((t - 1) / 1));
    }

    this.gfx.y = y;
  }
}
