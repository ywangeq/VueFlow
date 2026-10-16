import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "typescript";
const source = await fs.readFile(
  new URL("../src/services/media.ts", import.meta.url),
  "utf8",
);
const js = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const {
  volume,
  selectedVersion,
  exportAudio,
  chapterPlayback,
  waitForMediaReady,
  syncChapterMedia,
  claimPlayback,
  releasePlayback,
} = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const version = { id: "a", kind: "audio", textSnapshot: "hello", duration: 2 };
const chapter = {
  title: "Chapter",
  text: "hello",
  gain: 1,
  gap: 0,
  versions: [version],
  activeAudioId: "a",
  activeVideoId: null,
  approvedVersionIds: ["a"],
  comments: [],
};
const project = { masterGain: 1, chapters: [chapter] };
test("media selection cannot substitute a different media kind or absent version", () => {
  assert.equal(selectedVersion(chapter, "audio"), version);
  assert.equal(selectedVersion(chapter, "video"), null);
  assert.equal(
    selectedVersion({ ...chapter, activeVideoId: "a" }, "video"),
    null,
  );
  assert.equal(
    selectedVersion({ ...chapter, activeAudioId: "missing" }, "audio"),
    null,
  );
});
test("playback gain stays in native media range", () => {
  assert.equal(volume(2), 1);
  assert.equal(volume(-1), 0);
  assert.equal(volume(NaN), 0);
  assert.equal(volume(0.4), 0.4);
});
test("export refuses incomplete, stale and unapproved sequences before decoding", async () => {
  await assert.rejects(exportAudio({ ...project, chapters: [] }), /添加章节/);
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [{ ...chapter, activeAudioId: null }],
    }),
    /缺少/,
  );
  await assert.rejects(
    exportAudio({ ...project, chapters: [{ ...chapter, text: "new" }] }),
    /旧文稿/,
  );
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [{ ...chapter, approvedVersionIds: [] }],
    }),
    /审听/,
  );
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [{ ...chapter, versions: [{ ...version, duration: 901 }] }],
    }),
    /15 分钟/,
  );
});
test("audio export schedules gains and gaps and writes bounded stereo PCM WAV", async () => {
  const original = {
    AudioContext: globalThis.AudioContext,
    OfflineAudioContext: globalThis.OfflineAudioContext,
    fetch: globalThis.fetch,
  };
  const starts = [],
    gains = [];
  let closed = false;
  globalThis.AudioContext = class {
    async decodeAudioData() {
      return { duration: 2 };
    }
    async close() {
      closed = true;
    }
  };
  globalThis.OfflineAudioContext = class {
    constructor(channels, length, rate) {
      assert.equal(channels, 2);
      assert.equal(length, 5 * 44100);
      assert.equal(rate, 44100);
    }
    createBufferSource() {
      return {
        connect() {},
        start(time) {
          starts.push(time);
        },
      };
    }
    createGain() {
      const gain = { value: 0 };
      gains.push(gain);
      return { gain, connect() {} };
    }
    async startRendering() {
      return {
        numberOfChannels: 2,
        length: 2,
        sampleRate: 44100,
        getChannelData: () => new Float32Array([2, -2]),
      };
    }
  };
  globalThis.fetch = async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(2),
  });
  try {
    const blob = await exportAudio({
      masterGain: 0.5,
      chapters: [
        { ...chapter, gain: 0.6, gap: 1 },
        { ...chapter, gain: 1 },
      ],
    });
    assert.deepEqual(starts, [0, 3]);
    assert.deepEqual(
      gains.map((g) => g.value),
      [0.3, 0.5],
    );
    const bytes = await blob.arrayBuffer(),
      view = new DataView(bytes);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), "RIFF");
    assert.equal(view.getUint16(22, true), 2);
    assert.equal(view.getInt16(44, true), 32767);
    assert.equal(view.getInt16(48, true), -32768);
    assert.equal(closed, true);
  } finally {
    Object.assign(globalThis, original);
  }
});

test("playback ownership pauses previous transport and ignores old owner release", () => {
  const preview = Symbol(),
    sequence = Symbol(),
    other = Symbol();
  const paused = [];
  claimPlayback(preview, () => {
    paused.push("preview");
    releasePlayback(preview);
  });
  claimPlayback(sequence, () => {
    paused.push("sequence");
    releasePlayback(sequence);
  });
  claimPlayback(sequence, () =>
    assert.fail("duplicate claim replaces callback"),
  );
  claimPlayback(other, () => paused.push("other"));
  assert.deepEqual(paused, ["preview", "sequence"]);
  releasePlayback(other);
});
test("export blocks unresolved feedback on selected version only", async () => {
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [
        { ...chapter, comments: [{ versionId: "a", resolved: false }] },
      ],
    }),
    /未解决/,
  );
});

test("export refuses obsolete performance direction when captured", async () => {
  await assert.rejects(
    exportAudio({
      ...project,
      chapters: [
        {
          ...chapter,
          direction: "new",
          versions: [{ ...version, directionSnapshot: "old" }],
        },
      ],
    }),
    /表演要求/,
  );
});

test("unified chapter playback uses max duration and separate narration mutes video", () => {
  const video = { ...version, id: "v", kind: "video", duration: 5 };
  const paired = chapterPlayback({
    ...chapter,
    activeVideoId: "v",
    versions: [version, video],
  });
  assert.equal(paired.audio, version);
  assert.equal(paired.video, video);
  assert.equal(paired.duration, 5);
  assert.equal(paired.muteVideo, true);
  const videoOnly = chapterPlayback({
    ...chapter,
    activeAudioId: null,
    activeVideoId: "v",
    versions: [video],
  });
  assert.equal(videoOnly.duration, 5);
  assert.equal(videoOnly.muteVideo, false);
  const empty = chapterPlayback({ ...chapter, activeAudioId: null });
  assert.equal(empty.duration, 0);
  assert.equal(empty.audio, null);
  assert.equal(empty.video, null);
});

test("narration is shared clock and video cannot outrun it", () => {
  const audio = { currentTime: 0.02322, duration: 2, ended: false };
  const video = { currentTime: 0.200163, duration: 5, ended: false };
  assert.equal(syncChapterMedia(audio, video), audio.currentTime);
  assert.equal(video.currentTime, audio.currentTime);
  audio.currentTime = 2;
  audio.ended = true;
  video.currentTime = 2.3;
  assert.equal(syncChapterMedia(audio, video), 2.3);
  assert.equal(audio.currentTime, 2); // finished short narration stays at its end
  audio.ended = false; // seeking to the short source end need not dispatch ended
  assert.equal(syncChapterMedia(audio, video), 2.3);
});
test("media readiness waits for decoded data and removes listeners on success, abort, timeout", async () => {
  class Media extends EventTarget {
    readyState = 1;
    seeking = false;
    listeners = new Set();
    addEventListener(type, handler, ...rest) {
      this.listeners.add(type);
      super.addEventListener(type, handler, ...rest);
    }
    removeEventListener(type, handler, ...rest) {
      this.listeners.delete(type);
      super.removeEventListener(type, handler, ...rest);
    }
  }
  const media = new Media(),
    controller = new AbortController();
  const ready = waitForMediaReady(media, controller.signal, 100);
  media.readyState = 3;
  media.seeking = true;
  media.dispatchEvent(new Event("canplay"));
  assert.ok(media.listeners.size > 0);
  media.seeking = false;
  media.dispatchEvent(new Event("seeked"));
  await ready;
  assert.equal(media.listeners.size, 0);
  media.readyState = 1;
  const aborted = waitForMediaReady(media, controller.signal, 100);
  controller.abort();
  await assert.rejects(aborted, { name: "AbortError" });
  assert.equal(media.listeners.size, 0);
  await assert.rejects(
    waitForMediaReady(media, new AbortController().signal, 5),
    /超时/,
  );
  assert.equal(media.listeners.size, 0);
});
