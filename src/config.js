// All tunable numbers.

const CONFIG = {
  // Virtual screen size; everything is laid out in these units, then scaled.
  WIDTH: 1280,
  HEIGHT: 720,

  // --- Music / song form ---
  BPM: 99, // default starting tempo
  END_BPM: 20, END_BPM_PER_SEC: 10, // game over: slow to END_BPM at this rate, fading over the last bar
  START_BPM_MIN: 80, START_BPM_MAX: 160, // starting tempo range in settings
  BEATS_PER_BAR: 4,
  COUNTOFF_BARS: 2, // count-off before the first dance segment: READY bar, then 1 2 3 4
  // One "cycle" of the game, in bars. Order matters.
  PHASES: [
    { name: "dance", bars: 8 },
    { name: "toBowl", bars: 1.5 },
    { name: "bowl", bars: 1 }, // loops
    { name: "toDance", bars: 2 },
  ],

  // --- Sync calibration ---
  // ms added to every key press; set by calibration or nudged with [ and ]
  INPUT_OFFSET_MS: 0,

  // --- Difficulty: timing window either side of the note (ms), misses per stick hit ---
  DIFFICULTIES: [
    { name: "EASY", windowMs: 130, missesPerSquish: 4 },
    { name: "NORMAL", windowMs: 90, missesPerSquish: 3 },
    { name: "HARD", windowMs: 55, missesPerSquish: 3 },
  ],
  // From these dance rounds on, at most this many misses summon the stick; at 1 the miss bars go.
  MISSES_FROM_ROUND: [{ round: 4, misses: 2 }, { round: 7, misses: 1 }],

  // --- Dancing ---
  // Default key per lane, left to right; players rebind them in settings.
  LANE_KEYS: ["d", "f", "j", "k"],
  LANE_DRUMS: [41, 36, 38, 45], // MIDI note per dance lane: low tom, kick, snare, high tom
  PATTERN_LOOKAHEAD_BEATS: 10, // beats a letter takes from the top of the lane to the hit line
  HIT_CUE_SCALE: 3, // hit cue size at the hit line
  JUDGE_HOLD_BEATS: 2, // how long judgement text stays up...
  JUDGE_SHORT_BEATS: 0.5, // ...or this long, when the lane's next note is 1 beat or less away
  // Judgement words, one picked at random each time.
  JUDGE_WORDS: {
    miss: ["miss", "oof", "nope", "dang", "geez", "ahh", "ooh", "soup", "zzz", "...", "wut", "why", "za", ":(", "x_x", "sith", "%$&*", "fi", "sus", "rabbit", "dog", "tree", "over it", "hazy", "purple", "salt on the wound", "whee", "qwerty", "quarrelsome", "lofi", "compostable", "matte", "ah chips", "need ice cream", "quagmire", "rocked", "trippy", "bracing", "avatar", "jam", "squid", "needs to thaw", "a long walk uphill", "sun is still shining", "dubious", "cloudy", "murky", "ill", "go to sleep"],
    good: ["good", "cool", "ok", "neat", "nice", "fine", "food", "crust", "bread", "done", "did it", "did that", "fly", "car", "truck", "boop", "flower", ":)", "interesting", "good enough", "sutible", "potato", "lucky", "egg", "candy", "hyper pop", "so 90's", "millenial", "futuristic", "1080p", "recyclable", "metallic", "grunge", "vinegar", "apple orchard", "happy", "industrial", "rocknroll", "root beer", "happy holidays", "Q3 earnings", "viable", "value", "valiant", "rest easy", "boot", "cat", "organic", "illustrious", "elaborate", "expressive", "grass", "green", "proven", "pants"
    ],
    perfect: ["wow", "perfect", "great", "dope", "nails", "lit", "tight", "drums", "pro", "coffee", "encore", "boom", "roasted", "4K", "elemental", "<3", "$$$$$", "slick", "sick as", "subtle", "sublime", "super", "upgrade-worhty", "powerful", "fancy", "fortunate", "quintessential", "renewable", "solar", "galactic", "shiny", "grapeseed oil", "true north", "omniscient", "adorbs", "v tight", "surfs up", "virtue", "driving", "supercalifragilistic", "existential", "decadent", "clutch", "work'n it", "wowzers", "woo", "oh yeah", "pocket" 
    ],
  },
  SQUISHES_TO_PANCAKE: 3, // TBD
  DUCK_DB_PER_ROUND: 2, // dance sidechain gets this much deeper each round (from MIX.nodrums.duck)
  SQUISH_TEMPO_LEVEL: 2, SQUISH_TEMPO_BPM: 5, // a stick hit reaching this squish level adds this much tempo

  // --- Bowling ---
  BOWL_HINT_WORDS: ["bowl", "with", "any", "key"], // round 1 only: one per lane, one per beat, on the second bowling bar
  BOWL_HINT_WORDS_TOUCH: ["bowl", "with", "a", "tap"],
  AIM_PERIOD_BEATS: 4, // one full back-and-forth of the aim arrow
  AIM_MAX_ANGLE: 0.6, // radians
  AIM_DIVERGENCE_PER_ROUND: 0.18, // radians of phase offset added between lanes each round
  ROLL_BEATS: 2, // ball always takes exactly this long to reach the end of the lane
  BALL_SIZES: [0.35, 0.25, 0.15, 0.05, 0.01], // ball radius per round, as a fraction of lane width; the last repeats
  BPM_PER_STANDING_PIN: 0.4, // round 1; grows by BPM_PER_PIN_PER_ROUND each bowling round
  BPM_PER_PIN_PER_ROUND: 0.1,

  // --- Look ---
  INK: 0x000000,
  PAPER: 0xffffff,
  DANGER: 0xe02020, // hit circle of a drum one squish from pancake
  FONT: "'Tahoma', 'Chalkboard SE', 'Comic Neue', sans-serif",
};

// MIDI clips per section: file, [files] or { file, instrument, bars }.
const MUSIC = {
  folder: "assets/music/",
  clips: {
    intro: ["intro-drums.mid", "intro-perc.mid", "intro-bass.mid", "intro-chords.mid", "intro-melody.mid"], // title screen and calibration
   
    countoff: "countoff.mid", // the count-off bars before the first dance
    dance: ["dance-bass.mid", "dance-chords.mid", "dance-drums.mid", "dance-melody.mid", "dance-perc.mid"],
    toBowl: ["toBowl-bass.mid", "toBowl-chords.mid", "toBowl-drums.mid", "toBowl-melody.mid", "toBowl-perc.mid"],
    bowl: ["bowl-bass.mid", "bowl-chords.mid", "bowl-drums.mid", "bowl-melody.mid", "bowl-perc.mid"],
    toDance: ["toDance-drums.mid", "toDance-melody.mid", "toDance-perc.mid"],
  },
};
CONFIG.MUSIC = MUSIC;
