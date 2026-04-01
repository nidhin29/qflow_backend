import dns from "dns"
dns.setServers(['8.8.8.8', '8.8.4.4']);
import dotenv from "dotenv"
import { connectDB } from "./db/index.js"
import { app } from "./app.js"
import { connectRedis } from "./db/redis.js";
import { createServer } from "http";
import { Server } from "socket.io";
dotenv.config(
    {
        path: "./.env"
    }
)


const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: process.env.CORS_ORIGIN,
        credentials: true
    }
});


app.set("io", io);

io.on("connection", (socket) => {
    console.log("Live Socket Connected:", socket.id);

    
    socket.on("join_hospital_room", (hospital_id) => {
        socket.join(`hospital_${hospital_id}`);
        console.log(`Phone joined Live Room: hospital_${hospital_id}`);
    });

    socket.on("disconnect", () => {
        console.log("Live Socket Disconnected:", socket.id);
    });
});


Promise.all([connectDB(), connectRedis()])
    .then(() => {
        // IMPORTANT: Use httpServer.listen instead of app.listen!
        httpServer.listen(process.env.PORT || 8000, () => {
            console.log(`Server is running on port ${process.env.PORT}`);
        });
    })
    .catch((err) => {
        console.error("Database connection error: ", err);
        process.exit(1);
    });


