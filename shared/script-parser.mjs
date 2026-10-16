/** Split spoken sentences without changing punctuation or losing original whitespace. */
export function splitSentences(text) {
  if (typeof text !== 'string') throw new Error('文稿必须是文字');
  const result=[]; let start=0;
  for(let i=0;i<text.length;i++) {
    const character=text[i];
    let boundary=/[。！？!?\n]/u.test(character);
    if(character==='.' && (text[i+1]===undefined || /\s/.test(text[i+1]))) {
      const prefix=text.slice(start,i+1);
      boundary=!/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)\.$/i.test(prefix) && !/\b[A-Z]\.$/.test(prefix);
    }
    if(!boundary) continue;
    while(i+1<text.length && /[。！？!?.”’」』】）)"'\s]/u.test(text[i+1])) i++;
    const sentence=text.slice(start,i+1); if(sentence.trim()) result.push(sentence); else if(result.length) result[result.length-1]+=sentence;
    start=i+1;
  }
  const remainder=text.slice(start);
  if(remainder.trim()) result.push(remainder); else if(result.length) result[result.length-1]+=remainder;
  return result.length ? result : text.trim() ? [text] : [];
}
export function parseScriptDocument(text) {
  if(typeof text!=='string'||!text.trim()) throw new Error('导入文稿为空');
  const lines=text.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').split('\n');
  const heading=line=>line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/)?.[1] ?? line.match(/^\s*第[零一二三四五六七八九十百千\d]+[章节部幕][\s：:、.]+(.+?)\s*$/)?.[1] ?? line.match(/^\s*(第[零一二三四五六七八九十百千\d]+[章节部幕])\s*$/)?.[1] ?? line.match(/^\s*【(.+)】\s*$/)?.[1];
  const chapters=[];
  if(lines.some(line=>heading(line))) {
    let title='开场',content=[];
    const flush=()=>{const body=content.join('\n').trim();if(body)chapters.push({title,segments:splitSentences(body).filter(s=>s.trim()).map(text=>({text}))});content=[];};
    for(const line of lines){const next=heading(line);if(next){flush();title=next;}else content.push(line);}flush();
  } else {
    for(const paragraph of lines.join('\n').split(/\n\s*\n+/).filter(s=>s.trim())) chapters.push({title:`章节 ${chapters.length+1}`,segments:splitSentences(paragraph.trim()).filter(s=>s.trim()).map(text=>({text}))});
  }
  if(!chapters.length)throw new Error('文稿没有可导入的正文');
  return {chapters};
}
