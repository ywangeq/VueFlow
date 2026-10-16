import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {validateProjectDocument,migrateProject,parseImport,createProjectArchive,appendImportedProject} from '../shared/project-format.mjs';
import {splitSentences,parseScriptDocument} from '../shared/script-parser.mjs';
const example=JSON.parse(await readFile(new URL('../examples/project-v2.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(example);
function withMedia(){const p=fresh(),s=p.chapters[0].segments[0];const v={id:'version_a',kind:'audio',name:'voice.wav',url:'/media/voice.wav',duration:1,createdAt:p.updatedAt,textSnapshot:s.text,directionSnapshot:s.direction};s.versions=[v];s.activeAudioId=v.id;s.approvedVersionIds=[v.id];return p;}
test('formal v2 example validates; future schemas, unsupported graph and unknown fields reject',()=>{
  assert.equal(validateProjectDocument(example),example);
  for(const changed of [{...fresh(),schemaVersion:3},{...fresh(),graph:{...example.graph,layout:'unknown'}},{...fresh(),surprise:true}])assert.throws(()=>validateProjectDocument(changed));
  const duplicate=fresh();duplicate.chapters[1].id=duplicate.chapters[0].id;assert.throws(()=>validateProjectDocument(duplicate),/重复/);
});
test('v1 migration is deterministic, keeps evidence IDs and historical orphan jobs',()=>{
  const p=withMedia(),s=p.chapters[0].segments[0];s.comments=[{id:'comment_a',text:'重读',versionId:'version_a',time:.5,createdAt:p.updatedAt,resolved:false}];
  const old={id:p.id,title:p.title,revision:2,masterGain:.8,updatedAt:p.updatedAt,chapters:[(({enabled,...rest})=>rest)(s)],jobs:[{id:'job_old',chapterId:'deleted_segment',kind:'audio',status:'cancelled',textSnapshot:'旧稿',directionSnapshot:'原要求',baseVersionId:null,commentIds:[],createdAt:p.updatedAt}]};
  const migrated=migrateProject(old);assert.deepEqual(migrated,migrateProject(old));assert.equal(migrated.chapters[0].id,`chapter_${s.id}`);assert.equal(migrated.chapters[0].segments[0].id,s.id);assert.deepEqual(migrated.chapters[0].segments[0].comments,s.comments);assert.equal(migrated.jobs[0].segmentId,'deleted_segment');assert.equal(old.jobs[0].chapterId,'deleted_segment');
  const pending=structuredClone(old);pending.jobs[0].status='awaiting_external';assert.throws(()=>migrateProject(pending),/存在且启用/);
});
test('script parser preserves decimal punctuation, closing quotes and heading grouping',()=>{
  const text='版本 3.14 可以吗？ “可以！”\nDr. Wang says yes. Next sentence.';
  assert.equal(splitSentences(text).join(''),text);assert.equal(splitSentences('版本 3.14 可以吗？').length,1);assert.deepEqual(splitSentences('   '),[]);
  const document=parseScriptDocument('第一章：起因\n甲。乙。\n\n【结果】\n丙！');assert.deepEqual(document.chapters.map(c=>c.title),['起因','结果']);assert.equal(document.chapters[0].segments.length,2);
  const imported=parseImport(strToU8('# 示例\n你好。再见。'),'demo.md');assert.equal(imported.project.chapters[0].segments.length,2);assert.equal(imported.media.size,0);
});
test('portable ZIP roundtrip preserves media bytes and append consistently remaps evidence references',async()=>{
  const p=withMedia(),s=p.chapters[0].segments[0],v=s.versions[0];
  s.comments=[{id:'comment_a',text:'反馈',versionId:v.id,time:.2,createdAt:p.updatedAt,resolved:true}];
  v.jobId='job_a';p.jobs=[{id:'job_a',segmentId:s.id,kind:'audio',status:'completed',textSnapshot:s.text,directionSnapshot:s.direction,baseVersionId:null,completedVersionId:v.id,commentIds:['comment_a'],commentSnapshots:[{id:'comment_a',text:'反馈',versionId:v.id,time:.2,resolved:true}],createdAt:p.updatedAt}];
  const bytes=strToU8('actual-media-bytes');const archive=await createProjectArchive(p,async url=>{assert.equal(url,'/media/voice.wav');return bytes});
  const parsed=parseImport(archive,'portable.zip',{detectMedia:(data,kind)=>{assert.deepEqual(data,bytes);assert.equal(kind,'audio')}});
  assert.equal(parsed.media.size,1);const original=fresh(),staged=[];const next=await appendImportedProject(original,parsed.project,parsed.media,{saveMedia:async item=>{staged.push(item);return '/media/imported.wav'}});
  const imported=next.chapters[original.chapters.length].segments[0];assert.notEqual(imported.id,s.id);assert.notEqual(imported.versions[0].id,v.id);assert.equal(imported.activeAudioId,imported.versions[0].id);assert.equal(imported.comments[0].versionId,imported.activeAudioId);assert.equal(next.jobs[0].segmentId,imported.id);assert.equal(next.jobs[0].completedVersionId,imported.activeAudioId);assert.equal(next.jobs[0].commentSnapshots[0].id,imported.comments[0].id);assert.deepEqual(staged[0].bytes,bytes);assert.equal(imported.versions[0].url,'/media/imported.wav');assert.deepEqual(original,fresh());
});
test('JSON assets, missing ZIP assets, unsafe paths and oversized uncompressed headers reject',()=>{
  assert.throws(()=>parseImport(strToU8(JSON.stringify(withMedia())),'metadata.json'),/完整 ZIP|包含素材/);
  const p=withMedia();p.chapters[0].segments[0].versions[0].url='media/missing.wav';assert.throws(()=>parseImport(zipSync({'project.json':strToU8(JSON.stringify(p))}),'missing.zip'),/缺少素材/);
  assert.throws(()=>parseImport(zipSync({'../escape':strToU8('x')}),'unsafe.zip'),/不安全/);
  const zip=zipSync({'project.json':strToU8('{}')});for(let i=0;i<zip.length-4;i++)if(zip[i]===80&&zip[i+1]===75&&zip[i+2]===1&&zip[i+3]===2){new DataView(zip.buffer,zip.byteOffset,zip.byteLength).setUint32(i+24,256*1024*1024+1,true);break;}
  assert.throws(()=>parseImport(zip,'bomb.zip'),/256 MiB/);
});
test('bad lineage rejects before staging; graph adoption is explicit',async()=>{
  const bad=fresh();bad.chapters[0].segments[0].derivedFromId='missing';assert.throws(()=>validateProjectDocument(bad),/来源不存在/);
  const loop=fresh(),[a,b]=loop.chapters[0].segments;a.derivedFromId=b.id;b.derivedFromId=a.id;assert.throws(()=>validateProjectDocument(loop),/循环/);
  const candidate=fresh();candidate.graph.columnWidth=300;candidate.title='Imported';candidate.masterGain=.2;
  const kept=await appendImportedProject(fresh(),candidate,new Map());assert.equal(kept.graph.columnWidth,220);assert.equal(kept.title,example.title);assert.equal(kept.masterGain,1);
  const adopted=await appendImportedProject(fresh(),candidate,new Map(),{applyGraph:true});assert.equal(adopted.graph.columnWidth,300);
});
