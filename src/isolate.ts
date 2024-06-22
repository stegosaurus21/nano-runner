import { chmod, copyFile, mkdtemp, rm, writeFile } from "fs/promises";
import path, { join } from "path";
import { mkdirSync } from "fs";
import { exec, parseMetadataFile } from "./util";
import { tmpdir } from "os";
import { JobType } from ".";

type RunnerJob = {
  script: string;
  timeLimit: number;
  memoryLimit: number;
  mounts: {
    inside: string;
    outside: string;
    type?: "rw";
  }[];
};

type Result = {
  stdout: string;
  stderr: string;
  status: string;
  time: number;
  memory: number;
  exitCode: number;
};

const BUILD_TIME_LIMIT = 60;
const BUILD_MEMORY_LIMIT = 1024 * 256;

class BoxError extends Error {
  baseMessage: string;

  constructor(id: number, operation: string, message: string) {
    super(`Box ${id} failed to ${operation}: ${message}`);
    this.baseMessage = message;
  }
}

class IsolateBox {
  private id: number;
  private busy: boolean;

  constructor(id: number) {
    this.id = id;
    this.busy = false;
    try {
      mkdirSync(`/box_data/${this.id}`, { mode: 0o0700 });
    } catch (err) {}
  }

  /**
   * Initialise the box.
   *
   * @returns {string} The base path of the box.
   */
  private async init() {
    const { success, stdout } = await exec(`isolate -b ${this.id} --cg --init`);
    if (!success) throw new BoxError(this.id, "init", stdout);
  }

  isBusy() {
    return this.busy;
  }

  /**
   * Run a script in the box.
   */
  private async runScript(options: RunnerJob) {
    const { script, timeLimit, memoryLimit } = options;

    const tmpDir = await mkdtemp(join(tmpdir(), "/nano-runner"));
    await chmod(tmpDir, 0o0755);
    await copyFile(script, join(tmpDir, "script"));

    const { stdout, stderr } = await exec(`
      isolate
      --cg
      -b ${this.id}
      --dir=/run=${tmpDir}
      ${options.mounts
        .map(
          (mount) =>
            `--dir=${mount.inside}=${mount.outside}${
              mount.type !== undefined ? ":" + mount.type : ""
            }`
        )
        .join("\n")}
      -x 0
      ${timeLimit !== -1 ? `-t ${timeLimit}` : ""}
      ${memoryLimit !== -1 ? `-m ${memoryLimit}` : ""}
      -M /box_data/${this.id}/meta
      -E PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      -p32
      --run --
      /bin/bash /run/script
    `);

    const metadata = await parseMetadataFile(`/box_data/${this.id}/meta`);
    await rm(tmpDir, { recursive: true, force: true });

    return {
      stdout: stdout,
      stderr: stderr,
      status: metadata["status"] ?? "OK",
      time: Number(metadata["time"] ?? "0"),
      memory: Number(metadata["max-rss"] ?? "0"),
      exitCode: Number(metadata["exitcode"] ?? "1"),
    };
  }

  /**
   * Run an isolated job in this box.
   */
  async run(job: RunnerJob) {
    // Check this box is free
    if (this.busy) {
      throw new BoxError(this.id, "run", "Box was busy");
    }
    this.busy = true;

    // Initialise the box
    try {
      await this.init();
    } catch (err) {
      if (err instanceof BoxError) {
        console.error(err);
        throw new BoxError(this.id, "run", "Box failed to initialise");
      }
      throw err;
    }

    // Execute run script
    let output: Result;
    try {
      output = await this.runScript(job);

      if (output.time > job.timeLimit || output.status === "TO") {
        output.status = "TLE";
      } else if (output.exitCode !== 0) {
        output.status = "RE";
      }
    } catch (err) {
      console.error(err);
      throw new BoxError(this.id, "run", "Box failed to run script");
    }

    this.busy = false;
    return output;
  }
}

export class IsolateController {
  private boxes: IsolateBox[];
  private queue: [RunnerJob, (result: Result) => void][];

  constructor(boxes: number) {
    try {
      mkdirSync("/submissions", { mode: 0o0700 });
      mkdirSync("/box_data", { mode: 0o0700 });
    } catch (err) {}
    this.boxes = Array.from({ length: boxes }, (_, i) => new IsolateBox(i));
    this.queue = [];
  }

  private async pollQueue(boxId: number) {
    const box = this.boxes[boxId];
    if (box.isBusy()) return;

    const [job, resolve, startCallback] = this.queue.shift() ?? [
      undefined,
      undefined,
      undefined,
    ];
    if (job === undefined) return;

    resolve(await box.run(job));
    await this.pollQueue(boxId);
  }

  private async runInternal(job: RunnerJob) {
    return await new Promise<Result>(
      ((resolve, reject) => {
        this.queue.push([job, resolve]);
        Promise.all(
          this.boxes.map(async (_, i) => await this.pollQueue(i))
        ).catch(reject);
      }).bind(this)
    );
  }

  async run(
    job: JobType,
    buildCallback: (result: Result) => void,
    resultCallback: (index: number, result: Result) => void
  ) {
    const tmpSrcDir = await mkdtemp(join(tmpdir(), "nano-runner"));
    await chmod(tmpSrcDir, 0o0777);
    await writeFile(join(tmpSrcDir, "src"), job.src);

    const buildResult = await this.runInternal({
      script: join("scripts", "languages", job.language, "build"),
      timeLimit: BUILD_TIME_LIMIT,
      memoryLimit: BUILD_MEMORY_LIMIT,
      mounts: [
        {
          inside: "/submission",
          outside: tmpSrcDir,
          type: "rw",
        },
      ],
    });
    buildCallback(buildResult);

    if (buildResult.exitCode === 0) {
      await chmod(tmpSrcDir, 0o0755);
      await Promise.all(
        job.input.map(async (x, i) => {
          let tmpInputDir = "";
          try {
            tmpInputDir = await mkdtemp(join(tmpdir(), "nano-runner"));
            await chmod(tmpInputDir, 0o0755);
            await writeFile(join(tmpInputDir, "input"), x);

            const result = await this.runInternal({
              script: join("scripts", "languages", job.language, "run"),
              timeLimit: job.timeLimit,
              memoryLimit: job.memoryLimit,
              mounts: [
                {
                  inside: "/submission",
                  outside: tmpSrcDir,
                },
                {
                  inside: "/input",
                  outside: tmpInputDir,
                },
              ],
            });
            resultCallback(i, result);
          } catch (err) {
            console.error(err);
            resultCallback(i, {
              stdout: "",
              stderr: "System error",
              status: "SYSERR",
              time: 0,
              memory: 0,
              exitCode: 1,
            });
          }
          if (path.resolve(tmpInputDir).startsWith(tmpdir())) {
            try {
              await rm(tmpInputDir, { recursive: true, force: true });
            } catch {}
          }
        })
      );
    }

    await rm(tmpSrcDir, { recursive: true, force: true });
  }
}
