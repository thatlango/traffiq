import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";

const app: Express = express();

app.use(cors({
  origin: [
    /\.replit\.dev$/,
    /\.spock\.replit\.dev$/,
    /traffiq\.tukutuku\.org$/,
    /localhost/,
  ],
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
