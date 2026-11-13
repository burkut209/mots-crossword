const LANGUAGES = ['en', 'tr', 'fr', 'es'];
const LEVELS = { easy: 1, medium: 2, hard: 3 };
export function normalizeAnswer(answer, lang = 'en') {
 lang=LANGUAGES.includes(lang)?lang:'en';
 let value = String(answer ?? '').normalize('NFC').trim();
 if (lang === 'tr') return value.toLocaleUpperCase('tr-TR').replace(/Â/g,'A').replace(/Î/g,'İ').replace(/Û/g,'U').replace(/[^A-ZÇĞİÖŞÜ]/gu, '');
 value = value.toLocaleUpperCase(lang).replace(/Œ/g, 'OE').replace(/Æ/g, 'AE');
 if (lang === 'es') value = value.replace(/Ñ/g, '\uE000');
 value = value.normalize('NFD').replace(/\p{M}/gu, '');
 if (lang === 'es') value = value.replace(/\uE000/g, 'Ñ');
 return value.replace(lang === 'es' ? /[^A-ZÑ]/gu : /[^A-Z]/gu, '');
}
function hashSeed(value) { let h=2166136261;for(const char of String(value))h=Math.imul(h^char.charCodeAt(0),16777619);return h>>>0; }
function randomFrom(seed) {let a=hashSeed(seed);return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function shuffled(items, random) {const result=items.slice();for(let i=result.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}
function newBoard(size) {return {grid:Array.from({length:size},()=>Array(size).fill(null)),owners:Array.from({length:size},()=>Array(size).fill(0)),entries:[],used:new Set(),usedAnswers:new Set(),represented:new Set()};}
function placement(board,word,row,col,direction,size,initial=false){
 const dr=direction==='down'?1:0,dc=1-dr,bit=dr?2:1,endRow=row+dr*(word.answer.length-1),endCol=col+dc*(word.answer.length-1);
 if(row<0||col<0||endRow>=size||endCol>=size)return -1;
 const occupied=(r,c)=>r>=0&&c>=0&&r<size&&c<size&&board.grid[r][c]!==null;
 if(occupied(row-dr,col-dc)||occupied(endRow+dr,endCol+dc))return -1;
 let crosses=0;for(let i=0;i<word.answer.length;i++){const r=row+i*dr,c=col+i*dc,value=board.grid[r][c];if(value!==null){if(value!==word.answer[i]||(board.owners[r][c]&bit))return -1;crosses++;}else if(occupied(r-dc,c-dr)||occupied(r+dc,c+dr))return -1;}
 return(initial||crosses>0)&&crosses<word.answer.length?crosses:-1;
}
function addWord(board,word,row,col,direction){const dr=direction==='down'?1:0,dc=1-dr,bit=dr?2:1;for(let i=0;i<word.answer.length;i++){const r=row+i*dr,c=col+i*dc;board.grid[r][c]=word.answer[i];board.owners[r][c]|=bit;}board.entries.push({...word,row,col,direction});board.used.add(word.id);board.usedAnswers.add(word.answer);board.represented.add(word.lang);}
function letterLocations(board,size){const positions=new Map();for(let r=0;r<size;r++)for(let c=0;c<size;c++){const char=board.grid[r][c];if(char!==null){if(!positions.has(char))positions.set(char,[]);positions.get(char).push([r,c]);}}return positions;}
function attempt(words,size,languages,level,random,firstIndex){
 const board=newBoard(size),first=words[firstIndex%words.length],firstDirection=random()<.5?'across':'down',center=Math.floor(size/2),offset=Math.floor((size-first.answer.length)/2);
 addWord(board,first,firstDirection==='down'?offset:center,firstDirection==='down'?center:offset,firstDirection);
 for(let turn=0;turn<Math.min(words.length,size===15?45:75);turn++){
  const locations=letterLocations(board,size);let best=null,bestScore=-Infinity;
  for(const word of words){if(board.used.has(word.id)||board.usedAnswers.has(word.answer))continue;const candidateKeys=new Set();
   for(let index=0;index<word.answer.length;index++){const matches=locations.get(word.answer[index]);if(!matches)continue;
    for(const[r,c]of matches)for(const direction of ['across','down']){const row=r-(direction==='down'?index:0),col=c-(direction==='across'?index:0),key=`${row},${col},${direction}`;if(candidateKeys.has(key))continue;candidateKeys.add(key);const crosses=placement(board,word,row,col,direction,size);if(crosses<0)continue;const midpointR=row+(direction==='down'?(word.answer.length-1)/2:0),midpointC=col+(direction==='across'?(word.answer.length-1)/2:0),distance=Math.abs(midpointR-center)+Math.abs(midpointC-center),missingLanguage=board.represented.has(word.lang)?0:40,languageCount=board.entries.reduce((sum,entry)=>sum+(entry.lang===word.lang?1:0),0),score=crosses*5+word.answer.length*.2-distance*.1+random()*4+missingLanguage-languageCount*.18+(word.level===level?7:word.level===level-1?1:0);if(score>bestScore){bestScore=score;best={word,row,col,direction};}}
   }
  }
  if(!best)break;addWord(board,best.word,best.row,best.col,best.direction);
 }
 return board;
}
export function generatePuzzle(options={},wordBank=[]){
 const size=Number(options.size??15);if(![15,21].includes(size))throw new Error('Choose a 15 × 15 or 21 × 21 grid.');
 const difficulty=String(options.difficulty??'medium').toLowerCase();if(!Object.hasOwn(LEVELS,difficulty))throw new Error('Choose easy, medium, or hard.');
 const languages=[...new Set(options.languages??['en'])].filter(lang=>LANGUAGES.includes(lang));if(!languages.length)throw new Error('Choose at least one language.');
 const seed=String(options.seed??`${Date.now()}-${Math.random().toString(36).slice(2)}`),level=LEVELS[difficulty],random=randomFrom(seed),seenIds=new Set(),words=[];
 for(const source of wordBank){if(!languages.includes(source.lang)||!Number.isInteger(source.level)||source.level>level||source.level<1)continue;const answer=normalizeAnswer(source.answer,source.lang);if(answer.length<2||answer.length>size||!source.id||seenIds.has(source.id))continue;seenIds.add(source.id);words.push({id:source.id,lang:source.lang,answer,displayAnswer:source.answer,level:source.level,clues:{...source.clues}});}
 for(const lang of languages)if(!words.some(word=>word.lang===lang))throw new Error(`No ${lang.toUpperCase()} words are available for this difficulty.`);
 if(words.length<2)throw new Error('There are not enough words for a connected puzzle.');
 const ordered=shuffled(words,random),starts=shuffled(ordered.map((_,i)=>i),random);let best=null,bestScore=-Infinity;const target=size===15?25:40;
 for(let round=0;round<22;round++){const candidate=attempt(ordered,size,languages,level,random,starts[round%starts.length]),coverage=languages.filter(lang=>candidate.represented.has(lang)).length,squares=candidate.grid.flat().filter(Boolean).length,score=coverage*10000+candidate.entries.length*100+squares;if(score>bestScore){bestScore=score;best=candidate;}if(coverage===languages.length&&candidate.entries.length>=target&&round>=3)break;}
 if(!best||best.entries.length<2||languages.some(lang=>!best.represented.has(lang)))throw new Error('This combination could not form a connected puzzle. Try a new puzzle.');
 best.entries.sort((a,b)=>a.row-b.row||a.col-b.col||(a.direction==='across'?-1:1));let number=0,previousStart='';for(const entry of best.entries){const start=`${entry.row},${entry.col}`;if(start!==previousStart){number++;previousStart=start;}entry.number=number;}
 return {size,seed,difficulty,languages,grid:best.grid,entries:best.entries};
}
export function validatePuzzle(puzzle){
 const errors=[],fail=message=>{if(errors.length<50)errors.push(message);};if(!puzzle||typeof puzzle!=='object')return{valid:false,errors:['Puzzle is missing.']};const {size,grid,entries,languages,difficulty}=puzzle;
 if(![15,21].includes(size)||!Array.isArray(grid)||grid.length!==size||grid.some(row=>!Array.isArray(row)||row.length!==size))return{valid:false,errors:['Invalid grid dimensions.']};
 if(!Array.isArray(entries)||entries.length<2||entries.length>size*size)return{valid:false,errors:['Invalid entry list.']};if(!Array.isArray(languages)||!languages.length||languages.some(lang=>!LANGUAGES.includes(lang))||new Set(languages).size!==languages.length)return{valid:false,errors:['Invalid languages.']};if(typeof difficulty!=='string'||!Object.hasOwn(LEVELS,difficulty))fail('Invalid difficulty.');if(typeof puzzle.seed!=='string'||!puzzle.seed.length||puzzle.seed.length>128)fail('Invalid seed.');
 const owners=Array.from({length:size},()=>Array.from({length:size},()=>[])),ids=new Set(),answers=new Set(),represented=new Set(),starts=new Map();
 for(let index=0;index<entries.length;index++){const entry=entries[index];if(!entry||typeof entry.answer!=='string'||entry.answer.length<2||entry.answer.length>size||!Number.isInteger(entry.row)||!Number.isInteger(entry.col)||!['across','down'].includes(entry.direction)){fail(`Entry ${index} has invalid geometry.`);continue;}if(typeof entry.id!=='string'||!entry.id||ids.has(entry.id))fail('Entry IDs must be unique.');ids.add(entry.id);if(!languages.includes(entry.lang))fail('An entry uses an unselected language.');represented.add(entry.lang);if(entry.answer!==normalizeAnswer(entry.answer,entry.lang))fail('An answer is not normalized.');if(answers.has(entry.answer))fail('Duplicate answers.');answers.add(entry.answer);if(!Number.isInteger(entry.level)||entry.level<1||entry.level>LEVELS[difficulty])fail('Entry exceeds difficulty.');if(!entry.clues||LANGUAGES.some(lang=>typeof entry.clues[lang]!=='string'||!entry.clues[lang].trim()))fail('Entry is missing a translated clue.');
 const dr=entry.direction==='down'?1:0,dc=1-dr,endR=entry.row+dr*(entry.answer.length-1),endC=entry.col+dc*(entry.answer.length-1);if(entry.row<0||entry.col<0||endR>=size||endC>=size){fail('An entry is outside the grid.');continue;}const occupied=(r,c)=>r>=0&&c>=0&&r<size&&c<size&&grid[r][c]!==null;if(occupied(entry.row-dr,entry.col-dc)||occupied(endR+dr,endC+dc))fail('An entry has an unlisted letter at its end.');const start=`${entry.row},${entry.col}`;if(!starts.has(start))starts.set(start,{row:entry.row,col:entry.col,entries:[]});starts.get(start).entries.push(entry);for(let offset=0;offset<entry.answer.length;offset++){const r=entry.row+dr*offset,c=entry.col+dc*offset;if(grid[r][c]!==entry.answer[offset])fail('Grid letters disagree with an answer.');if(owners[r][c].some(owner=>entries[owner].direction===entry.direction))fail('Parallel entries overlap.');owners[r][c].push(index);}}
 const orderedStarts=[...starts.values()].sort((a,b)=>a.row-b.row||a.col-b.col);orderedStarts.forEach((start,i)=>{if(start.entries.some(entry=>entry.number!==i+1))fail('Incorrect clue numbering.');});const adjacency=entries.map(()=>new Set());
 for(let r=0;r<size;r++)for(let c=0;c<size;c++){if(grid[r][c]!==null&&(typeof grid[r][c]!=='string'||[...grid[r][c]].length!==1))fail('Invalid cell value.');if(grid[r][c]!==null&&owners[r][c].length===0)fail('A letter has no clue.');if(owners[r][c].length>2)fail('Too many entries share a square.');for(const a of owners[r][c])for(const b of owners[r][c])if(a!==b)adjacency[a].add(b);if(grid[r][c]===null)continue;if(c+1<size&&grid[r][c+1]!==null&&!owners[r][c].some(i=>entries[i].direction==='across'&&owners[r][c+1].includes(i)))fail('Unclued adjacent horizontal letters.');if(r+1<size&&grid[r+1][c]!==null&&!owners[r][c].some(i=>entries[i].direction==='down'&&owners[r+1][c].includes(i)))fail('Unclued adjacent vertical letters.');}
 const visited=new Set([0]),queue=[0];for(let i=0;i<queue.length;i++)for(const neighbor of adjacency[queue[i]])if(!visited.has(neighbor)){visited.add(neighbor);queue.push(neighbor);}if(visited.size!==entries.length)fail('The puzzle is not connected.');for(const lang of languages)if(!represented.has(lang))fail(`Missing selected language: ${lang}.`);return{valid:errors.length===0,errors};
}
