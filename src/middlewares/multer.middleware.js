import multer from "multer";
import { ApiError } from "../utils/ApiError.js";

// We use memoryStorage for AWS S3 uploads to avoid keeping files on the server disk.
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png"];

    if (allowedMimeTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new ApiError(400, "Invalid file type. Only JPG, JPEG, and PNG are allowed."), false);
    }
};

export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});