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

# Compile the smart contract to WASM and ABI using Antelope CDT.
# Add the contract's include directory so headers such as
# <contract.name/contract.name.hpp> can be resolved.
# https://github.com/AntelopeIO/cdt
cdt-cpp -abigen "$filename" -o "project/$outputPath/$contractName.wasm" -I "project/contracts/$contractName/include" --contract "$contractName" $4


