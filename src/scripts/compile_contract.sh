#!/usr/bin/env bash
set -o errexit

# set PATH
PATH="$PATH:/opt/eosio/bin"

if [ "$#" -lt 3 ]; then
  echo "usage: compile_contract.sh <filename> <outputPath> <contractName> [buildFlag ...]" >&2
  exit 2
fi

filename="$1"
outputPath="$2"
contractName="$3"
# Everything after the third argument is one build flag per argument. The caller
# splits them, so nothing here is re-interpreted by a shell: an unquoted "$4"
# used to let a flag from a committed .lamflags file run as a command.
shift 3

# Ensure the output directory exists
mkdir -p "project/$outputPath"

# compile smart contract to wasm and abi files using EOSIO.CDT (Contract Development Toolkit)
# https://github.com/EOSIO/eosio.cdt
eosio-cpp -abigen "$filename" -o "project/$outputPath/$contractName.wasm" --contract "$contractName" "$@"


