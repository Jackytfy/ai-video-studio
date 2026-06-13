/**
 * Storage Provider abstraction — unifies local filesystem and S3 storage.
 * Both inline render (local) and worker (S3) paths use this interface.
 */

import { readFile, writeFile, mkdir, rm, stat } from "fs/promises";
import { join, dirname } from "path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

export interface StorageProvider {
  /** Write a file. Creates parent directories if needed. */
  put(key: string, data: Buffer | string, contentType?: string): Promise<string>;

  /** Read a file as Buffer. */
  get(key: string): Promise<Buffer>;

  /** Delete a file. */
  delete(key: string): Promise<void>;

  /** Check if a file exists. Returns size in bytes or null. */
  head(key: string): Promise<number | null>;

  /** Get a public/readable URL for the key. */
  url(key: string): string;
}

// ─── Local filesystem provider ───────────────────────────────────────────────

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;
  private urlPrefix: string;

  constructor(baseDir: string, urlPrefix: string = "/api/uploads") {
    this.baseDir = baseDir;
    this.urlPrefix = urlPrefix;
  }

  async put(key: string, data: Buffer | string, _contentType?: string): Promise<string> {
    const filePath = join(this.baseDir, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
    return this.url(key);
  }

  async get(key: string): Promise<Buffer> {
    const filePath = join(this.baseDir, key);
    return readFile(filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.baseDir, key);
    try {
      await rm(filePath);
    } catch {
      // File may not exist
    }
  }

  async head(key: string): Promise<number | null> {
    try {
      const filePath = join(this.baseDir, key);
      const info = await stat(filePath);
      return info.size;
    } catch {
      return null;
    }
  }

  url(key: string): string {
    return `${this.urlPrefix}/${key}`;
  }
}

// ─── S3 provider ─────────────────────────────────────────────────────────────

export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor(config: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicUrl?: string;
  }) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: !!config.endpoint, // MinIO needs path-style
    });
    this.bucket = config.bucket;
    this.publicUrl = config.publicUrl || `${config.endpoint}/${config.bucket}`;
  }

  async put(key: string, data: Buffer | string, contentType?: string): Promise<string> {
    const body = typeof data === "string" ? Buffer.from(data) : data;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || "application/octet-stream",
      })
    );
    return this.url(key);
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key })
    );
    const bytes = await response.Body!.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key })
    );
  }

  async head(key: string): Promise<number | null> {
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key })
      );
      return response.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  url(key: string): string {
    return `${this.publicUrl}/${key}`;
  }
}

// ─── Factory ─────────────────────────────────────────────────────────────────

let _instance: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (_instance) return _instance;

  const s3Endpoint = process.env.S3_ENDPOINT;
  const s3Bucket = process.env.S3_BUCKET;
  const s3AccessKey = process.env.S3_ACCESS_KEY;
  const s3SecretKey = process.env.S3_SECRET_KEY;
  const s3Region = process.env.S3_REGION || "us-east-1";
  const s3PublicUrl = process.env.S3_PUBLIC_URL;

  if (s3Endpoint && s3Bucket && s3AccessKey && s3SecretKey) {
    _instance = new S3StorageProvider({
      endpoint: s3Endpoint,
      region: s3Region,
      bucket: s3Bucket,
      accessKeyId: s3AccessKey,
      secretAccessKey: s3SecretKey,
      publicUrl: s3PublicUrl,
    });
  } else {
    const baseDir = join(process.cwd(), "uploads");
    _instance = new LocalStorageProvider(baseDir);
  }

  return _instance;
}

/** Reset the singleton (for testing). */
export function resetStorageProvider(): void {
  _instance = null;
}
