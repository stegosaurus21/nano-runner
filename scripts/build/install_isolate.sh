#!/bin/bash
set -xe

apt-get install libsystemd-dev libcap-dev

mkdir /tmp/isolate
cd /tmp/isolate

wget https://github.com/ioi/isolate/archive/refs/tags/v2.0.zip
unzip v2.0.zip
cd isolate-2.0

make install
rm /usr/local/etc/isolate
