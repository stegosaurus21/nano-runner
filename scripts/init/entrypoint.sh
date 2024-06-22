#!/bin/bash
set -xe

cd /sys/fs/cgroup
mkdir nano-runner

echo $$ > ./nano-runner/cgroup.procs

while IFS= read -r line
do
  echo $line > ./nano-runner/cgroup.procs
done <<< "$(cat cgroup.procs)"

echo "+cpuset +memory" > cgroup.subtree_control

cd /app

[ "$1" = "dev" ] &&
  npm start ||
  npm run dev
