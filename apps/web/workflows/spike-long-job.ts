import { FatalError, getStepMetadata, getWritable, sleep } from "workflow";

// T05 技術 spike：示範長時間背景 job 的分步執行、進度回報、重試與取消。
// 正式的 AI job（T24、T31 等）沿用同一結構：發起人編號隨輸入傳入（C-12），每個 chunk 一個 step。

export interface JobProgress {
  done: number;
  total: number;
}

export interface SpikeJobInput {
  initiatorId: string;
  totalChunks: number;
  transientFailures?: { chunk: number; times: number };
  fatalAtChunk?: number;
}

export interface SpikeJobResult {
  initiatorId: string;
  chunks: Array<{ chunk: number; attempt: number }>;
}

async function processChunk(chunk: number, input: SpikeJobInput) {
  "use step";
  const { attempt } = getStepMetadata();
  if (input.fatalAtChunk === chunk) {
    throw new FatalError(`chunk ${chunk} 的輸入無效`);
  }
  const transient = input.transientFailures;
  if (transient && transient.chunk === chunk && attempt <= transient.times) {
    throw new Error(`chunk ${chunk} 暫時失敗（第 ${attempt} 次）`);
  }
  return { chunk, attempt };
}

async function reportProgress(writable: WritableStream<JobProgress>, progress: JobProgress) {
  "use step";
  const writer = writable.getWriter();
  try {
    await writer.write(progress);
  } finally {
    writer.releaseLock();
  }
}

async function closeProgress(writable: WritableStream<JobProgress>) {
  "use step";
  await writable.close();
}

export async function spikeLongJob(input: SpikeJobInput): Promise<SpikeJobResult> {
  "use workflow";
  const writable = getWritable<JobProgress>();
  const chunks: SpikeJobResult["chunks"] = [];

  try {
    for (let chunk = 1; chunk <= input.totalChunks; chunk++) {
      chunks.push(await processChunk(chunk, input));
      await reportProgress(writable, { done: chunk, total: input.totalChunks });
      // 模擬 chunk 之間的長時間等待；sleep 期間不佔用運算資源
      if (chunk < input.totalChunks) await sleep("1m");
    }
  } finally {
    // 失敗時也關閉進度串流，讓讀取端結束；取消時由 runtime 關閉
    await closeProgress(writable);
  }
  return { initiatorId: input.initiatorId, chunks };
}
