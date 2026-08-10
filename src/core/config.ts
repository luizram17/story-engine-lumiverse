import type { StorySettings, Rank, ValueTier } from '../shared/types.js';

export const STATE_VERSION = 7;
export const STATE_CHAT_KEY = 'story_engine_state_v7';
export const LEGACY_STATE_CHAT_KEYS = ['story_engine_state_v6'] as const;
export const SETTINGS_GLOBAL_KEY = 'story_engine_settings_v4';
export const MAX_AUDITS = 64;
export const MAX_MEMORY_FACTS = 120;
export const MAX_USED_NAMES = 600;
export const MAX_NPCS = 120;
export const MAX_ACTIONS = 3;
export const MAX_COMMAND_AUDITS = 64;

export const PLAYER_STATS = ['PHY', 'MND', 'CHA'] as const;
export const PLAYER_STAT_POINTS = 15;
export const PLAYER_STAT_MIN = 1;
export const PLAYER_STAT_MAX = 9;
export const PROGRESSION_MAX_STAT = 10;
export const XP_MILESTONE = 100;

export const RACES = [
  'Aasimar','Angelkin','Arachne','Automaton','Bearkin','Catfolk','Centaur','Demon','Dhampir','Dragonkin','Dryad','Dwarf','Elf','Fae','Fairy','Foxkin','Gnome','Goblin','Half-Demon','Half-Elf','Half-Orc','Halfling','Harpy','Hobgoblin','Homunculus','Human','Hybrid','Kobold','Lamian','Lizardfolk','Merfolk','Minotaur','Mushroomfolk','Naga','Oni','Orc','Rabbitfolk','Revenant','Satyr','Slimekin','Spirit-Touched','Tiefling','Undead','Vampire','Werewolf','Wolfkin',
] as const;

export const GENRES = [
  'Fantasy','Sci-fi','Modern','Slice of Life','Isekai','Urban Fantasy','Cyberpunk','Post-Apocalyptic','Horror','Supernatural','Superhero','Steampunk','Historical','Wuxia / Xianxia',
] as const;

export const NAME_STYLES = [
  'Balanced Fantasy','Modern','Tolkienic / Lyrical','Celtic','Norse / Old Germanic','Persian / Byzantine','Slavic','Classical / Romance','Dark Low Fantasy',
] as const;

export const RANK_STATS: Record<Rank, { min: number; max: number; bonus: number }> = {
  Weak: { min: 1, max: 2, bonus: 0 },
  Average: { min: 2, max: 5, bonus: 1 },
  Trained: { min: 5, max: 8, bonus: 2 },
  Elite: { min: 8, max: 11, bonus: 3 },
  Boss: { min: 11, max: 14, bonus: 4 },
};

export const HP_RANGE_BY_RANK: Record<Rank, [number, number]> = {
  Weak: [3, 8], Average: [9, 15], Trained: [16, 25], Elite: [26, 40], Boss: [50, 70],
};

export const DAMAGE_BY_OUTCOME: Record<string, number> = {
  Success: 3, Minor_Success: 3, Moderate_Success: 6, Critical_Success: 9,
};
export const MAGIC_HEAL_BY_OUTCOME = { ...DAMAGE_BY_OUTCOME };
export const NATURAL_HEAL_BY_OUTCOME: Record<string, number> = {
  Success: 1, Minor_Success: 1, Moderate_Success: 2, Critical_Success: 3,
};

export const VALUE_TIERS: Array<{ name: ValueTier; min: number; max: number | null }> = [
  { name: 'trivial', min: 1, max: 5 },
  { name: 'cheap', min: 10, max: 25 },
  { name: 'standard', min: 50, max: 150 },
  { name: 'expensive', min: 300, max: 800 },
  { name: 'luxury', min: 1000, max: 3000 },
  { name: 'elite', min: 5000, max: null },
];

export const ECONOMY_PROFILES: Record<string, { currency: string; unit: string }> = {
  Fantasy: { currency: 'silver', unit: 'sv' },
  'Sci-fi': { currency: 'credits', unit: 'cr' },
  Modern: { currency: 'dollars', unit: '$' },
  'Slice of Life': { currency: 'dollars', unit: '$' },
  Isekai: { currency: 'silver', unit: 'sv' },
  'Urban Fantasy': { currency: 'dollars', unit: '$' },
  Cyberpunk: { currency: 'credits', unit: 'cr' },
  'Post-Apocalyptic': { currency: 'salvage scrip', unit: 'scrip' },
  Horror: { currency: 'dollars', unit: '$' },
  Supernatural: { currency: 'dollars', unit: '$' },
  Superhero: { currency: 'dollars', unit: '$' },
  Steampunk: { currency: 'crowns', unit: 'crn' },
  Historical: { currency: 'silver', unit: 'sv' },
  'Wuxia / Xianxia': { currency: 'spirit stones', unit: 'ss' },
};

export const DEFAULT_SETTINGS: StorySettings = {
  enabled: true,
  semanticEnabled: true,
  semanticConnectionId: '',
  personaConnectionId: '',
  commandConnectionId: '',
  bootstrapConnectionId: '',
  oocCommandsEnabled: true,
  autoBootstrapExistingChat: true,
  semanticTemperature: 0.1,
  recentMessageCount: 18,
  proseGuardMode: 'review',
  proseGuardConnectionId: '',
  proseGuardExtraPhrases: [],
  randomEvents: true,
  randomEventChance: 0.08,
  proactivity: true,
  powerActors: true,
  progression: true,
  trackerPostPass: true,
  showTrackerWidget: true,
  nameStyle: 'Balanced Fantasy',
  debug: false,
};
