import Ajv from 'ajv';
import {zipSync, unzipSync, strToU8, strFromU8} from 'fflate';
import schema from '../schemas/project-v2.schema.json' with {type:'json'};
import {parseScriptDocument} from './script-parser.mjs';
export {parseScriptDocument, splitSentences} from './script-parser.mjs';
export const DEFAULT_GRAPH = Object.freeze({layout:'chapter-segments',theme:'scifi',columnWidth:220,rowGap:180});
const MAX_BYTES=256*1024*1024, MAX_ENTRIES=2000;
const ajv=new Ajv({allErrors:true,strict:true});
const validate=ajv.compile(schema);
const clone=value=>structuredClone(value);
const uid=()=>crypto.randomUUID();
const segments=project=>project.chapters.flatMap(chapter=>chapter.segments);
const versions=project=>segments(project).flatMap(segment=>segment.versions);
const fail=message=>{throw new Error(message);};
const safeMedia=path=>typeof path==='string'&&/^media\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(path)&&path.length<=240;

/** JSON Schema is the structural authority; these checks enforce cross-object references. */
export function validateProjectDocument(project) {
  if(project?.schemaVersion!==2) fail(`不支持工程 schemaVersion ${project?.schemaVersion??'缺失'}；仅支持版本 2。`);
  if(!validate(project))fail(`工程格式无效：${validate.errors.slice(0,4).map(error=>`${error.instancePath||'/'} ${error.message}`).join('；')}`);
  const all=segments(project); if(all.length>5000)fail('工程片段总数不能超过 5000');
  const seen=new Set([project.id]);
  const register=(value,label)=>{if(seen.has(value.id))fail(`${label} ID 重复：${value.id}`);seen.add(value.id);};
  for(const chapter of project.chapters){register(chapter,'章节');for(const segment of chapter.segments){register(segment,'片段');for(const version of segment.versions)register(version,'素材');for(const comment of segment.comments)register(comment,'评论');}}
  for(const job of project.jobs)register(job,'任务');
  const jobs=new Map(project.jobs.map(job=>[job.id,job]));
  const bySegment=new Map(all.map(segment=>[segment.id,segment]));
  for(const segment of all){const lineage=new Set([segment.id]);let ancestor=segment.derivedFromId;while(ancestor){if(lineage.has(ancestor))fail('派生片段来源存在循环');lineage.add(ancestor);const source=bySegment.get(ancestor);if(!source)fail(`派生片段 ${segment.id} 的来源不存在`);ancestor=source.derivedFromId;}}
  for(const segment of all){
    const assets=new Map(segment.versions.map(version=>[version.id,version]));
    for(const [id,kind] of [[segment.activeAudioId,'audio'],[segment.activeVideoId,'video']])if(id!==null&&assets.get(id)?.kind!==kind)fail(`片段 ${segment.id} 的选中${kind}版本不存在或类型错误`);
    if(new Set(segment.approvedVersionIds).size!==segment.approvedVersionIds.length||segment.approvedVersionIds.some(id=>!assets.has(id)))fail(`片段 ${segment.id} 的验收版本无效`);
    for(const comment of segment.comments){if(!Number.isFinite(Date.parse(comment.createdAt)))fail('评论时间无效');if(comment.versionId!==null&&!assets.has(comment.versionId))fail(`评论 ${comment.id} 的素材版本不存在`);}
    for(const version of segment.versions){
      if(!Number.isFinite(Date.parse(version.createdAt)))fail('素材时间无效');
      if(version.jobId&&(!jobs.has(version.jobId)||jobs.get(version.jobId).segmentId!==segment.id||jobs.get(version.jobId).kind!==version.kind))fail(`素材 ${version.id} 的生成任务不存在或不属于本片段`);
    }
  }
  for(const job of project.jobs){
    if(!Number.isFinite(Date.parse(job.createdAt)))fail('任务时间无效');
    const segment=all.find(segment=>segment.id===job.segmentId);
    if(job.status==='awaiting_external'&&(!segment||!segment.enabled))fail(`待执行任务 ${job.id} 必须属于存在且启用的片段`);
    // Completed/cancelled orphan jobs retain historical snapshots after their segment was deleted.
    if(segment){
      if(job.baseVersionId!==null&&!segment.versions.some(version=>version.id===job.baseVersionId))fail(`任务 ${job.id} 的基线版本不存在`);
      if(job.completedVersionId&&!segment.versions.some(version=>version.id===job.completedVersionId&&version.kind===job.kind))fail(`任务 ${job.id} 的结果版本不存在或类型错误`);
      if(job.status==='awaiting_external'&&job.commentIds.some(id=>!segment.comments.some(comment=>comment.id===id)))fail(`待执行任务 ${job.id} 的评论不存在`);
    }
    if(new Set(job.commentIds).size!==job.commentIds.length)fail('任务评论 ID 重复');
    if(job.commentSnapshots){const snapshots=new Set();for(const snapshot of job.commentSnapshots){if(snapshots.has(snapshot.id)||!job.commentIds.includes(snapshot.id))fail('任务评论快照引用无效');snapshots.add(snapshot.id);}}
  }
  if(!Number.isFinite(Date.parse(project.updatedAt)))fail('工程时间无效');
  return project;
}

/** V1 had flat executable chapters; retain each as one enabled segment and preserve all evidence. */
export function migrateProject(input) {
  const source=input?.project??input;
  if(source?.schemaVersion===2)return validateProjectDocument(clone(source));
  if(source?.schemaVersion!==undefined&&source.schemaVersion!==1)fail(`不支持未来或未知工程版本 ${source.schemaVersion}`);
  if(!source||!Array.isArray(source.chapters)||!Array.isArray(source.jobs))fail('不是可识别的旧版工程');
  const project=clone(source);
  project.schemaVersion=2;project.graph={...DEFAULT_GRAPH};
  const reserved=new Set();
  const collect=value=>{if(!value||typeof value!=='object')return;if(typeof value.id==='string')reserved.add(value.id);for(const child of Object.values(value))if(child&&typeof child==='object')collect(child);};collect(project);
  const groupId=id=>{const base=`chapter_${id}`;let candidate=base.slice(0,100),attempt=0;while(reserved.has(candidate)){const suffix=`_group${++attempt}`;candidate=base.slice(0,100-suffix.length)+suffix;}reserved.add(candidate);return candidate;};
  project.chapters=project.chapters.map(chapter=>({id:groupId(chapter.id),title:chapter.title,segments:[{...chapter,enabled:true}]}));
  project.jobs=project.jobs.map(job=>{const {chapterId,...rest}=job;return {...rest,segmentId:job.segmentId??chapterId};});
  return validateProjectDocument(project);
}
function fromScript(text,name) {
  const now=new Date().toISOString();
  const parsed=parseScriptDocument(text);
  return validateProjectDocument({schemaVersion:2,id:uid(),title:name.replace(/\.[^.]+$/,'').slice(0,200)||'导入文稿',revision:0,masterGain:1,updatedAt:now,graph:{...DEFAULT_GRAPH},chapters:parsed.chapters.map(chapter=>({id:uid(),title:chapter.title.slice(0,200),segments:chapter.segments.map((segment,index)=>({id:uid(),title:`片段 ${index+1}`,text:segment.text,direction:'自然聊天，按语义停顿。',enabled:true,gain:1,gap:.4,approvedVersionIds:[],activeAudioId:null,activeVideoId:null,versions:[],comments:[]}))})),jobs:[]});
}
function verifyMedia(project,media,detectMedia) {
  const referenced=new Set();
  for(const version of versions(project)){
    if(!safeMedia(version.url))fail(`素材 ${version.name} 不是包内 media/ 路径。请从原工作台导出包含素材的 ZIP；JSON 仅能导入不含素材的工程。`);
    const bytes=media.get(version.url);if(!bytes)fail(`缺少素材文件 ${version.url}，请重新导出完整 ZIP。`);
    if(!bytes.byteLength)fail(`素材 ${version.url} 为空`);
    if(detectMedia)detectMedia(bytes,version.kind);
    referenced.add(version.url);
  }
  for(const path of media.keys())if(!referenced.has(path))fail(`包内存在未被工程引用的素材：${path}`);
}

/** No external URL fetches. JSON with asset references is deliberately not called portable. */
export function parseImport(input,name='project.json',{detectMedia}={}) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.byteLength>MAX_BYTES)fail('导入文件超过 256 MiB');
  if(/\.(txt|md|markdown)$/i.test(name))return {project:fromScript(strFromU8(bytes),name),media:new Map()};
  let document,media=new Map();
  if(/\.zip$/i.test(name)||bytes[0]===0x50&&bytes[1]===0x4b){
    let total=0,count=0;const paths=new Set();
    const files=unzipSync(bytes,{filter:file=>{
      if(++count>MAX_ENTRIES)fail('ZIP 条目超过 2000');
      if(paths.has(file.name))fail('ZIP 路径重复');paths.add(file.name);
      if(file.name==='media/'&&file.originalSize===0)return false;
      if(file.name!=='project.json'&&!safeMedia(file.name))fail(`ZIP 包含不安全或未知路径：${file.name}`);
      if(!Number.isSafeInteger(file.originalSize)||(total+=file.originalSize)>MAX_BYTES)fail('ZIP 解压后超过 256 MiB');
      return true;
    }});
    if(!files['project.json'])fail('ZIP 根目录缺少 project.json');
    document=JSON.parse(strFromU8(files['project.json']));
    for(const [path,data]of Object.entries(files))if(path!=='project.json')media.set(path,data);
  }else document=JSON.parse(strFromU8(bytes));
  const project=migrateProject(document);
  verifyMedia(project,media,detectMedia);
  return {project,media};
}

export async function createProjectArchive(input,readMedia) {
  const project=clone(validateProjectDocument(input)), files={}, paths=new Map();let total=0;
  for(const version of versions(project)){
    if(!/^\/media\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(version.url))fail('导出素材必须来自本机 /media/ 存储');
    if(!paths.has(version.url)){
      const path=`media/${paths.size+1}-${version.url.slice('/media/'.length)}`;
      const data=await readMedia(version.url);const bytes=data instanceof Uint8Array?data:new Uint8Array(data);
      if(!bytes.byteLength)fail(`导出素材为空：${version.url}`);
      total+=bytes.byteLength;if(total>MAX_BYTES||paths.size+2>MAX_ENTRIES)fail('工程包超过 256 MiB 或 2000 条目，请拆分工程');
      files[path]=bytes;paths.set(version.url,path);
    }
    version.url=paths.get(version.url);
  }
  files['project.json']=strToU8(JSON.stringify(project,null,2));
  if(total+files['project.json'].byteLength>MAX_BYTES)fail('工程包超过 256 MiB');
  const archive=zipSync(files,{level:0});if(archive.byteLength>MAX_BYTES)fail('工程 ZIP 超过 256 MiB');return archive;
}

/** Append is the default: preserve current authority and remap every imported ID, even orphan evidence. */
export async function appendImportedProject(current,candidate,media,{saveMedia,detectMedia,applyGraph=false}={}) {
  validateProjectDocument(current);validateProjectDocument(candidate);verifyMedia(candidate,media,detectMedia);
  const next=clone(current), imported=clone(candidate), ids=new Map(), saved=new Map();
  const remap=id=>{if(id===null||id===undefined)return id;if(!ids.has(id))ids.set(id,uid());return ids.get(id);};
  for(const chapter of imported.chapters){chapter.id=remap(chapter.id);for(const segment of chapter.segments){segment.id=remap(segment.id);if(segment.derivedFromId)segment.derivedFromId=remap(segment.derivedFromId);segment.activeAudioId=remap(segment.activeAudioId);segment.activeVideoId=remap(segment.activeVideoId);segment.approvedVersionIds=segment.approvedVersionIds.map(remap);for(const version of segment.versions){version.id=remap(version.id);if(version.jobId)version.jobId=remap(version.jobId);}for(const comment of segment.comments){comment.id=remap(comment.id);comment.versionId=remap(comment.versionId);}}}
  for(const job of imported.jobs){job.id=remap(job.id);job.segmentId=remap(job.segmentId);job.baseVersionId=remap(job.baseVersionId);job.commentIds=job.commentIds.map(remap);if(job.completedVersionId)job.completedVersionId=remap(job.completedVersionId);for(const snapshot of job.commentSnapshots??[]){snapshot.id=remap(snapshot.id);snapshot.versionId=remap(snapshot.versionId);}}
  next.chapters.push(...imported.chapters);next.jobs.push(...imported.jobs);
  if(applyGraph)next.graph=clone(candidate.graph);
  // Validate limits and references before asking the server to stage a single media file.
  validateProjectDocument(next);
  for(const version of versions(imported)){
    const path=version.url;
    if(!saved.has(path)){
      if(!saveMedia)fail('导入素材需要本机保存服务');
      const url=await saveMedia({filename:path.slice(6),bytes:media.get(path),kind:version.kind});
      if(typeof url!=='string'||!/^\/media\/[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(url))fail('素材保存服务返回了不安全路径');
      saved.set(path,url);
    }
    version.url=saved.get(path);
  }
  next.updatedAt=new Date().toISOString();
  return validateProjectDocument(next);
}
