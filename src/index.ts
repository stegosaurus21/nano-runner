import "dotenv/config.js";
import z from "zod";
import { WebSocketServer } from "ws";
import { IsolateController } from "./isolate";
import { makeResponse } from "./util";
import { readdirSync } from "fs";

const PORT = parseInt(process.env.PORT ?? "8080");
const MAX_BOXES = parseInt(process.env.MAX_BOXES ?? "5");

const controller = new IsolateController(MAX_BOXES);
const wss = new WebSocketServer({ port: PORT });

const Job = z.object({
  id: z
    .string()
    .regex(/[a-zA-Z-_]+/)
    .max(64),
  src: z.string(),
  timeLimit: z.number(),
  memoryLimit: z.number(),
  input: z.array(z.string()),
  language: z.string(),
});
export type JobType = z.infer<typeof Job>;

const LANGUAGES = readdirSync("/app/scripts/languages", {
  withFileTypes: true,
})
  .filter((dirent) => dirent.isDirectory())
  .map((dirent) => dirent.name);

wss.on("connection", (ws) => {
  ws.on("error", console.error);

  ws.on("message", async (data) => {
    let rawInput;
    try {
      rawInput = JSON.parse(data.toString());
    } catch (err) {
      ws.send(makeResponse(400, "Invalid JSON input"));
      return;
    }

    let input: JobType;
    try {
      input = Job.parse(rawInput);
    } catch (err) {
      ws.send(makeResponse(400, "Invalid input object"));
      return;
    }

    if (!LANGUAGES.includes(input.language)) {
      ws.send(makeResponse(400, "Unrecognised language"));
      return;
    }

    controller.run(
      input,
      (result) => {
        ws.send(makeResponse(200, { id: input.id, task: "build", ...result }));
      },
      (i, result) => {
        ws.send(makeResponse(200, { id: input.id, task: i, ...result }));
      }
    );
  });
});
