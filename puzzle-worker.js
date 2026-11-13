import { generatePuzzle } from './engine.js';
import { WORD_BANK } from './words.js';
self.onmessage = ({data}) => { try { self.postMessage({puzzle:generatePuzzle(data,WORD_BANK)}); } catch (error) { self.postMessage({error:error.message}); } };
