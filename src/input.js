// Keyboard input, stamped with the beat each key was pressed on.

const Input = {
  init() {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (e.key.startsWith("Arrow") || e.key === " ") e.preventDefault();
      Clock.unlock(); // first key press also unlocks audio

      // [ and ] nudge the calibration offset everywhere.
      if (e.key === "[" || e.key === "]") {
        Clock.setInputOffset(Clock.inputOffsetMs + (e.key === "[" ? -5 : 5));
        return;
      }
      Scenes.current.onKey(e, Clock.beatOfEvent(e));
    });
    window.addEventListener("keyup", (e) => Scenes.current.onKeyUp?.(e));
    // Any click also unlocks audio. (Clicks on buttons/pages are handled by Pixi.)
    window.addEventListener("pointerdown", () => Clock.unlock());
  },
};
