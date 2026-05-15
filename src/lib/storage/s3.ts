import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

function createS3Client(): S3Client {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "us-east-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY || "minioadmin",
      secretAccessKey: process.env.S3_SECRET_KEY || "minioadmin",
    },
  });
}

const s3 = createS3Client();
const BUCKET = process.env.S3_BUCKET || "ai-video-studio";

export interface UploadResult {
  key: string;
  url: string;
}

export async function uploadBuffer(
  buffer: Buffer,
  contentType: string,
  folder: string = "uploads"
): Promise<UploadResult> {
  const ext = contentType.split("/")[1] || "bin";
  const key = `${folder}/${randomUUID()}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 86400 });

  return { key, url };
}

export async function uploadFile(
  filePath: string,
  contentType: string,
  folder: string = "uploads"
): Promise<UploadResult> {
  const fs = await import("fs/promises");
  const buffer = await fs.readFile(filePath);
  return uploadBuffer(buffer, contentType, folder);
}

export async function getSignedDownloadUrl(key: string): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 86400 });
}

export async function deleteFile(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}
