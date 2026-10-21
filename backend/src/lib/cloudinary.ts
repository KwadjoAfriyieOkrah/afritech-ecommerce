import { v2 } from "cloudinary";
import { z } from "zod";

import "./env";

const credentialsSchema = z.object({
  CLOUDINARY_CLOUD_NAME: z
    .string()
    .trim()
    .min(1, "CLOUDINARY_CLOUD_NAME is required"),
  CLOUDINARY_API_KEY: z
    .string()
    .trim()
    .min(1, "CLOUDINARY_API_KEY is required"),
  CLOUDINARY_API_SECRET: z
    .string()
    .trim()
    .min(1, "CLOUDINARY_API_SECRET is required"),
});

const parsed = credentialsSchema.safeParse({
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
});

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join("."));
  // eslint-disable-next-line no-console
  console.error(
    `Invalid Cloudinary configuration. Missing or invalid variables: ${missing.join(
      ", ",
    )}`,
  );
  process.exit(1);
}

v2.config({
  cloud_name: parsed.data.CLOUDINARY_CLOUD_NAME,
  api_key: parsed.data.CLOUDINARY_API_KEY,
  api_secret: parsed.data.CLOUDINARY_API_SECRET,
  secure: true,
});

export const CLOUDINARY_UPLOAD_FOLDER = "afritech/products";

export interface UploadedAsset {
  secureUrl: string;
  publicId: string;
}

export interface CloudinaryClient {
  upload(buffer: Buffer, folder: string): Promise<UploadedAsset>;
  destroy(publicId: string): Promise<void>;
}

function createCloudinaryClient(): CloudinaryClient {
  return {
    upload(buffer, folder) {
      return new Promise<UploadedAsset>((resolve, reject) => {
        const stream = v2.uploader.upload_stream(
          { folder, resource_type: "image" },
          (error, result) => {
            if (error || !result) {
              reject(new Error("Cloudinary did not accept the upload"));
              return;
            }
            resolve({
              secureUrl: result.secure_url,
              publicId: result.public_id,
            });
          },
        );
        stream.end(buffer);
      });
    },
    async destroy(publicId) {
      await v2.uploader.destroy(publicId, { resource_type: "image" });
    },
  };
}

let activeClient: CloudinaryClient = createCloudinaryClient();

export function getCloudinaryClient(): CloudinaryClient {
  return activeClient;
}

// Test seam: the suite replaces the client so no request ever reaches the
// real Cloudinary API. Passing null restores the signed server-side client.
export function setCloudinaryClientForTests(client: CloudinaryClient | null): void {
  activeClient = client ?? createCloudinaryClient();
}
