import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { ApiError } from "./ApiError.js";

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

/**
 * Extracts the S3 Key from a full S3 URL.
 * @param {String} url - The full S3 URL
 * @returns {String|null} - The S3 Key or null if invalid
 */
const getS3KeyFromUrl = (url) => {
    if (!url) return null;
    try {
        // Format: https://bucket.s3.region.amazonaws.com/key
        const urlObj = new URL(url);
        // pathname returns "/key", we need to remove the leading slash
        return urlObj.pathname.substring(1);
    } catch (error) {
        console.error("Error parsing S3 URL:", error);
        return null;
    }
};

/**
 * Uploads a file buffer and its thumbnail to AWS S3.
 * @param {Buffer} fileBuffer - The original file content buffer
 * @param {String} fileName - Desired name for the file
 * @param {String} folder - Folder path (e.g., 'users/123')
 * @param {String} mimetype - The MIME type
 * @returns {Promise<{ imageUrl: String, thumbnailUrl: String }>} - URLs of the uploaded files
 */
export const uploadImageWithThumbnailToS3 = async (fileBuffer, fileName, folder, mimetype) => {
    try {
        const timestamp = Date.now();
        // folder now includes userId, so it looks like "users/USER_ID"
        const originalKey = `${folder}/${timestamp}-${fileName}`;
        const thumbnailKey = `${folder}/thumbnails/thumb-${timestamp}-${fileName}`;

        // 1. Generate Thumbnail (200px width, preserved aspect ratio)
        const thumbnailBuffer = await sharp(fileBuffer)
            .resize({ width: 200 })
            .toBuffer();

        // 2. Prepare Uploads
        const uploadOriginal = s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: originalKey,
            Body: fileBuffer,
            ContentType: mimetype
        }));

        const uploadThumbnail = s3Client.send(new PutObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: thumbnailKey,
            Body: thumbnailBuffer,
            ContentType: mimetype
        }));

        // 3. Execute concurrently
        await Promise.all([uploadOriginal, uploadThumbnail]);

        // 4. Generate Public URLs (Priority: CloudFront > S3 Direct)
        const cloudFrontDomain = process.env.CLOUDFRONT_URL;
        const s3BaseUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com`;

        const baseUrl = cloudFrontDomain ? `https://${cloudFrontDomain}` : s3BaseUrl;

        return {
            imageUrl: `${baseUrl}/${originalKey}`,
            thumbnailUrl: `${baseUrl}/${thumbnailKey}`
        };
    } catch (error) {
        console.error("S3 Thumbnail Upload Error:", error);
        throw new ApiError(500, "Failed to process and upload image");
    }
};

/**
 * Deletes a file from S3 given its full URL.
 * @param {String} url - The full S3 URL of the file to delete
 */
export const deleteFileFromS3 = async (url) => {
    const key = getS3KeyFromUrl(url);
    if (!key) return;

    try {
        const command = new DeleteObjectCommand({
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
        });
        await s3Client.send(command);
    } catch (error) {
        console.error("S3 Deletion Error:", error);
        // We don't throw error here to avoid blocking the main flow if deletion fails
    }
};
