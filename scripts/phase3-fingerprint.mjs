import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
export function fingerprint(){
 const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(p=>!p.startsWith('docs/')&&!p.endsWith('.md')).sort();
 const hash=createHash('sha256');for(const path of paths){if(!statSync(path).isFile())continue;hash.update(path+'\0');hash.update(readFileSync(path));hash.update('\0');}
 return {algorithm:'sha256 of sorted Git-visible non-Markdown/non-docs paths and contents',sha256:hash.digest('hex'),files:paths.length,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
}
