export type StatKey = 'PHY' | 'MND' | 'CHA';
export type Rank = 'Weak' | 'Average' | 'Trained' | 'Elite' | 'Boss';
export type CapabilityPool = 'common' | 'trained' | 'elite' | 'boss';
export type ChallengeType = 'none' | 'social' | 'mundane_combat' | 'supernatural_combat' | 'restraint' | 'stealth' | 'environment';
export type OutcomeTier = 'No_Roll' | 'Critical_Success' | 'Moderate_Success' | 'Minor_Success' | 'Success' | 'Stalemate' | 'Failure' | 'Minor_Failure' | 'Moderate_Failure' | 'Critical_Failure';
export type ProseGuardMode = 'off' | 'review' | 'automatic';
export type TimeSlot = 'morning' | 'afternoon' | 'evening' | 'night';
export type Weather = 'clear' | 'partly_cloudy' | 'cloudy' | 'overcast' | 'light_rain' | 'heavy_rain' | 'storm';
export type RomanceStage = 'none' | 'interest' | 'dating' | 'partner';

export interface PlayerSheet {
  name: string;
  race: string;
  genre: string;
  age?: number;
  appearance: string;
  stats: Record<StatKey, number>;
  naturalWeapons: string[];
  abilities: string[];
  spells: string[];
  inventory: string[];
  currency: CurrencyEntry[];
  gear: string[];
  anchors: string[];
  concept?: string;
  backstory?: string;
}

export interface CurrencyEntry { currency: string; amount: number; }
export interface GearTier { item: string; tier: ValueTier; }
export type ValueTier = 'trivial' | 'cheap' | 'standard' | 'expensive' | 'luxury' | 'elite';

export interface HealthActor {
  maxHp: number;
  currentHp: number;
  dead: boolean;
  nonlethalDefeat: boolean;
  lastDamageAt?: number;
}
export interface HealthState {
  user: HealthActor;
  npcs: Record<string, HealthActor>;
}

export interface BoundaryState {
  id: string;
  kind: string;
  setTurn: number;
  lastPressuredTurn: number;
  pressureCount: number;
  active: boolean;
}

export interface NpcTrackerEntry {
  name: string;
  role: string;
  rank: Rank;
  stats: Record<StatKey, number>;
  bond: number;
  fear: number;
  hostility: number;
  disposition: string;
  status: 'active' | 'inactive' | 'dead';
  companion: boolean;
  powerActor: boolean;
  romanceStage: RomanceStage;
  intimacy: number;
  boundary: BoundaryState | null;
  lastSocialTactic?: string;
  lastSocialGoal?: string;
  notes: string[];
  gear: string[];
  currency: CurrencyEntry[];
  introducedTurn: number;
  lastSeenTurn: number;
  lootSearchCompleted: boolean;
  personalityArchetype?: string;
  personalitySummary?: string;
  relationshipDescriptors: string[];
}


export interface WorldState {
  location: string;
  area: string;
  indoors: boolean;
  dayIndex: number;
  time: TimeSlot;
  weather: Weather;
  facts: MemoryFact[];
  plans: WorldPlan[];
}
export interface MemoryFact {
  id: string;
  fact: string;
  scope: 'scene' | 'location' | 'world' | 'user' | 'npc';
  subject?: string;
  salience: number;
  createdTurn: number;
  lastConfirmedTurn: number;
}
export interface WorldPlan {
  id: string;
  actor: string;
  intent: string;
  dueTurn: number;
  status: 'pending' | 'due' | 'completed' | 'cancelled';
}
export interface ReputationEntry { location: string; fame: number; infamy: number; fear: number; notes: string[]; }


export type KnowledgeScope = 'private' | 'local' | 'route' | 'faction' | 'regional' | 'legendary';
export type KnowledgeTruth = 'true' | 'distorted' | 'false' | 'claimed';
export type KnowledgeConfidence = 'certain' | 'likely' | 'uncertain';

export interface UserKnowledgeEntry {
  id: string;
  subject: string;
  fact: string;
  scope: KnowledgeScope;
  truth: KnowledgeTruth;
  confidence: KnowledgeConfidence;
  source?: string;
  learnedTurn: number;
  lastConfirmedTurn: number;
}

export interface LatentRelationshipThread {
  id: string;
  actor: string;
  kind: 'favor' | 'grievance';
  magnitude: 1 | 2 | 3;
  reason: string;
  createdTurn: number;
  status: 'active' | 'consumed' | 'archived';
}

export interface DescriptiveArchiveEntry {
  id: string;
  label: string;
  kind: 'npc' | 'place' | 'organization' | 'object' | 'other';
  description: string;
  promotedName?: string;
  firstSeenTurn: number;
  lastSeenTurn: number;
}

export interface BoundCompanionState {
  active: boolean;
  name: string;
  sinceTurn: number;
  lastMeaningfulTurn: number;
  notes: string[];
}

export interface PendingBoundaryState {
  active: boolean;
  boundaryId: string;
  targetNpc: string;
  type: string;
  warnings: number;
  threshold: number;
  setTurn: number;
  lastTurn: number;
}

export interface RapportClockState {
  lastInteractionAt: number;
  lastMeaningfulAt: number;
  cooldownUntil: number;
  partnerMeaningfulUntil: number;
}

export interface WorldArc {
  id: string;
  actor: string;
  goal: string;
  stage: number;
  pressure: number;
  lastAdvancedTurn: number;
  status: 'active' | 'completed' | 'cancelled';
}

export interface ContinuityState {
  latentFavors: LatentRelationshipThread[];
  latentGrievances: LatentRelationshipThread[];
  userKnowledge: UserKnowledgeEntry[];
  descriptiveArchive: DescriptiveArchiveEntry[];
  boundCompanion: BoundCompanionState;
  pendingBoundary: PendingBoundaryState;
  rapportClocks: Record<string, RapportClockState>;
  worldArcs: WorldArc[];
}

export interface ProgressionState {
  xp: number;
  level: number;
  milestonesClaimed: number;
  pendingMilestones: number;
  history: Array<{ turn: number; amount: number; reason: string }>;
}

export interface EconomyState {
  pendingPrice?: { amount: number; currency: string; item?: string; merchant?: string; turn: number } | null;
  equipmentTiers: GearTier[];
}

export interface NameState { used: string[]; style: string; }

export interface StorySettings {
  enabled: boolean;
  semanticEnabled: boolean;
  semanticConnectionId: string;
  personaConnectionId: string;
  commandConnectionId: string;
  bootstrapConnectionId: string;
  oocCommandsEnabled: boolean;
  autoBootstrapExistingChat: boolean;
  semanticTemperature: number;
  recentMessageCount: number;
  proseGuardMode: ProseGuardMode;
  proseGuardConnectionId: string;
  proseGuardExtraPhrases: string[];
  randomEvents: boolean;
  randomEventChance: number;
  proactivity: boolean;
  powerActors: boolean;
  progression: boolean;
  trackerPostPass: boolean;
  showTrackerWidget: boolean;
  nameStyle: string;
  debug: boolean;
}

export interface SemanticAction {
  label: string;
  kind: 'attack' | 'social' | 'stealth' | 'environment' | 'restraint' | 'heal' | 'loot' | 'transaction' | 'other';
  target: string;
  challengeType: ChallengeType;
  rollNeeded: boolean;
  stat: StatKey | 'NONE';
  targetStat?: StatKey | 'NONE';
  difficulty: 1 | 2 | 3 | 4 | 5;
  actionLength: 1 | 2 | 3;
  harmful: boolean;
  harmMode: 'none' | 'lethal' | 'nonlethal' | 'restraint_control';
  supernatural: boolean;
  healingMagic: boolean;
  abilityUse?: string;
  itemUse?: string;
  socialTactic?: 'diplomacy' | 'bluff' | 'intimidate' | 'none';
  socialGoal?: string;
}

export interface SemanticActor {
  name: string;
  role: string;
  rank: Rank;
  capabilityPool?: CapabilityPool;
  mainStat?: StatKey | 'Balanced';
  relation: 'direct' | 'opposed' | 'benefited' | 'harmed' | 'observer' | 'neutral';
  powerActor: boolean;
  companion: boolean;
  initialBond?: number;
  initialFear?: number;
  initialHostility?: number;
  initialRomanceStage?: RomanceStage;
  initialIntimacy?: number;
  personalityArchetype?: string;
  personalitySummary?: string;
  initialNotes?: string[];
  relationshipContext?: string;
  initialRelationshipDescriptors?: string[];
  evidence?: string;
}

export interface SemanticLedger {
  summary: string;
  actions: SemanticAction[];
  actors: SemanticActor[];
  explicitIntimidationOrCoercion: boolean;
  intimacyAdvanceExplicit: boolean;
  boundaryPressure?: { present: boolean; target: string; kind: string };
  restraintControl?: { present: boolean; target: string; evidence?: string };
  boundaryBreak?: { present: boolean; boundaryId: string; target: string; kind: string; response?: string; evidence?: string };
  claimCheck?: { present: boolean; target: string; claim: string; truth: 'true'|'false'|'uncertain'|'claimed'; access: 'knows_true'|'knows_false'|'can_verify'|'cannot_verify'|'unknown'; stakesImpact: boolean };
  activeHostileThreat?: boolean;
  scene: {
    location?: string;
    area?: string;
    indoors?: boolean;
    timeAdvance?: 0 | 1 | 2 | 3 | 4;
    weather?: Weather | '';
    publicWitnesses: boolean;
    danger: 'calm' | 'active' | 'crisis';
  };
  transaction?: { kind: 'none' | 'quote' | 'pay' | 'gain' | 'lose'; amount?: number; currency?: string; item?: string; target?: string };
  loot?: { present: boolean; target: string; targetKind: 'humanoid' | 'monster' | 'container' | 'other'; rank: Rank };
  memoryFacts: Array<{ fact: string; scope: MemoryFact['scope']; subject?: string; salience?: number }>;
  namesNeeded: Array<{ kind: 'npc' | 'place' | 'organization'; hint: string }>;
  powerActorSignals: Array<{ actor: string; signal: 'notice' | 'favor' | 'grievance' | 'threat' | 'opportunity'; magnitude: 1 | 2 | 3 }>;
}

export interface RollResult {
  actionIndex: number;
  label: string;
  challengeType: ChallengeType;
  userDie: number;
  userStat: number;
  userTotal: number;
  oppositionDie: number;
  oppositionStat: number;
  oppositionTotal: number;
  margin: number;
  outcomeTier: OutcomeTier;
  outcome: string;
  landedActions: number;
  counterPotential: 'none' | 'light' | 'medium' | 'severe';
  target: string;
}

export interface AggressionResult {
  npc: string;
  label: string;
  npcDie: number;
  npcStat: number;
  npcTotal: number;
  userDie: number;
  userStat: number;
  defenseBonus: number;
  userTotal: number;
  margin: number;
  outcome: 'npc_overpowers' | 'npc_succeeds' | 'stalemate' | 'npc_fails';
  damage: number;
  source: 'forced_counter' | 'proactivity';
}

export interface ProactivityResult {
  npc: string;
  proactive: boolean;
  tier: 'DORMANT' | 'LOW' | 'MEDIUM' | 'HIGH' | 'FORCED';
  die: number;
  threshold: number;
  intent: string;
  target: string;
}

export interface RandomEventResult { triggered: boolean; die: number; kind: 'none' | 'hostile' | 'complication' | 'interruption' | 'beneficial'; magnitude: 'minor' | 'moderate' | 'major'; anchor: string; }

export interface TurnResolution {
  turnId: string;
  turn: number;
  fingerprint: string;
  semantic: SemanticLedger;
  rolls: RollResult[];
  aggression: AggressionResult[];
  proactivity: ProactivityResult[];
  randomEvent: RandomEventResult;
  generatedNames: string[];
  healthEvents: Array<{ targetType: 'user' | 'npc'; target: string; kind: 'damage' | 'heal'; amount: number; nonlethal?: boolean; fatal?: boolean }>;
  refereeNotes: string[];
  xpAward: number;
  handoff: string;
  createdAt: number;
  replay?: boolean;
  lootResult?: { target?: string; status?: 'ok'|'unknown_target'|'target_not_dead'|'already_searched'|'not_applicable'; currency?: CurrencyEntry | null; magicStone?: { item:string; valueTier:ValueTier } | null; equipmentTier?: ValueTier; maxNewMundaneItems?: number } | null;
}

export interface ProseFinding { phrase: string; index: number; excerpt: string; category: string; }

export interface TurnAudit {
  turn: number;
  turnId: string;
  fingerprint: string;
  createdAt: number;
  finalizedAt?: number;
  generationId?: string;
  messageId?: string;
  summary: string;
  rolls: RollResult[];
  xpAward: number;
  proseFindings?: ProseFinding[];
  notes: string[];
}


export interface BootstrapState {
  status: 'none' | 'importing' | 'ready' | 'failed';
  sourceMessageCount: number;
  importedAt?: number;
  lastMessageId?: string;
  error?: string;
}

export interface CommandAudit {
  fingerprint: string;
  createdAt: number;
  commands: string[];
  summary: string;
  operations: Array<{ op:string; path:Array<string|number>; value?:unknown }>;
}

export interface StoryState {
  version: number;
  turn: number;
  player: PlayerSheet | null;
  npcs: Record<string, NpcTrackerEntry>;
  health: HealthState;
  world: WorldState;
  reputation: ReputationEntry[];
  progression: ProgressionState;
  economy: EconomyState;
  names: NameState;
  continuity: ContinuityState;
  bootstrap: BootstrapState;
  commandHistory: CommandAudit[];
  pending: TurnResolution | null;
  lastResolution: TurnResolution | null;
  audits: TurnAudit[];
  proseReview: { messageId: string; content: string; findings: ProseFinding[]; suggested?: string } | null;
  rollback: { fingerprint: string; base: unknown } | null;
  updatedAt: number;
}
