import type { StoryState } from '../shared/types.js';
import { MAX_USED_NAMES } from './config.js';
import { TurnRng } from './rng.js';

const styleParts: Record<string, { a:string[]; b:string[]; c:string[] }> = {
  'Balanced Fantasy': { a:['Al','Bel','Cor','Da','El','Fen','Gar','Iri','Ka','Lor','Mar','Nor','Ori','Ra','Sel','Tor','Va'], b:['a','e','i','o','u','ae','ia','or','en','ir'], c:['n','r','s','th','nd','iel','an','is','or','en','a'] },
  Modern: { a:['Alex','Ben','Cam','Dani','Eli','Fran','Jordan','Kai','Leo','Maya','Nico','Riley','Sam','Tara','Vince'], b:['','','','','','','','','','','','','','',''], c:['','','','','','','','','','','','','','',''] },
  'Tolkienic / Lyrical': { a:['Aer','Cele','Elen','Fae','Gala','Luth','Mith','Nim','Oro','Sil','Tha','Vala'], b:['a','e','i','ie','io','ui','ae'], c:['riel','ndil','mir','las','wen','nor','thir','ion'] },
  Celtic: { a:['Ail','Bren','Cao','Dun','Eir','Fion','Gwen','Mae','Nia','Rhi','Tav'], b:['a','e','i','o'], c:['lan','wyn','ric','gan','eth','an','ra','n'] },
  'Norse / Old Germanic': { a:['Alf','Astr','Bjorn','Dag','Eir','Frey','Gud','Hald','Ing','Ragn','Sig','Tor'], b:['a','i','o','u'], c:['rik','mund','hild','sten','var','ulf','run','gard'] },
  'Persian / Byzantine': { a:['Ar','Bah','Dar','Far','Kas','Mehr','Nav','Rox','Sam','Yaz','Zar'], b:['a','e','i','o'], c:['ian','ad','ir','an','ara','esh','ous','zar'] },
  Slavic: { a:['Bog','Dar','Iva','Jar','Mila','Nad','Rad','Sla','Ves','Zor'], b:['a','e','i','o'], c:['mir','slav','vich','ana','ek','ov','ina','ko'] },
  'Classical / Romance': { a:['Aure','Cass','Domi','Flavi','Juli','Luci','Mar','Octa','Vale'], b:['a','e','i','o'], c:['nus','lia','rio','cius','na','tor','via','us'] },
  'Dark Low Fantasy': { a:['Ash','Bran','Crow','Dreg','Grim','Harrow','Morn','Rook','Sable','Varr','Wren'], b:['a','e','i','o'], c:['k','n','r','t','en','ard','ick','oss','a'] },
};

export function generateUniqueNames(state: StoryState, count: number, seed: string, style?: string): string[] {
  const chosen = styleParts[style || state.names.style] ?? styleParts['Balanced Fantasy']!;
  const used = new Set(state.names.used.map(n => n.toLowerCase()));
  const rng = new TurnRng(`${seed}|names|${style || state.names.style}`);
  const output: string[] = [];
  let attempts = 0;
  while (output.length < Math.max(0, Math.min(20, count)) && attempts < 300) {
    attempts++;
    const raw = `${rng.pick(chosen.a)}${rng.pick(chosen.b)}${rng.pick(chosen.c)}`.replace(/(.)\1\1+/g,'$1$1');
    const name = raw.charAt(0).toUpperCase() + raw.slice(1);
    const key = name.toLowerCase();
    if (name.length < 3 || used.has(key)) continue;
    used.add(key); output.push(name);
  }
  state.names.used = [...state.names.used, ...output].slice(-MAX_USED_NAMES);
  return output;
}
