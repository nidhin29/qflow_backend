import { createClient } from "redis";
import { config } from "dotenv";

config(); // Ensure our env vars are loaded

const redisClient = createClient({
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
});

redisClient.on("error", (err) => {
    console.error("Redis Client Error", err);
});

redisClient.on("connect", () => {
    console.log("Connected to Redis Cloud successfully!");
});

const connectRedis = async () => {
    try {
        await redisClient.connect();
    } catch (error) {
        console.error("Failed to connect to Redis:", error);
    }
};

export { redisClient, connectRedis };
