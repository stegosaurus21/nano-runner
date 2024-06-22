# nano-runner

nano-runner is a code execution service for running user-submitted code in a sandboxed environment with CPU and memory limits.

Inspired by [judge0](https://github.com/judge0/judge0), nano-runner aims to offer a lighter experience by forgoing an internal database - once a job has been run, it is forgotten.

The sandbox is implemented using version 2 of the [isolate](https://github.com/ioi/isolate) binary.

## Features

- Build and run source code in sandboxed environments
- Impose CPU and memory limits shared across all process threads
- Docker-first, minimal setup installation
- Simple Websocket-based API

## Installation

Firstly, ensure Docker and Docker Compose are installed.

Then, check your Linux system is using `cgroupv2` by running:

```sh
ls -1 /sys/fs/cgroup | grep -q cgroup.controllers && echo "OK"
```

If the above command prints "OK", you should be fine. Otherwise, you will need to look up how to enable `cgroupv2` on your distro.

For WSL2 users, you can do this by adding the following in a file called `.wslconfig` in your Windows home directory, then restarting WSL by running `wsl --shutdown`.

```
[wsl2]
kernelCommandLine = cgroup_no_v1=all cgroup_enable=memory swapaccount=1
```

Finally, build and run the application by running:

```sh
docker compose up -d
```

## Usage

Connect to the service on port 8080.

Make a submission by sending a JSON object with the following fields.

| Field         | Type       | Value                                                                                                                                               | Example               |
| ------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `id`          | `string`   | A string for identifying the submission. Must be unique, less than 64 characters, and contain only alphanumeric characters, dashes and underscores. | `abcd-1234-asdf-1234` |
| `src`         | `string`   | The source code of the submission.                                                                                                                  | `print(input())`      |
| `language`    | `string`   | The language of the submission. Must match a folder name in `scripts/languages`.                                                                    | `python3`             |
| `timeLimit`   | `number`   | The time limit for program execution, in seconds.                                                                                                   | `1`                   |
| `memoryLimit` | `number`   | The memory limit for program execution, in KB.                                                                                                      | `100000`              |
| `input`       | `string[]` | A list of inputs to run against the submission.                                                                                                     | `["hello", "world"]`  |

You should receive a series of JSON objects as responses with the following fields. The build task result will be sent first, but inputs are not guaranteed to be sent in any particular order.

| Field             | Type                 | Value                                                                                                                                                                 |
| ----------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code`            | `number`             | A HTTP-like response code.                                                                                                                                            |
| `result.id`       | `string`             | The ID of the submission sent in the initial request.                                                                                                                 |
| `result.task`     | `string` or `number` | Either `build` for the build process, or an index into the inputs for the submission. Indicates what the result object describes.                                     |
| `result.stdout`   | `string`             | The stdout of the task.                                                                                                                                               |
| `result.stderr`   | `string`             | The stderr of the task.                                                                                                                                               |
| `result.time`     | `number`             | The time in seconds taken by the task to execute, summed across all threads.                                                                                          |
| `result.memory`   | `number`             | The maximum memory in KB used by the task, summed across all threads.                                                                                                 |
| `result.exitCode` | `number`             | The exit code of the task.                                                                                                                                            |
| `result.status`   | `string`             | A short code for the status of the task, either `OK`, `TLE` (time limit exceede), `RE` (runtime error or memory limit exceede), or `SYSERR` (unknown internal error). |

## Caveats

The following caveats exist but are being worked on:

- Inconsistent execution time
- Doesn't support network access for sandboxed code
- Doesn't support custom build options

## Supported languages

The following languages are supported, with more to come:

- Python 3.11.2
- C++ (g++ 12.2.0, C++17 standard)
- C (gcc 12.2.0, C17 standard)
