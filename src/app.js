import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";

const app = express();

app.use(cors(
    {
        origin: process.env.CORS_ORIGIN === "*" ? true : process.env.CORS_ORIGIN?.split(","),
        credentials: true
    }
));

app.use(morgan("dev")); // Add this line to see requests in real-time!
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(cookieParser());


//routes import
import userRouter from "./routes/user.router.js";
import hospitalRouter from "./routes/hospital.router.js";
import memberRouter from "./routes/member.router.js";
import appointmentRouter from "./routes/appointment.router.js";


//routes declaration
app.use("/api/v1/users", userRouter);
app.use("/api/v1/hospital", hospitalRouter);
app.use("/api/v1/members", memberRouter);
app.use("/api/v1/appointments", appointmentRouter);

export { app };