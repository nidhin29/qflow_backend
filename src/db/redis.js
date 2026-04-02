import { createClient } from "redis";
import { config } from "dotenv";

config(); // Ensure our env vars are loaded

const redisOptions = {
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    }
};

if (process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== "" && process.env.REDIS_PASSWORD !== '""') {
    redisOptions.password = process.env.REDIS_PASSWORD;
}

const redisClient = createClient(redisOptions);

redisClient.on("error", (err) => {
    console.error("Redis Client Error", err);
});

redisClient.on("connect", () => {
    console.log("Connected to Redis");
});

const connectRedis = async () => {
    try {
        await redisClient.connect();
    } catch (error) {
        console.error("Failed to connect to Redis:", error);
    }
};

export { redisClient, connectRedis };
