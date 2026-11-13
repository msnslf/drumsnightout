// Keyboard and touch input, stamped with the beat each key or tap happened on.

const Input = {
  init() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
      Clock.unlock(); // first key press also unlocks audio

      // [ and ] nudge the calibration offset everywhere.
      if (e.key === "[" || e.key === "]") {
        Settings.inputOffsetMs += e.key === "[" ? -5 : 5;
        return;
      }
      Scenes.current.onKey(e, Clock.beatOfEvent(e));
    });
    window.addEventListener("keyup", (e) => Scenes.current.onKeyUp?.(e));
    // Any click also unlocks audio. (Clicks on buttons/pages are handled by Pixi.)
    window.addEventListener("pointerdown", () => Clock.unlock());
    if (Settings.touch) this._initTouch();
  },

  // Taps go to onTap(e, stage point, beat); lifts to onTapUp(e). Pixi still handles buttons and menus.
  _initTouch() {
    window.addEventListener("touchend", () => Clock.unlock()); // iOS only unlocks audio on touchend
    window.addEventListener("pointerdown", (e) => {
      const r = Scenes.app.canvas.getBoundingClientRect();
      const p = Scenes.stage.toLocal({ x: e.clientX - r.left, y: e.clientY - r.top });
      Scenes.current.onTap?.(e, p, Clock.beatOfEvent(e));
    });
    for (const type of ["pointerup", "pointercancel"]) window.addEventListener(type, (e) => Scenes.current.onTapUp?.(e));
    document.addEventListener("visibilitychange", () => document.hidden && Scenes.current.onHide?.());
  },
};
