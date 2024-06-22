import { exec as _exec } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";

/**
 * Execute a shell command. Returns stdout if successful.
 */
export async function exec(command: string) {
  try {
    const { stdout, stderr } = await promisify(_exec)(
      command.replace(/\n/g, " ")
    );
    return { stdout, stderr, success: true };
  } catch (err) {
    if (err !== undefined && typeof err.stdout == "string") {
      return {
        stdout: err.stdout as string,
        stderr: err.stderr as string,
        success: false,
      };
    }
    throw err;
  }
}

/**
 * Parse a colon delimited metadata file. Returns an object containing the metadata values.
 */
export async function parseMetadataFile(
  path: string
): Promise<Record<string, string>> {
  const rawMeta = await readFile(path, { encoding: "utf8" });
  return Object.fromEntries(
    rawMeta
      .split("\n")
      .filter((x) => x !== "")
      .map((x) => x.split(":"))
  );
}

export function makeResponse(code: number, body: string | object) {
  return JSON.stringify({
    code: code,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
