import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.resolve(root,'..','story-engine-lumiverse.zip');
try{execFileSync('rm',['-f',out]);}catch{}
execFileSync('zip',['-qr',out,'.','-x','*.DS_Store','node_modules/*'],{cwd:root});
console.log(out);
