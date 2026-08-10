import type { ProseFinding } from '../shared/types.js';

const baseRules:Array<{ phrase:RegExp; label:string }> = [
  {phrase:/\bbarely above (?:a )?(?:whisper|breath)\b/gi,label:'stock whisper phrasing'},
  {phrase:/\bthe air (?:seemed to )?(?:thicken|shift|change)\b/gi,label:'atmosphere shorthand'},
  {phrase:/\bfor a moment[, ]/gi,label:'generic beat'},
  {phrase:/\ba mix of [^.!?]{1,60} and [^.!?]{1,60}/gi,label:'abstract emotion bundle'},
  {phrase:/\bsomething (?:in|about) (?:his|her|their|the)\b/gi,label:'vague attribution'},
  {phrase:/\bnot [^.!?]{1,45}, but [^.!?]{1,45}/gi,label:'rhetorical negation'},
  {phrase:/\bit wasn't [^.!?]{1,45};? it was\b/gi,label:'rhetorical contrast'},
  {phrase:/\beyes? (?:darkened|softened|hardened|flashed)\b/gi,label:'stock eye shorthand'},
  {phrase:/\ba beat (?:passed|of silence)\b/gi,label:'stock pause'},
  {phrase:/\bthe weight of (?:the|his|her|their)\b/gi,label:'abstract weight metaphor'},
  {phrase:/\bvoice (?:low|soft|quiet),? but\b/gi,label:'stock voice contrast'},
];

export interface ProseRepairCase { id:string; start:number; end:number; sentence:string; findings:Array<{category:string;phrase:string}>; }

export function collectProseFindings(text:string,extraPhrases:string[]=[]):ProseFinding[]{
  const rules=[...baseRules,...extraPhrases.filter(Boolean).map(p=>({phrase:new RegExp(escapeRegExp(p),'gi'),label:'user-banned phrase'}))];
  const findings:ProseFinding[]=[];
  for(const rule of rules){
    rule.phrase.lastIndex=0; let m:RegExpExecArray|null;
    while((m=rule.phrase.exec(text))){
      findings.push({phrase:m[0],index:m.index,excerpt:text.slice(Math.max(0,m.index-55),Math.min(text.length,m.index+m[0].length+55)),category:rule.label});
      if(m[0].length===0) rule.phrase.lastIndex++;
    }
  }
  return findings.sort((a,b)=>a.index-b.index).slice(0,100);
}

/**
 * Convert findings into unique sentence-local repair cases. This keeps Prose Guard
 * snapshot-safe: the model never receives authority to rewrite unaffected prose.
 */
export function buildProseRepairCases(content:string,findings:ProseFinding[],limit=24):ProseRepairCase[]{
  const spans=sentenceSpans(content);
  const grouped=new Map<string,ProseRepairCase>();
  for(const finding of findings){
    const pos=Math.max(0,Math.floor(Number(finding.index||0)));
    const span=spans.find(s=>pos>=s.start&&pos<s.end) ?? spans.find(s=>pos>=s.start&&pos<=s.end);
    if(!span)continue;
    const key=`${span.start}:${span.end}`;
    let item=grouped.get(key);
    if(!item){item={id:`PG${grouped.size+1}`,start:span.start,end:span.end,sentence:content.slice(span.start,span.end),findings:[]};grouped.set(key,item);}
    if(!item.findings.some(x=>x.category===finding.category&&x.phrase.toLowerCase()===finding.phrase.toLowerCase()))item.findings.push({category:finding.category,phrase:finding.phrase});
  }
  return [...grouped.values()].slice(0,Math.max(0,limit));
}

export function proseRepairPrompt(content:string,findings:ProseFinding[]):string{
  const cases=buildProseRepairCases(content,findings);
  return `You are Story Engine's sentence-local Prose Guard repair assistant. Repair ONLY the listed sentence cases. Preserve facts, dialogue meaning, chronology, POV, character behavior, player agency, tense, and voice. Do not add events, motives, lore, actions, consequences, sensory facts, or new dialogue. Do not delete a sentence. Return a structured tool call only.\n\n${cases.map(c=>`${c.id}\nORIGINAL: ${JSON.stringify(c.sentence)}\nISSUES: ${c.findings.map(f=>`${f.category}: ${JSON.stringify(f.phrase)}`).join('; ')}`).join('\n\n')}`;
}

export function proseRepairTool(cases:ProseRepairCase[]){
  return {name:'submit_prose_repairs',description:'Submit minimal sentence replacements for the provided Prose Guard cases.',parameters:{type:'object',additionalProperties:false,properties:{repairs:{type:'array',maxItems:cases.length,items:{type:'object',additionalProperties:false,properties:{caseId:{type:'string',enum:cases.map(c=>c.id)},replacementSentence:{type:'string'}},required:['caseId','replacementSentence']}}},required:['repairs']}};
}

export function applyProseRepairPayload(content:string,cases:ProseRepairCase[],payload:any,extraPhrases:string[]=[]):{text:string;applied:number;rejected:number}{
  const raw=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload:{};
  const repairs=Array.isArray(raw.repairs)?raw.repairs:[];
  const byId=new Map(cases.map(c=>[c.id,c]));
  const accepted:Array<{start:number;end:number;text:string}>=[];
  const seen=new Set<string>();let rejected=0;
  for(const repair of repairs.slice(0,cases.length)){
    const id=String(repair?.caseId||'');const c=byId.get(id);if(!c||seen.has(id)){rejected++;continue;}seen.add(id);
    const replacement=String(repair?.replacementSentence||'').trim();
    if(!replacement||/[\r\n\u2028\u2029]/.test(replacement)){rejected++;continue;}
    if(stripStructuredArtifacts(replacement)!==replacement){rejected++;continue;}
    if(replacement.length<Math.max(4,c.sentence.trim().length*.3)||replacement.length>c.sentence.trim().length*2.2){rejected++;continue;}
    // A repair should actually clear the flagged local prose patterns. If a custom
    // banned phrase or built-in issue remains, reject rather than broad-rewrite again.
    if(collectProseFindings(replacement,extraPhrases).length){rejected++;continue;}
    if(replacement===c.sentence.trim()){rejected++;continue;}
    accepted.push({start:c.start,end:c.end,text:replacement});
  }
  let text=content;
  for(const r of accepted.sort((a,b)=>b.start-a.start))text=text.slice(0,r.start)+preserveOuterWhitespace(content.slice(r.start,r.end),r.text)+text.slice(r.end);
  return{text,applied:accepted.length,rejected};
}

export function stripStructuredArtifacts(text:string):string{
  return text
    .replace(/<story-engine(?:\s[^>]*)?>[\s\S]*?<\/story-engine>/gi,'')
    .replace(/```(?:json)?\s*\{[\s\S]*?"(?:semantic|tracker|resolution)"[\s\S]*?\}\s*```/gi,'')
    .replace(/^\s*(?:STORY_ENGINE|SEMANTIC_LEDGER|TRACKER_DELTA)\s*:[\s\S]*$/gim,'')
    .trim();
}

function sentenceSpans(source:string):Array<{start:number;end:number}>{
  const spans:Array<{start:number;end:number}>=[];
  const segmenter=typeof Intl!=='undefined'&&typeof (Intl as any).Segmenter==='function'?new (Intl as any).Segmenter(undefined,{granularity:'sentence'}):null;
  if(segmenter){for(const seg of segmenter.segment(source)){const start=Number(seg.index||0),end=start+String(seg.segment||'').length;if(end>start)spans.push({start,end});}return spans;}
  const re=/[^.!?\r\n]+(?:[.!?]+(?:["'’”)\]]*)?|$)/g;let m:RegExpExecArray|null;
  while((m=re.exec(source))){if(m[0].length){spans.push({start:m.index,end:m.index+m[0].length});}if(!m[0].length)re.lastIndex++;}
  return spans;
}
function preserveOuterWhitespace(original:string,replacement:string){const lead=original.match(/^\s*/)?.[0]||'',trail=original.match(/\s*$/)?.[0]||'';return `${lead}${replacement.trim()}${trail}`;}
function escapeRegExp(s:string){return s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
