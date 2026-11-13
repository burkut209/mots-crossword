import { normalizeAnswer, generatePuzzle, validatePuzzle } from './engine.js';
import { WORD_BANK, BANK_VERSION } from './words.js';
const $ = id => document.getElementById(id);
const LANGUAGE = {en:'English',tr:'Türkçe',fr:'Français',es:'Español'};
function readChallenge(){try{const encoded=new URLSearchParams(location.hash.slice(1)).get('p');if(!encoded)return null;const [version,size,difficulty,languages,seed]=encoded.split('~');const langs=languages?.split('-');if(version!==String(BANK_VERSION)||![15,21].includes(Number(size))||!['easy','medium','hard'].includes(difficulty)||!langs?.length||langs.some(l=>!Object.hasOwn(LANGUAGE,l))||new Set(langs).size!==langs.length||(!/^\d{1,10}$/.test(seed)||Number(seed)>4294967295))return null;return {size:Number(size),difficulty,languages:langs,seed:Number(seed)};}catch{return null;}}
const challenge=readChallenge();
let STORAGE = challenge ? 'mots.challenge.v1.'+location.hash.slice(1) : 'mots.saved.v1';
let eraseAll=false, checks=0;
const PREFERENCES = 'mots.preferences.v1';
let puzzle, values={}, marks={}, revealed={}, history=[], selectedId, activeKey, direction='across', mode='pencil', zoomed=false, pending=new Map(), composing=new Set(), cells=new Map(), memberships=new Map(), saveTimer, generationWorker, generationToken=0,cancelGeneration,registrationPromise;
let preferences = {theme:'light',translation:'en',mode:'pencil',size:15,difficulty:'medium',languages:['tr','fr','es','en']};
try { const old=JSON.parse(localStorage.getItem(PREFERENCES)); if(old && typeof old==='object') preferences={...preferences,...old}; } catch {}
const key=(r,c)=>`${r},${c}`;
const cellLists=new WeakMap(),entryIndexes=new WeakMap();
const entryCells=e=>{let list=cellLists.get(e);if(!list){list=Array.from(e.answer,(_,i)=>key(e.row+(e.direction==='down'?i:0),e.col+(e.direction==='across'?i:0)));cellLists.set(e,list);}return list;};
function entryById(id){if(!puzzle)return;let index=entryIndexes.get(puzzle);if(!index){index=new Map(puzzle.entries.map(e=>[e.id,e]));entryIndexes.set(puzzle,index);}return index.get(id);}
const selected=()=>entryById(selectedId);
let paintedKeys=new Set(),paintedActiveKey,renderedClueId,resizeFrame;
function say(message,error=false){$('announcement').textContent=message;$('announcement').classList.toggle('error',error);}
function persistPreferences(){if(eraseAll)return;try{localStorage.setItem(PREFERENCES,JSON.stringify(preferences));}catch{}}
function snapshot(){return {version:1,bankVersion:BANK_VERSION,puzzle,values,marks,revealed,selectedId,activeKey,direction,checks,savedAt:new Date().toISOString()};}
function saveNow(){clearTimeout(saveTimer);if(!puzzle||eraseAll)return;try{localStorage.setItem(STORAGE,JSON.stringify(snapshot()));$('save-status').textContent='Saved on this device';}catch{$('save-status').textContent='Saving unavailable · keep this page open';}}
function saveSoon(){clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,250);}
function answerAt(k){const [r,c]=k.split(',').map(Number);return puzzle?.grid[r]?.[c]??'';}
function validSaved(data){
 if(!data || data.version!==1 || data.bankVersion!==BANK_VERSION || !data.puzzle || ![15,21].includes(data.puzzle.size) || !Array.isArray(data.puzzle.entries) || data.puzzle.entries.length>200)return false;
 try{const verdict=validatePuzzle(data.puzzle);if(verdict===false || verdict?.valid===false || verdict?.errors?.length)return false;}catch{return false;}
 const p=data.puzzle;if(!/^\d{1,10}$/.test(p.seed)||Number(p.seed)>4294967295)return false;if(!Array.isArray(p.grid)||p.grid.length!==p.size||p.grid.some(row=>!Array.isArray(row)||row.length!==p.size))return false;
 if(p.entries.some(e=>!e.clues||Object.keys(LANGUAGE).some(l=>typeof e.clues[l]!=='string'||e.clues[l].length>500)||!Object.hasOwn(LANGUAGE,e.lang)||typeof e.answer!=='string'))return false;
 return true;
}
function cleanMap(map,kind='value'){
 const out={};if(!map||typeof map!=='object')return out;
 for(const [k,v]of Object.entries(map)){if(!/^\d{1,2},\d{1,2}$/.test(k)||!answerAt(k))continue;if(kind==='value'&&typeof v==='string'&&Array.from(v).length===1&&/^\p{L}$/u.test(v))out[k]=v;if(kind==='mark'&&['correct','incorrect'].includes(v))out[k]=v;if(kind==='reveal'&&v===true)out[k]=true;}return out;
}
function loadSnapshot(data){
 if(!validSaved(data))throw new Error('This file is not a compatible Mots puzzle.');
 resetInputState();puzzle=data.puzzle;checks=Number.isInteger(data.checks)&&data.checks>=0?data.checks:0;values=cleanMap(data.values);marks=cleanMap(data.marks,'mark');revealed=cleanMap(data.revealed,'reveal');history=[];
 selectedId=puzzle.entries.some(e=>e.id===data.selectedId)?data.selectedId:puzzle.entries[0].id;
 direction=selected().direction;activeKey=entryCells(selected()).includes(data.activeKey)?data.activeKey:entryCells(selected())[0];renderPuzzle();
}
function normalizeInput(text,lang){return normalizeAnswer(String(text).normalize('NFC'),lang).replace(/[^\p{L}]/gu,'');}
function changeValues(changes){
 const delta=[];for(const [k,value]of Object.entries(changes)){if(!cells.has(k))continue;const before=values[k]||'';if(before===value)continue;delta.push({k,before,mark:marks[k],reveal:revealed[k]});if(value)values[k]=value;else delete values[k];delete marks[k];delete revealed[k];}
 if(!delta.length)return;history.push(delta);if(history.length>150)history.shift();refreshValues(delta.map(x=>x.k));refreshProgress();saveSoon();
}
function undo(){flushPending();const delta=history.pop();if(!delta){say('Nothing to undo yet.');return;}for(const {k,before,mark,reveal}of delta){if(before)values[k]=before;else delete values[k];if(mark)marks[k]=mark;else delete marks[k];if(reveal)revealed[k]=true;else delete revealed[k];}refreshValues(delta.map(x=>x.k));refreshProgress();saveSoon();say('Last change undone.');}
function queueInput(k,input,event){if(eraseAll||cells.get(k)?.input!==input)return;if(composing.has(k)||event?.isComposing)return;clearTimeout(pending.get(k));const delay=mode==='pencil'?650:0;if(delay)pending.set(k,setTimeout(()=>commitInput(k,input),delay));else commitInput(k,input);}
function commitInput(k,input){
 if(eraseAll||cells.get(k)?.input!==input)return;
 clearTimeout(pending.get(k));pending.delete(k);if(composing.has(k))return;
 const entry=(memberships.get(k)||[]).find(e=>e.id===input.dataset.editEntry)||(memberships.get(k)||[])[0];if(!entry)return;
 let letters=Array.from(normalizeInput(input.value,entry.lang));const positions=entryCells(entry),index=positions.indexOf(k),changes={};
 if(!letters.length)changes[k]='';else {letters=letters.slice(0,positions.length-index);letters.forEach((letter,i)=>changes[positions[index+i]]=letter);}
 changeValues(changes);input.value=values[k]||'';
 if(mode==='keyboard'&&letters.length&&document.activeElement===input){const next=positions[Math.min(index+letters.length,positions.length-1)];focusCell(next,true);}else paintSelection();
}
function flushPending(){for(const [k,timer]of pending){clearTimeout(timer);const item=cells.get(k);if(item&&!composing.has(k))commitInput(k,item.input);}}
function resetInputState(){document.activeElement?.blur();flushPending();for(const timer of pending.values())clearTimeout(timer);pending.clear();composing.clear();}
function refreshValues(keys=cells.keys()){for(const k of keys){const item=cells.get(k);if(!item)continue;const {input,cell}=item,value=values[k]||'';if(!composing.has(k)&&!pending.has(k)&&input.value!==value)input.value=value;cell.classList.toggle('correct',marks[k]==='correct');cell.classList.toggle('incorrect',marks[k]==='incorrect');const invalid=String(marks[k]==='incorrect');if(input.getAttribute('aria-invalid')!==invalid)input.setAttribute('aria-invalid',invalid);cell.classList.toggle('revealed',Boolean(revealed[k]));}$('undo-button').disabled=!history.length;}
function refreshProgress(){const filled=Object.keys(values).length,total=cells.size;$('progress').textContent=`${filled} / ${total} filled`;for(const row of $('clue-list').children){const e=entryById(row.dataset.entry);if(e)row.classList.toggle('filled',entryCells(e).every(k=>values[k]));}if(filled===total)say('Every square is filled. Use Check puzzle when you are ready.');}
function paintSelection(){const e=selected();if(!e)return;const word=new Set(entryCells(e));for(const k of paintedKeys)if(!word.has(k))cells.get(k)?.cell.classList.remove('in-word');for(const k of word){const item=cells.get(k);if(!item)continue;if(!paintedKeys.has(k))item.cell.classList.add('in-word');if(item.input.lang!==e.lang)item.input.lang=e.lang;}if(paintedActiveKey!==activeKey){cells.get(paintedActiveKey)?.cell.classList.remove('active');cells.get(activeKey)?.cell.classList.add('active');}paintedKeys=word;paintedActiveKey=activeKey;for(const row of $('clue-list').children){const current=String(row.dataset.entry===selectedId);if(row.getAttribute('aria-current')!==current)row.setAttribute('aria-current',current);}}
function renderClue(){const e=selected();if(!e||renderedClueId===e.id)return;renderedClueId=e.id;$('clue-number').textContent=`${e.number} ${e.direction==='across'?'Across':'Down'}`;$('clue-language').textContent=LANGUAGE[e.lang];$('clue-length').textContent=`${Array.from(e.answer).length} letters`;$('clue-text').textContent=e.clues[e.lang];$('clue-text').lang=e.lang;updateTranslation();}
function updateTranslation(){const e=selected();if(!e)return;const lang=$('translation-language').value;$('translated-clue').textContent=e.clues[lang];$('translated-clue').lang=lang;}
function renderClueList(){
 const fragment=document.createDocumentFragment();for(const e of puzzle.entries.filter(e=>e.direction===direction)){const button=document.createElement('button');button.className='clue-row';button.dataset.entry=e.id;button.type='button';button.setAttribute('aria-current',String(e.id===selectedId));const n=document.createElement('span');n.className='clue-row-number';n.textContent=e.number;const text=document.createElement('span');text.textContent=e.clues[e.lang];text.lang=e.lang;const tag=document.createElement('small');tag.textContent=e.lang.toUpperCase();button.append(n,text,tag);button.addEventListener('click',()=>chooseEntry(e.id,true));fragment.append(button);}$('clue-list').replaceChildren(fragment);$('across-tab').setAttribute('aria-pressed',String(direction==='across'));$('down-tab').setAttribute('aria-pressed',String(direction==='down'));refreshProgress();
}
function chooseEntry(id,scroll=false){flushPending();const e=entryById(id);if(!e)return;selectedId=id;const keys=entryCells(e);activeKey=keys.find(k=>!values[k])||keys[0];const old=direction;direction=e.direction;if(old!==direction)renderClueList();renderClue();paintSelection();saveSoon();if(scroll&&zoomed)scrollToCell(activeKey);}
function scrollToCell(k){const cell=cells.get(k)?.cell;if(!cell)return;const viewport=$('board-viewport');viewport.scrollTo({left:Math.max(0,cell.offsetLeft-viewport.clientWidth/2+cell.clientWidth/2),top:Math.max(0,cell.offsetTop-viewport.clientHeight/2+cell.clientHeight/2),behavior:'auto'});}
function selectCell(k,toggle=false){
 const list=memberships.get(k)||[];if(!list.length)return;let e=list.find(x=>x.id===selectedId)||list.find(x=>x.direction===direction)||list[0];if(toggle&&activeKey===k&&list.length>1)e=list.find(x=>x.id!==e.id)||e;
 if(activeKey===k&&selectedId===e.id)return;
 activeKey=k;selectedId=e.id;const old=direction;direction=e.direction;if(old!==direction)renderClueList();renderClue();paintSelection();saveSoon();
}
function keepCellVisible(k){const item=cells.get(k);if(!item)return;const b=item.cell.getBoundingClientRect(),v=$('board-viewport').getBoundingClientRect();if(b.left<v.left||b.right>v.right||b.top<v.top||b.bottom>v.bottom)scrollToCell(k);}
function resizeBoard(){cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(eraseAll||!puzzle||!zoomed||composing.size||pending.size)return;keepCellVisible(activeKey);});}
function focusCell(k,selectText=false){const item=cells.get(k);if(!item)return;selectCell(k);item.input.dataset.editEntry=selectedId;item.input.lang=selected().lang;item.input.focus({preventScroll:true});if(mode==='keyboard'){if(selectText)item.input.select();keepCellVisible(k);}}
function keyDown(event,k,input){
 if(event.isComposing||composing.has(k))return;
 if(event.key===' '){event.preventDefault();flushPending();selectCell(k,true);input.dataset.editEntry=selectedId;input.lang=selected().lang;return;}
 if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();flushPending();const [r,c]=k.split(',').map(Number),dr=event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0,dc=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;let rr=r+dr,cc=c+dc;while(rr>=0&&cc>=0&&rr<puzzle.size&&cc<puzzle.size){const next=key(rr,cc);if(cells.has(next)){focusCell(next,true);break;}rr+=dr;cc+=dc;}return;}
 if(event.key==='Backspace'&&!input.value){event.preventDefault();const keys=entryCells(selected()),i=keys.indexOf(k);if(i>0){changeValues({[keys[i-1]]:''});focusCell(keys[i-1],true);}}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();undo();}
}
function renderPuzzle(){
 paintedKeys=new Set();paintedActiveKey=undefined;renderedClueId=undefined;cells.clear();memberships.clear();const starts=new Map();for(const e of puzzle.entries){starts.set(key(e.row,e.col),e.number);for(const k of entryCells(e)){if(!memberships.has(k))memberships.set(k,[]);memberships.get(k).push(e);}}
 const fragment=document.createDocumentFragment();for(let r=0;r<puzzle.size;r++)for(let c=0;c<puzzle.size;c++){
  const k=key(r,c),cell=document.createElement('div');cell.className='cell';if(!puzzle.grid[r][c]){cell.classList.add('block');cell.setAttribute('aria-hidden','true');fragment.append(cell);continue;}
  const n=starts.get(k);if(n){const number=document.createElement('span');number.className='cell-number';number.textContent=n;number.setAttribute('aria-hidden','true');cell.append(number);}
  const input=document.createElement('input');input.type='text';input.inputMode='text';input.autocomplete='off';input.setAttribute('autocorrect','off');input.setAttribute('autocapitalize','characters');input.setAttribute('spellcheck','false');input.setAttribute('enterkeyhint','next');input.setAttribute('aria-label',`Row ${r+1}, column ${c+1}${n?`, clue ${n}`:''}`);input.setAttribute('aria-describedby','clue-text');input.dataset.cell=k;input.lang=memberships.get(k)?.[0]?.lang||'en';input.value=values[k]||'';
  input.addEventListener('pointerdown',event=>{const toggle=activeKey===k&&document.activeElement===input;selectCell(k,toggle);input.dataset.editEntry=selectedId;if(mode==='pencil'&&event.pointerType==='touch'){event.preventDefault();document.activeElement?.blur();} });
  input.addEventListener('focus',()=>{selectCell(k);input.dataset.editEntry=selectedId;if(mode==='keyboard')input.select();});
  input.addEventListener('input',event=>queueInput(k,input,event));input.addEventListener('compositionstart',()=>{if(cells.get(k)?.input!==input)return;composing.add(k);clearTimeout(pending.get(k));pending.delete(k);});input.addEventListener('compositionend',event=>{if(cells.get(k)?.input!==input)return;composing.delete(k);queueInput(k,input,event);});
  input.addEventListener('blur',()=>{if(!pending.has(k)&&input.value===(values[k]||''))return;if(!composing.has(k))commitInput(k,input);});input.addEventListener('keydown',event=>keyDown(event,k,input));cell.append(input);cells.set(k,{cell,input});fragment.append(cell);
 }
 $('board').replaceChildren(fragment);$('board').style.setProperty('--size',puzzle.size);$('board').classList.toggle('zoomed',zoomed);$('board-viewport').classList.toggle('expanded',zoomed);$('board-viewport').scrollTo(0,0);
 $('puzzle-meta').textContent=`${puzzle.size} × ${puzzle.size} · ${puzzle.difficulty[0].toUpperCase()+puzzle.difficulty.slice(1)} · ${puzzle.languages.map(l=>l.toUpperCase()).join(' ')} · ${puzzle.entries.length} words`;
 renderClueList();renderClue();paintSelection();refreshValues();refreshProgress();setMode(mode,false);if(zoomed)requestAnimationFrame(()=>scrollToCell(activeKey));
}
function setMode(next,focus=false){flushPending();mode=next==='keyboard'?'keyboard':'pencil';preferences.mode=mode;persistPreferences();$('pencil-mode').setAttribute('aria-pressed',String(mode==='pencil'));$('keyboard-mode').setAttribute('aria-pressed',String(mode==='keyboard'));$('input-hint').textContent=mode==='pencil'?'Write in a square with Apple Pencil. Focus + enlarges it.':'Tap a square to type. Arrows move; Space switches direction.';if(focus&&mode==='keyboard'&&activeKey)focusCell(activeKey,true);else if(mode==='pencil'&&document.activeElement?.tagName==='INPUT')document.activeElement.blur();}
function check(keys,whole=false){
 if(!puzzle||!cells.size)return;flushPending();checks++;let correct=0,incorrect=0,empty=0;for(const k of keys){if(!values[k]){empty++;delete marks[k];continue;}const right=values[k]===answerAt(k);marks[k]=right?'correct':'incorrect';if(right)correct++;else incorrect++;}refreshValues();saveSoon();
 if(!empty&&!incorrect){const help=Object.keys(revealed).length;say(whole?`Beautifully done${preferences.nickname?", "+preferences.nickname:""}. Every answer is correct. ${checks} check${checks===1?"":"s"} used.${help?` ${help} square${help===1?' was':'s were'} revealed.`:''}`:'This word is correct. Nicely found.');}
 else say(`${correct} correct${incorrect?`, ${incorrect} to revisit`:''}${empty?`, ${empty} empty`:''}. ${incorrect?'Marked with ×; you can keep editing.':'Keep going at your pace.'}`);
}
function openSettings(){flushPending();$('nickname-input').value=preferences.nickname||'';$('grid-size').value=String(puzzle?.size||preferences.size);$('difficulty').value=puzzle?.difficulty||preferences.difficulty;for(const input of document.querySelectorAll('input[name="language"]'))input.checked=(puzzle?.languages||preferences.languages).includes(input.value);$('settings-error').textContent='';$('settings-dialog').showModal();}
function generate(options){
 cancelGeneration?.();const token=++generationToken;$('generate-button').disabled=true;$('generate-button').textContent='Arranging your words…';$('settings-error').textContent='';
 return new Promise((resolve,reject)=>{let timeout,settled=false,worker;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timeout);worker?.terminate();if(token===generationToken){generationWorker=null;cancelGeneration=null;}error?reject(error):resolve(result);};cancelGeneration=()=>finish(new DOMException('Generation cancelled','AbortError'));
  try{worker=new Worker('./puzzle-worker.js',{type:'module'});generationWorker=worker;worker.onmessage=event=>{event.data.error?finish(new Error(event.data.error)):finish(null,event.data.puzzle);};worker.onerror=()=>{try{finish(null,generatePuzzle(options,WORD_BANK));}catch(error){finish(error);}};worker.postMessage(options);timeout=setTimeout(()=>finish(new Error('This arrangement took too long. Please try again.')),30000);}catch{try{finish(null,generatePuzzle(options,WORD_BANK));}catch(error){finish(error);}}
 });
}
async function newPuzzle(options,leaveChallenge=false){
 flushPending();const seed=options.seed??(globalThis.crypto?.getRandomValues?crypto.getRandomValues(new Uint32Array(1))[0]:Date.now()%4294967296),task=generate({...options,seed}),token=generationToken;
 try{const next=await task;if(eraseAll||token!==generationToken)return;const verdict=validatePuzzle(next);if(!verdict.valid)throw new Error('The puzzle did not pass its checks. Please try again.');
  resetInputState();if(leaveChallenge){STORAGE='mots.saved.v1';window.history.replaceState(null,'',location.pathname+location.search);}puzzle=next;checks=0;$('share-panel').hidden=true;values={};marks={};revealed={};history=[];selectedId=puzzle.entries[0].id;activeKey=entryCells(puzzle.entries[0])[0];direction=puzzle.entries[0].direction;preferences={...preferences,...options};persistPreferences();renderPuzzle();saveNow();$('settings-dialog').close();say('A fresh page. Choose a clue and make yourself at home.');
 }catch(error){if(error.name!=='AbortError'&&!eraseAll){$('settings-error').textContent=error.message;say('Could not create a puzzle: '+error.message,true);}}finally{if(token===generationToken&&!eraseAll){$('generate-button').disabled=false;$('generate-button').textContent='Make room for new words →';}}
}
$('settings-button').addEventListener('click',openSettings);$('close-settings').addEventListener('click',()=>$('settings-dialog').close());$('settings-form').addEventListener('submit',event=>{event.preventDefault();const languages=Array.from(document.querySelectorAll('input[name="language"]:checked'),el=>el.value);if(!languages.length){$('settings-error').textContent='Choose at least one language.';return;}preferences.nickname=$('nickname-input').value.trim().slice(0,24);persistPreferences();saveNow();newPuzzle({size:Number($('grid-size').value),difficulty:$('difficulty').value,languages},true);});
$('help-button').addEventListener('click',()=>{flushPending();$('help-dialog').showModal();});$('close-help').addEventListener('click',()=>$('help-dialog').close());
$('translation-language').value=Object.hasOwn(LANGUAGE,preferences.translation)?preferences.translation:'en';$('translation-language').addEventListener('change',()=>{preferences.translation=$('translation-language').value;persistPreferences();updateTranslation();});$('translate-button').addEventListener('click',()=>{const show=$('translation').hidden;$('translation').hidden=!show;$('translate-button').setAttribute('aria-expanded',String(show));$('translate-button').textContent=show?'Hide translation':'Translate clue';});
$('pencil-mode').addEventListener('click',()=>setMode('pencil'));$('keyboard-mode').addEventListener('click',()=>setMode('keyboard',true));
$('zoom-button').addEventListener('click',()=>{flushPending();document.activeElement?.blur();zoomed=!zoomed;$('board').classList.toggle('zoomed',zoomed);$('board-viewport').classList.toggle('expanded',zoomed);$('zoom-button').setAttribute('aria-pressed',String(zoomed));$('zoom-button').textContent=zoomed?'Fit grid −':'Focus +';if(zoomed)requestAnimationFrame(()=>scrollToCell(activeKey));});
for(const dir of ['across','down'])$(dir+'-tab').addEventListener('click',()=>{if(!puzzle)return;const next=puzzle.entries.find(e=>e.direction===dir);if(next)chooseEntry(next.id);});
function adjacentClue(step){if(!puzzle)return;const list=puzzle.entries;const index=list.findIndex(e=>e.id===selectedId);chooseEntry(list[(index+step+list.length)%list.length].id,true);}
$('previous-clue').addEventListener('click',()=>adjacentClue(-1));$('next-clue').addEventListener('click',()=>adjacentClue(1));
$('undo-button').addEventListener('click',undo);$('erase-button').addEventListener('click',()=>{flushPending();if(activeKey){changeValues({[activeKey]:''});say('Square erased.');}});$('check-button').addEventListener('click',()=>{if(selected())check(entryCells(selected()));});$('check-puzzle').addEventListener('click',()=>check([...cells.keys()],true));
$('more-button').addEventListener('click',()=>{const show=$('more-actions').hidden;$('more-actions').hidden=!show;$('more-button').setAttribute('aria-expanded',String(show));});
$('clear-marks').addEventListener('click',()=>{marks={};refreshValues();saveSoon();say('Check marks cleared.');});$('reveal-letter').addEventListener('click',()=>{flushPending();if(!activeKey)return;if(values[activeKey]===answerAt(activeKey)){say('This square already contains the right letter.');return;}changeValues({[activeKey]:answerAt(activeKey)});revealed[activeKey]=true;refreshValues();saveSoon();say('One square revealed. Undo will restore your entry.');});
function applyTheme(){document.documentElement.dataset.theme=preferences.theme==='dark'?'dark':'light';$('theme-button').textContent=preferences.theme==='dark'?'Paper mode':'Evening mode';document.querySelector('meta[name="theme-color"]').content=preferences.theme==='dark'?'#262a23':'#f8f5ee';}
$('theme-button').addEventListener('click',()=>{preferences.theme=preferences.theme==='dark'?'light':'dark';persistPreferences();applyTheme();});
$('export-button').addEventListener('click',()=>{flushPending();if(!puzzle)return;const blob=new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`mots-${puzzle.seed}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);$('import-status').textContent='Saved puzzle exported. The file includes its answers.';});
$('import-file').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;try{if(file.size>1000000)throw new Error('Choose a Mots save smaller than 1 MB.');const data=JSON.parse(await file.text());if(!validSaved(data))throw new Error('This file is not a compatible Mots puzzle.');if(eraseAll)return;cancelGeneration?.();generationToken++;$('generate-button').disabled=false;$('generate-button').textContent='Make room for new words →';loadSnapshot(data);STORAGE='mots.saved.v1';window.history.replaceState(null,'',location.pathname+location.search);$('share-panel').hidden=true;saveNow();$('import-status').textContent='Puzzle restored.';$('help-dialog').close();say('Your saved puzzle is ready.');}catch(error){$('import-status').textContent=error.message;}event.target.value='';});
window.addEventListener('pagehide',()=>{flushPending();saveNow();});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'){flushPending();saveNow();}});
async function offlineSetup(){
 if(eraseAll)return;if(!('serviceWorker'in navigator)||!window.isSecureContext){$('offline-status').textContent='Offline installation needs HTTPS';return;}
 try{registrationPromise=navigator.serviceWorker.register('./sw.js');const registration=await registrationPromise;if(eraseAll){await registration.unregister();return;}await navigator.serviceWorker.ready;if(eraseAll)return;
 const report=()=>{const el=$('offline-status');if(!eraseAll&&el)el.textContent=registration.waiting?'Update ready · close all Mots tabs to install':navigator.onLine?'Ready offline':'Offline · ready to play';};report();window.addEventListener('online',report);window.addEventListener('offline',report);registration.addEventListener('updatefound',()=>{const worker=registration.installing;worker?.addEventListener('statechange',report);});
 }catch{if(!eraseAll&&$('offline-status'))$('offline-status').textContent='Offline setup unavailable · try again online';}
}
async function removeOfflineData(){
 if('serviceWorker'in navigator){try{await registrationPromise;}catch{}const regs=await navigator.serviceWorker.getRegistrations();for(const reg of regs){if(new URL(reg.scope).pathname!==new URL('./',location.href).pathname)continue;const worker=reg.installing;if(worker&&!['installed','activated','redundant'].includes(worker.state))await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Offline installation is still running. Clear website data in browser settings.')),15000);const done=()=>{if(['installed','activated','redundant'].includes(worker.state)){clearTimeout(timer);worker.removeEventListener('statechange',done);resolve();}};worker.addEventListener('statechange',done);done();});await reg.unregister();}}
 if('caches'in window)for(const name of await caches.keys())if(name.startsWith('mots-'))await caches.delete(name);
}
$('share-puzzle').addEventListener('click',async()=>{if(!puzzle)return;const p=[String(BANK_VERSION),puzzle.size,puzzle.difficulty,puzzle.languages.join('-'),puzzle.seed].join('~');const url=new URL(location.href);url.hash=new URLSearchParams({p}).toString();$('share-link').value=url.href;$('share-panel').hidden=false;try{await navigator.clipboard.writeText(url.href);say('Puzzle link copied. Your nickname and answers stay on this device.');}catch{say('Copy the puzzle link below. Your progress is not shared.');}});
$('wipe-data').addEventListener('click',async()=>{if(!window.confirm('Remove all Mots puzzles, preferences, nicknames, and offline files from this browser? This cannot be undone unless you exported a save.'))return;eraseAll=true;cancelGeneration?.();generationToken++;resetInputState();clearTimeout(saveTimer);try{for(let i=localStorage.length-1;i>=0;i--){const name=localStorage.key(i);if(name?.startsWith('mots.'))localStorage.removeItem(name);}await removeOfflineData();$('help-dialog').close();$('app').replaceChildren();const title=document.createElement('h1');title.textContent='A clean page.';const message=document.createElement('p');message.textContent='Mots saved games, settings, and offline app storage have been cleared. For complete browser removal, also remove this site in Safari Settings → Advanced → Website Data. Close this tab and remove the Home Screen icon if you are finished. Opening the site again creates a fresh game.';$('app').append(title,message);}catch{$('import-status').textContent='Some browser data could not be removed. Use Safari Settings → Advanced → Website Data and remove this site.';}});
if('ResizeObserver'in window)new ResizeObserver(resizeBoard).observe($('board-viewport'));
window.addEventListener('orientationchange',resizeBoard);
applyTheme();mode=preferences.mode==='keyboard'?'keyboard':'pencil';
let restored=false;try{const saved=JSON.parse(localStorage.getItem(STORAGE));if(saved){loadSnapshot(saved);restored=true;say('Welcome back. Your words are right where you left them.');}}catch{say('The previous save could not be restored. Starting a fresh puzzle.');}
offlineSetup();
if(!restored)await newPuzzle(challenge||{size:[15,21].includes(preferences.size)?preferences.size:15,difficulty:['easy','medium','hard'].includes(preferences.difficulty)?preferences.difficulty:'medium',languages:Array.isArray(preferences.languages)&&preferences.languages.some(l=>Object.hasOwn(LANGUAGE,l))?preferences.languages.filter(l=>Object.hasOwn(LANGUAGE,l)):['tr','fr','es','en']});
