import type { CurrencyEntry, GearTier, Rank, StoryState, ValueTier } from '../shared/types.js';
import { ECONOMY_PROFILES, VALUE_TIERS } from './config.js';
import { TurnRng } from './rng.js';

const rankLoot: Record<Rank, { equipmentTier:ValueTier; currencyTier:ValueTier; chance:number }> = {
  Weak:{equipmentTier:'cheap',currencyTier:'trivial',chance:0.40},
  Average:{equipmentTier:'standard',currencyTier:'cheap',chance:0.55},
  Trained:{equipmentTier:'expensive',currencyTier:'standard',chance:0.70},
  Elite:{equipmentTier:'luxury',currencyTier:'expensive',chance:0.85},
  Boss:{equipmentTier:'elite',currencyTier:'luxury',chance:1.0},
};

const defenseByTier: Record<ValueTier, number> = { trivial:0, cheap:0, standard:1, expensive:2, luxury:3, elite:4 };
const protectivePattern = /\b(?:armor|armour|mail|chainmail|chain\s+mail|ring\s+mail|scale\s+mail|plate|hauberk|cuirass|breastplate|brigandine|gambeson|lamellar|shield|buckler|helmet|helm|gauntlets?|bracers?|greaves?|ballistic\s+vest|bulletproof\s+vest|armou?red\s+vest|flak\s+(?:vest|jacket)|riot\s+(?:armor|armour|shield|gear)|combat\s+(?:armor|armour|suit)|power(?:ed)?\s+(?:armor|armour)|armou?red\s+(?:suit|exoskeleton)|protective\s+suit|hardsuit|exosuit)\b/i;
const disabledPattern = /\b(?:broken|destroyed|ruined|shattered|unusable)\b/i;

export function economyProfile(genre: string) {
  return ECONOMY_PROFILES[genre] ?? ECONOMY_PROFILES.Fantasy!;
}

export function valueRange(tier: ValueTier): [number, number] {
  const d = VALUE_TIERS.find(v => v.name === tier) ?? VALUE_TIERS[2]!;
  return [d.min, d.max ?? d.min * 3];
}

export function deterministicLoot(seed: string, rank: Rank, genre: string, targetKind: string) {
  const rng = new TurnRng(`${seed}|loot`);
  const profile = rankLoot[rank];
  const econ = economyProfile(genre);
  const [lo, hi] = valueRange(profile.currencyTier);
  const currencyAmount = targetKind === 'humanoid' && rng.chance(profile.chance) ? rng.int(lo, hi) : 0;
  const magicStone = targetKind === 'monster' ? { item:'magic stone', valueTier: profile.equipmentTier } : null;
  return {
    rank,
    equipmentTier: profile.equipmentTier,
    currencyTier: profile.currencyTier,
    currency: currencyAmount ? { currency: econ.currency, amount: currencyAmount } : null,
    magicStone,
    maxNewMundaneItems: targetKind === 'humanoid' ? 2 : 0,
  };
}

export function addCurrency(list: CurrencyEntry[], currency: string, delta: number): CurrencyEntry[] {
  const name = currency.trim();
  if (!name || !Number.isFinite(delta) || delta === 0) return list;
  const next = list.map(x => ({ ...x }));
  const found = next.find(x => x.currency.toLowerCase() === name.toLowerCase());
  if (found) found.amount = Math.max(0, found.amount + delta);
  else if (delta > 0) next.push({ currency: name, amount: delta });
  return next.filter(x => x.amount > 0);
}

export function applyTransaction(state: StoryState, tx: { kind:string; amount?:number; currency?:string; item?:string; target?:string } | undefined): string[] {
  if (!tx || tx.kind === 'none' || !state.player) return [];
  const notes: string[] = [];
  const econ = economyProfile(state.player.genre);
  const currency = (tx.currency || econ.currency).trim();
  const amount = Math.max(0, Math.floor(Number(tx.amount || 0)));
  if (tx.kind === 'quote' && amount > 0) {
    state.economy.pendingPrice = { amount, currency, item: tx.item, merchant: tx.target, turn: state.turn };
    notes.push(`Price remembered: ${amount} ${currency}${tx.item ? ` for ${tx.item}` : ''}.`);
  } else if (tx.kind === 'pay') {
    const pending = state.economy.pendingPrice;
    const spend = amount || pending?.amount || 0;
    const spendCurrency = tx.currency?.trim() || pending?.currency || econ.currency;
    if (spend > 0) {
      state.player.currency = addCurrency(state.player.currency, spendCurrency, -spend);
      notes.push(`Spent ${spend} ${spendCurrency}.`);
      state.economy.pendingPrice = null;
    }
  } else if (tx.kind === 'gain' && amount > 0) {
    state.player.currency = addCurrency(state.player.currency, currency, amount);
    notes.push(`Gained ${amount} ${currency}.`);
  } else if (tx.kind === 'lose' && amount > 0) {
    state.player.currency = addCurrency(state.player.currency, currency, -amount);
    notes.push(`Lost ${amount} ${currency}.`);
  }
  return notes;
}

export function tierFromAmount(amount: number): ValueTier {
  let found: ValueTier = 'trivial';
  for (const tier of VALUE_TIERS) {
    if (amount < tier.min) break;
    found = tier.name;
  }
  return found;
}

export function equipmentDefenseBonus(tier: ValueTier): number { return defenseByTier[tier] ?? 0; }
export function isProtectiveEquipment(item: string): boolean { return protectivePattern.test(item) && !disabledPattern.test(item); }

export function normalizeEquipmentTiers(assignments: GearTier[], owned: string[]): GearTier[] {
  const byKey=new Map((assignments||[]).map(x=>[x.item.trim().toLowerCase(),x.tier]));
  return owned.map(item=>({item,tier:byKey.get(item.trim().toLowerCase())||'standard'}));
}

export function resolvePlayerEquipmentDefense(state: StoryState): { item:string; tier:ValueTier; bonus:number } | null {
  if(!state.player) return null;
  const tiers=normalizeEquipmentTiers(state.economy.equipmentTiers,state.player.gear);
  const candidates=tiers.filter(x=>isProtectiveEquipment(x.item)).map(x=>({...x,bonus:equipmentDefenseBonus(x.tier)})).sort((a,b)=>b.bonus-a.bonus);
  return candidates[0] ?? null;
}
