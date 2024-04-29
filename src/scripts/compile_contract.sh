#!/usr/bin/env bash
set -o errexit

# set PATH
PATH="$PATH:/opt/eosio/bin"

filename="$1"
outputPath="$2"
contractName="$3"
addedBuildFlags="$4"

# Ensure the output directory exists
mkdir -p "project/$outputPath"

# compile smart contract to wasm and abi files using EOSIO.CDT (Contract Development Toolkit)
# https://github.com/EOSIO/eosio.cdt
if command -v eosio-cpp &> /dev/null
then
    eosio-cpp -abigen "$filename" -o "project/$outputPath/$contractName.wasm" --contract "$contractName" $addedBuildFlags
else
    cdt-cpp -abigen "$filename" -o "project/$outputPath/$contractName.wasm" --contract "$contractName" $addedBuildFlags
fi

