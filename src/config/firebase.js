import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the service account key file (located in the root project folder)
const serviceAccountPath = path.join(__dirname, "../../qflow-353dd-firebase-adminsdk-fbsvc-1e521968d1.json");

let firebaseApp;

if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
    firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin initialized successfully");
} else {
    console.warn("⚠️ Firebase Service Account key not found at path: " + serviceAccountPath);
    console.warn("⚠️ FCM notifications will be disabled.");
}

export const adminMessaging = firebaseApp ? admin.messaging() : null;
