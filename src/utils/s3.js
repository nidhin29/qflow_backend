import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { ApiError } from "./ApiError.js";

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    }
});

/**
 * Uploads a file buffer to AWS S3.
 * @param {Buffer} fileBuffer - The file content buffer from Multer
 * @param {String} fileName - Desired name for the file in S3
 * @param {String} folder - Folder path in the bucket (e.g., 'users', 'hospitals')
 * @param {String} mimetype - The MIME type of the file (e.g., 'image/png')
 * @returns {Promise<String>} - The public URL of the uploaded file
 */
export const uploadFileToS3 = async (fileBuffer, fileName, folder, mimetype) => {
    try {
        const key = `${folder}/${Date.now()}-${fileName}`;

        const params = {
            Bucket: process.env.AWS_BUCKET_NAME,
            Key: key,
            Body: fileBuffer,
            ContentType: mimetype,
            // ACL: "public-read" // We use Bucket Policy for this in our setup
        };

        const command = new PutObjectCommand(params);
        await s3Client.send(command);

        // Return the public URL
        return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    } catch (error) {
        console.error("S3 Upload Error:", error);
        throw new ApiError(500, "Failed to upload file to S3");
    }
};
