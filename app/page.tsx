"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type OutputVideo = {
  name: string;
  url: string;
  size: number;
};

const coreVersion = "0.12.6";
const baseUrl = `https://unpkg.com/@ffmpeg/core@${coreVersion}/dist`;

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(1)} ${units[index]}`;
};

const getVideoDuration = (file: File) =>
  new Promise<number>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const duration = video.duration;
      URL.revokeObjectURL(video.src);
      resolve(duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error("動画の読み込みに失敗しました。"));
    };
    video.src = URL.createObjectURL(file);
  });

export default function Home() {
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [ready, setReady] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [splitFile, setSplitFile] = useState<File | null>(null);
  const [mergeFiles, setMergeFiles] = useState<[File | null, File | null]>([
    null,
    null,
  ]);
  const [splitOutputs, setSplitOutputs] = useState<OutputVideo[]>([]);
  const [mergeOutput, setMergeOutput] = useState<OutputVideo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSplit = useMemo(() => splitFile && ready && !isProcessing, [
    splitFile,
    ready,
    isProcessing,
  ]);
  const canMerge = useMemo(
    () => mergeFiles[0] && mergeFiles[1] && ready && !isProcessing,
    [mergeFiles, ready, isProcessing],
  );

  const revokeOutputs = useCallback((outputs: OutputVideo[]) => {
    outputs.forEach((output) => URL.revokeObjectURL(output.url));
  }, []);

  useEffect(() => {
    return () => {
      revokeOutputs(splitOutputs);
      if (mergeOutput) {
        URL.revokeObjectURL(mergeOutput.url);
      }
    };
  }, [mergeOutput, revokeOutputs, splitOutputs]);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegRef.current || ready) return;
    setLoadingMessage("変換エンジンを準備しています...");
    const ffmpeg = new FFmpeg();
    ffmpeg.on("progress", ({ progress }) => {
      setProgress(Math.round(progress * 100));
    });
    const coreURL = await toBlobURL(`${baseUrl}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${baseUrl}/ffmpeg-core.wasm`, "application/wasm");
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegRef.current = ffmpeg;
    setReady(true);
    setLoadingMessage("");
  }, [ready]);

  const handleSplit = useCallback(async () => {
    if (!splitFile || !ffmpegRef.current) return;
    setError(null);
    setIsProcessing(true);
    setProgress(0);
    revokeOutputs(splitOutputs);
    setSplitOutputs([]);
    try {
      const duration = await getVideoDuration(splitFile);
      const half = (duration / 2).toFixed(3);
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile("input.mp4", await fetchFile(splitFile));
      await ffmpeg.exec([
        "-i",
        "input.mp4",
        "-t",
        half,
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-movflags",
        "faststart",
        "output-1.mp4",
      ]);
      await ffmpeg.exec([
        "-i",
        "input.mp4",
        "-ss",
        half,
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-movflags",
        "faststart",
        "output-2.mp4",
      ]);
      const output1 = await ffmpeg.readFile("output-1.mp4");
      const output2 = await ffmpeg.readFile("output-2.mp4");

      const output1Array = output1 as Uint8Array;
      const output2Array = output2 as Uint8Array;

      const newOutputs = [
        {
          name: "split-part-1.mp4",
          url: URL.createObjectURL(
            new Blob([output1Array as BlobPart], { type: "video/mp4" }),
          ),

          size: output1Array.length,
        },
        {
          name: "split-part-2.mp4",
          url: URL.createObjectURL(
            new Blob([output2Array as BlobPart], { type: "video/mp4" }),
          ),
          size: output2Array.length,
        },
      ];
      setSplitOutputs(newOutputs);
      await ffmpeg.deleteFile("input.mp4");
      await ffmpeg.deleteFile("output-1.mp4");
      await ffmpeg.deleteFile("output-2.mp4");
    } catch (splitError) {
      const message =
        splitError instanceof Error
          ? splitError.message
          : "動画の分割に失敗しました。";
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [revokeOutputs, splitFile, splitOutputs]);

  const handleMerge = useCallback(async () => {
    if (!mergeFiles[0] || !mergeFiles[1] || !ffmpegRef.current) return;
    setError(null);
    setIsProcessing(true);
    setProgress(0);
    if (mergeOutput) {
      URL.revokeObjectURL(mergeOutput.url);
      setMergeOutput(null);
    }
    try {
      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile("first.mp4", await fetchFile(mergeFiles[0]));
      await ffmpeg.writeFile("second.mp4", await fetchFile(mergeFiles[1]));
      const concatList = "file first.mp4\nfile second.mp4\n";
      await ffmpeg.writeFile("concat.txt", concatList);
      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "concat.txt",
        "-c",
        "copy",
        "merged.mp4",
      ]);
      const merged = await ffmpeg.readFile("merged.mp4");

      const mergedArray = merged as Uint8Array;
      setMergeOutput({
        name: "merged.mp4",
        url: URL.createObjectURL(
          new Blob([mergedArray as BlobPart], { type: "video/mp4" }),
        ),

        size: mergedArray.length,
      });
      await ffmpeg.deleteFile("first.mp4");
      await ffmpeg.deleteFile("second.mp4");
      await ffmpeg.deleteFile("concat.txt");
      await ffmpeg.deleteFile("merged.mp4");
    } catch (mergeError) {
      const message =
        mergeError instanceof Error
          ? mergeError.message
          : "動画の結合に失敗しました。";
      setError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [mergeFiles, mergeOutput]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-12">
        <header className="flex flex-col gap-4">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">
            Video Tools
          </p>
          <h1 className="text-3xl font-semibold leading-tight text-white md:text-5xl">
            動画をブラウザで半分に分割・2本をつなげる。
          </h1>
          <p className="max-w-2xl text-base text-slate-300 md:text-lg">
            すべての処理はブラウザ内で完結します。アップロードした動画は外部サーバーに送信されません。
          </p>
        </header>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 shadow-lg md:p-10">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold">使い方</h2>
              <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300 md:text-base">
                <li>最初に「エンジンを読み込む」を押して、動画処理を有効化します。</li>
                <li>動画を1本アップロードすると、ちょうど半分で分割して2本出力します。</li>
                <li>動画を2本アップロードすると、順番に連結した1本を出力します。</li>
              </ol>
            </div>
            <button
              type="button"
              onClick={loadFFmpeg}
              className="w-full rounded-2xl bg-indigo-500 px-6 py-3 text-center text-sm font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              disabled={ready || isProcessing}
            >
              {ready ? "エンジン読み込み済み" : "エンジンを読み込む"}
            </button>
            {loadingMessage && (
              <div className="rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                {loadingMessage}
              </div>
            )}
            <div className="flex items-center gap-3 text-sm text-slate-300">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-indigo-400 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="min-w-[3rem] text-right">{progress}%</span>
            </div>
            {error && (
              <div className="rounded-xl border border-red-500/60 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-8 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-900/30 p-6 shadow-lg md:p-8">
            <h2 className="text-xl font-semibold text-white">動画を半分に分割</h2>
            <p className="mt-2 text-sm text-slate-300">
              1本の動画をぴったり半分にカットし、2本のファイルとして出力します。
            </p>
            <div className="mt-6 flex flex-col gap-4">
              <input
                type="file"
                accept="video/*"
                onChange={(event) => {
                  setSplitFile(event.target.files?.[0] ?? null);
                  revokeOutputs(splitOutputs);
                  setSplitOutputs([]);
                }}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
              />
              <button
                type="button"
                onClick={handleSplit}
                disabled={!canSplit}
                className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {isProcessing ? "分割中..." : "半分に分割する"}
              </button>
              {splitFile && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                  選択中: {splitFile.name} ({formatBytes(splitFile.size)})
                </div>
              )}
              {splitOutputs.length > 0 && (
                <div className="space-y-4">
                  {splitOutputs.map((output) => (
                    <div
                      key={output.name}
                      className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4"
                    >
                      <video
                        controls
                        src={output.url}
                        className="mb-3 w-full rounded-xl"
                      />
                      <div className="flex items-center justify-between text-xs text-slate-300">
                        <span>{output.name}</span>
                        <span>{formatBytes(output.size)}</span>
                      </div>
                      <a
                        href={output.url}
                        download={output.name}
                        className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
                      >
                        ダウンロード
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-900/30 p-6 shadow-lg md:p-8">
            <h2 className="text-xl font-semibold text-white">動画を2本つなげる</h2>
            <p className="mt-2 text-sm text-slate-300">
              同じ形式・同じ解像度の動画を順番につなげて1本の動画にします。
            </p>
            <div className="mt-6 flex flex-col gap-4">
              <input
                type="file"
                accept="video/*"
                onChange={(event) => {
                  setMergeFiles([event.target.files?.[0] ?? null, mergeFiles[1]]);
                }}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
              />
              <input
                type="file"
                accept="video/*"
                onChange={(event) => {
                  setMergeFiles([mergeFiles[0], event.target.files?.[0] ?? null]);
                }}
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-full file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-slate-700"
              />
              <button
                type="button"
                onClick={handleMerge}
                disabled={!canMerge}
                className="rounded-2xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {isProcessing ? "結合中..." : "2本を結合する"}
              </button>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                <p>
                  1本目: {mergeFiles[0]?.name ?? "未選択"}
                  {mergeFiles[0] ? ` (${formatBytes(mergeFiles[0].size)})` : ""}
                </p>
                <p>
                  2本目: {mergeFiles[1]?.name ?? "未選択"}
                  {mergeFiles[1] ? ` (${formatBytes(mergeFiles[1].size)})` : ""}
                </p>
              </div>
              {mergeOutput && (
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <video
                    controls
                    src={mergeOutput.url}
                    className="mb-3 w-full rounded-xl"
                  />
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>{mergeOutput.name}</span>
                    <span>{formatBytes(mergeOutput.size)}</span>
                  </div>
                  <a
                    href={mergeOutput.url}
                    download={mergeOutput.name}
                    className="mt-3 inline-flex items-center justify-center rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-100 transition hover:border-slate-500"
                  >
                    ダウンロード
                  </a>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300 md:p-8">
          <h2 className="text-lg font-semibold text-white">Vercelデプロイに向けたヒント</h2>
          <ul className="mt-3 list-disc space-y-2 pl-6">
            <li>FFmpegはブラウザ内で動作するため、サーバー側の動画処理は不要です。</li>
            <li>初回だけエンジンの読み込みに数十秒かかる場合があります。</li>
            <li>大きな動画の場合は、ブラウザのメモリに注意してください。</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
