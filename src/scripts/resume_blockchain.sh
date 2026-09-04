#!/usr/bin/env bash

echo "=== lamington: resuming blockchain from restored data ==="

# set PATH
PATH="$PATH:/opt/eosio/bin:/opt/eosio/bin/scripts"

set -m

# NOTE: Unlike init_blockchain.sh this script must NOT clear /mnt/dev/data and
# must NOT re-run any of the chain setup actions. The restored snapshot already
# contains the accounts, contracts and system state those steps would create.

if [ ! -d /mnt/dev/data ]; then
  echo "ERROR: /mnt/dev/data does not exist, there is nothing to resume"
  exit 1
fi

# start nodeos ( local node of blockchain ) against the restored data directory.
# No --genesis-json here: the chain state already exists, and passing genesis
# alongside existing state is what makes nodeos start a fresh chain.
#
# --replay-blockchain rebuilds the state database from blocks.log. The snapshot
# is taken while nodeos is only paused, not cleanly shut down, so its state db
# carries the dirty flag and nodeos refuses to start from it without a replay.
nodeos -e -p eosio -d /mnt/dev/data \
  --config-dir /mnt/dev/config \
  --replay-blockchain \
  --disable-replay-opts &
nodeos_pid=$!

attempts=0
until $(curl --output /dev/null \
             --silent \
             --head \
             --fail \
             localhost:8888/v1/chain/get_info)
do
  attempts=$((attempts+1))
  if [ $attempts -gt 60 ]; then
    echo ""
    echo "ERROR: nodeos did not become ready within 60s of resuming"
    exit 1
  fi
  printf '.'
  sleep 1s
done

echo ""
echo "=== lamington: blockchain resumed from restored data ==="

# Keep the container alive for as long as nodeos lives.
# NOTE: do not use `fg` or `wait` here. With job control enabled (set -m) both
# return as soon as the job merely *stops*, so SIGSTOP-ing nodeos (as snapshot
# creation does to quiesce the data dir) would let this script run to completion
# and kill the container. `kill -0` still succeeds for a stopped process, so
# this loop holds through a pause and exits only once nodeos is really gone.
while kill -0 "$nodeos_pid" 2>/dev/null; do
  sleep 5s
done
