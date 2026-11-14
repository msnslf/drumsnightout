// Plays DAW-exported MIDI clips half a bar at a time, at the game's tempo.

const MidiMusic = {
  clips: {}, // section -> [version] -> [layer { file, bars, byBar, info }]
  instruments: {}, // instrument key -> instrument (shared by all clips)
  missing: [], // files that couldn't be loaded
  needsServer: false, // true if loading failed because the page was opened from disk
  autoLanes: false, // play dance lane notes too (game over: nobody's playing them)

  async load() {
    const bust = location.protocol === "http:" ? `?t=${Date.now()}` : ""; // local server: always the latest export
    const fetchOne = async (f) => {
      const spec = typeof f === "string" ? { file: f } : f;
      try {
        return { spec, midi: await Midi.fromUrl(MUSIC.folder + spec.file + bust) };
      } catch {
        this.missing.push(spec.file);
      }
    };
    // Every file at once; layers are built afterwards in config order.
    const loaded = await Promise.all(Object.entries(MUSIC.clips).map(async ([section, rounds]) =>
      [section, await Promise.all(rounds.map((files) => Promise.all([].concat(files).map(fetchOne))))]));
    for (const [section, rounds] of loaded) {
      const versions = rounds.map((parts) => parts.filter(Boolean)).filter((parts) => parts.length).map((parts) => parts.map((p) => this._buildLayer(p)));
      if (versions.length) this.clips[section] = versions;
    }
    this.playerKit = INSTRUMENTS.drums(Mixer.in.drums); // own voices, so the player never collides with notes the music booked ahead
    this.needsServer = location.protocol === "file:" && this.missing.length > 0 && !Object.keys(this.clips).length;

    // Summary in the browser console (View > Developer > JavaScript Console).
    for (const [section, versions] of Object.entries(this.clips)) {
      versions.forEach((layers, v) => console.log(`♪ ${section}${v ? v + 1 : ""}: ` + layers.map((l) => `${l.file} (${l.bars} bar${l.bars > 1 ? "s" : ""}: ${l.info.join(", ") || "no notes"})`).join(" + ")));
    }
    if (this.missing.length) console.warn(`♪ not loaded (those sections will be silent): ${this.missing.join(", ")}`);
    if (this.needsServer) console.warn("♪ MIDI files can't be loaded from a page opened from disk. Run a local server (see README).");
  },

  // One parsed MIDI file -> a layer: notes grouped by bar, in beats.
  _buildLayer({ spec, midi }) {
    const bpb = CONFIG.BEATS_PER_BAR;
    const ppq = midi.header.ppq;
    const notes = [];
    const info = [];
    let lastStart = 0, endBeat = 0;
    for (const track of midi.tracks) {
      if (track.endOfTrackTicks) endBeat = Math.max(endBeat, track.endOfTrackTicks / ppq);
      if (!track.notes.length) continue;
      const key = this._instrumentKey(spec, track);
      const inst = this._instrument(key);
      const lanes = key === "drums" ? CONFIG.LANE_DRUMS : [];
      info.push(`${track.name ? `"${track.name}" ` : ""}→ ${key}`);
      for (const n of track.notes) {
        const beat = n.ticks / ppq;
        lastStart = Math.max(lastStart, beat);
        const lane = lanes.indexOf(n.midi);
        notes.push({ beat, durBeats: n.durationTicks / ppq, midi: n.midi, velocity: n.velocity, inst, lane: lane < 0 ? undefined : lane });
      }
      // CC events ride along with the notes, if the instrument handles them.
      const ccs = { ...track.controlChanges };
      for (const [num, value] of Object.entries(CC_DEFAULTS)) if (!ccs[num]?.length) ccs[num] = [{ ticks: 0, value }];
      for (const [num, events] of Object.entries(ccs)) {
        if (inst.cc?.[num]) for (const c of events) notes.push({ beat: c.ticks / ppq, cc: inst.cc[num], value: c.value });
      }
    }
    // Length: from config, else the DAW's clip end, else the last note.
    const bars = spec.bars || Math.max(1, Math.round(endBeat / bpb), Math.floor(lastStart / bpb) + 1);
    const byBar = Array.from({ length: bars }, () => []);
    for (const n of notes) {
      const bar = Math.floor(n.beat / bpb + 1e-6);
      if (bar < bars) byBar[bar].push({ ...n, offset: n.beat - bar * bpb });
    }
    return { file: spec.file, bars, byBar, info };
  },

  // Which instrument plays a track (order in GUIDE.md §8).
  _instrumentKey(spec, track) {
    if (spec.instrument) return spec.instrument;
    return instrumentForName(track.name) || instrumentForName(spec.file) || (track.channel === 9 ? "drums" : DEFAULT_INSTRUMENT);
  },

  _instrument(key) {
    if (!INSTRUMENTS[key]) {
      console.warn(`♪ no instrument "${key}" in instruments.js, using ${DEFAULT_INSTRUMENT}`);
      key = DEFAULT_INSTRUMENT;
    }
    if (!this.instruments[key]) {
      const inst = (this.instruments[key] = INSTRUMENTS[key](Mixer.in[key]));
      inst.cc = { ...inst.cc, 3: sendCC(key, "reverb") }; // every instrument's reverb send follows CC3
    }
    return this.instruments[key];
  },

  // Call between Clock.reset() and start(); a section name loops just that.
  start(onlySection) {
    this.autoLanes = false;
    // Half bars, since bowling may end on a 2/4 bar that moves the downbeat.
    Clock.transport.scheduleRepeat((time) => this._bar(time, onlySection), (CONFIG.BEATS_PER_BAR / 2) * Clock.transport.PPQ + "i", 0);
  },

  // Loops the intro once audio is allowed, unless music is already running.
  playIntro() {
    if (Clock.running || Clock.ctx.state !== "running" || !this.clips.intro) return;
    Clock.reset(CONFIG.BPM);
    this.start("intro");
    Clock.start();
  },

  // Notes of a section's bar in round `cycle`; versions cycle, layers go on.
  barNotes(section, cycle, bar) {
    const versions = this.clips[section];
    if (!versions) return [];
    const v = Math.max(0, cycle) % versions.length;
    for (let c = v; c < cycle; c += versions.length) bar += Math.ceil(Song.phaseBeats(section, c) / CONFIG.BEATS_PER_BAR); // a 2/4 bar counts as a bar
    return versions[v].flatMap((l) => l.byBar[bar % l.bars]);
  },

  // Plays a lane's drum (the player's hit) at audio time `time`.
  playLane(lane, time, velocity = 1) {
    this.playerKit.play(CONFIG.LANE_DRUMS[lane], 0.1, time, velocity);
  },

  _bar(time, onlySection) {
    const bpb = CONFIG.BEATS_PER_BAR;
    const beat = Math.round(Clock.beatAtTime(time)) + 1e-6;
    const phase = onlySection ? { name: onlySection, cycle: 0, startBeat: 0, endBeat: Infinity } : Song.phaseAt(beat);
    const into = Math.round(beat - phase.startBeat);
    const from = into % bpb; // 0: first half of the bar, bpb / 2: second half
    if (from % (bpb / 2)) return; // not a half-bar line of this phase
    if (phase.name === "toDance" && into === 0) Music.revCymbal(time, Clock.timeAfter(time, phase.endBeat - phase.startBeat)); // ends on the dance downbeat
    const room = phase.endBeat - beat; // a 2/4 bar drops the bar's second half
    const notes = this.barNotes(phase.name, phase.cycle, (into - from) / bpb);
    for (const note of notes) {
      if (phase.name === "dance" && !onlySection && !this.autoLanes && note.lane !== undefined) continue; // the player plays these (previews play them too)
      const offset = note.offset - from;
      if (offset < 0 || offset >= bpb / 2 || offset >= room) continue;
      const t = Clock.timeAfter(time, offset); // follows tempo ramps within the bar
      if (note.cc) note.cc(note.value, t);
      else note.inst.play(note.midi, Math.max(0.02, Clock.timeAfter(time, offset + note.durBeats) - t), t, note.velocity);
    }
  },
};
