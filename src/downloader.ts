import { createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { extname, join } from 'node:path';
import { URL } from 'node:url';

const EXT_FROM_CONTENT_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/aac': '.aac',
  'audio/x-m4a': '.m4a',
};

export interface DownloadResult {
  url: string;
  path: string;
  bytes: number;
  contentType: string | null;
  fromCache: boolean;
}

export class AssetDownloader {
  constructor(
    private readonly outputDir: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    mkdirSync(this.outputDir, { recursive: true });
  }

  async download(url: string, taskId: string, indexInTask: number): Promise<DownloadResult> {
    const probableExt = guessExtFromUrl(url);
    const suffix = indexInTask === 0 ? '' : `-${indexInTask}`;
    let targetPath = join(this.outputDir, `${taskId}${suffix}${probableExt}`);

    if (existsSync(targetPath)) {
      return {
        url,
        path: targetPath,
        bytes: 0,
        contentType: null,
        fromCache: true,
      };
    }

    const response = await this.fetchImpl(url);
    if (!response.ok || !response.body) {
      throw new Error(
        `download failed (${response.status}) for ${url}: ${response.statusText}`,
      );
    }

    const contentType = response.headers.get('content-type');
    const ctExt = contentType ? EXT_FROM_CONTENT_TYPE[contentType.split(';')[0].trim()] : null;
    if (ctExt && !probableExt) {
      targetPath = join(this.outputDir, `${taskId}${suffix}${ctExt}`);
    }

    const tmpPath = `${targetPath}.partial`;
    const fileStream = createWriteStream(tmpPath);
    // Node fetch body is a WHATWG ReadableStream; convert.
    const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    await pipeline(nodeStream, fileStream);

    // atomic rename
    const { rename, stat } = await import('node:fs/promises');
    await rename(tmpPath, targetPath);
    const st = await stat(targetPath);

    return {
      url,
      path: targetPath,
      bytes: st.size,
      contentType,
      fromCache: false,
    };
  }

  async downloadAll(urls: string[], taskId: string): Promise<DownloadResult[]> {
    const out: DownloadResult[] = [];
    for (let i = 0; i < urls.length; i++) {
      out.push(await this.download(urls[i], taskId, i));
    }
    return out;
  }
}

function guessExtFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const ext = extname(u.pathname);
    if (ext && ext.length <= 5) return ext.toLowerCase();
  } catch {
    // fall through
  }
  return '';
}
