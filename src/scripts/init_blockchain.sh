#!/usr/bin/env bash


echo "=== lamington: setup blockchain accounts and smart contract ==="

# set PATH
PATH="$PATH:/opt/eosio/bin:/opt/eosio/bin/scripts"

set -m

# Clear the data directory
rm -rf /mnt/dev/data

# start nodeos ( local node of blockchain )
# run it in a background job such that docker run could continue
nodeos -e -p eosio -d /mnt/dev/data \
  --config-dir /mnt/dev/config \
  --genesis-json /mnt/dev/config/genesis.json \
  --disable-replay-opts &

until $(curl --output /dev/null \
             --silent \
             --head \
             --fail \
             localhost:8888/v1/chain/get_info)
do
  sleep 1s
done

syskey_pub=EOS6MRyAjQq8ud7hVNYcfnVPJqcVpscN5So8BhtHuGYqET5GDW5CV
syskey_priv=5KQwrPbwdL6PhXujxW37FSSQZ1JiwsST4cqQzDeyXtP79zkvFD3
contracts_dir=/usr/opt/eosio.contracts/build/contracts
boot_contract_dir=$contracts_dir

echo "=== lamington: setup wallet: lamington ==="
# First key import is for eosio system account
cleos wallet create -n eosiomain --to-console | tail -1 | sed -e 's/^"//' -e 's/"$//' > eosiomain_wallet_password.txt
cleos wallet import -n eosiomain --private-key $syskey_priv

echo "=== lamington: create system accounts ==="
declare -a system_accounts=("bpay" "msig" "names" "ram" "ramfee" "saving" "stake" "token" "vpay" "rex")

for account in "${system_accounts[@]}"; do
    cleos create account eosio "eosio.$account" $syskey_pub
done

cleos set contract eosio.token "$contracts_dir/eosio.token"
cleos set contract eosio.msig "$contracts_dir/eosio.msig"

echo "=== lamington: create tokens ==="
cleos push action eosio.token create '[ "eosio", "1000000000.0000 EOS"]' -p eosio.token
cleos push action eosio.token issue '["eosio", "100000000.0000 EOS", "memo"]\' -p eosio

echo "=== lamington: activate protocol features ==="
curl --silent --output /dev/null -X POST localhost:8888/v1/producer/schedule_protocol_feature_activations \
  -d '{"protocol_features_to_activate": ["0ec7e080177b2c02b278d5088611686b49d739925a92d9bfcacd7fc6b74053bd"]}'
sleep 0.5s

echo "=== lamington: install boot contract after first protocol activation ==="
cd $boot_contract_dir
cleos set contract eosio "$boot_contract_dir/eosio.boot/" -p eosio@active
sleep 0.5s

echo "=== lamington: activate the needed features"

echo "Activating: GET_SENDER"
cleos push action eosio activate '["f0af56d2c5a48d60a4a5b5c903edfb7db3a736a94ed589d0b797df33ff9d3e1d"]' -p eosio

echo "Activating: FORWARD_SETCODE"
cleos push action eosio activate '["2652f5f96006294109b3dd0bbde63693f55324af452b799ee137a81a905eed25"]' -p eosio

echo "Activating: ONLY_BILL_FIRST_AUTHORIZER"
cleos push action eosio activate '["8ba52fe7a3956c5cd3a656a3174b931d3bb2abb45578befc59f283ecd816a405"]' -p eosio

echo "Activating: RESTRICT_ACTION_TO_SELF"
cleos push action eosio activate '["ad9e3d8f650687709fd68f4b90b41f7d825a365b02c23a636cef88ac2ac00c43"]' -p eosio

echo "Activating: DISALLOW_EMPTY_PRODUCER_SCHEDULE"
cleos push action eosio activate '["68dcaa34c0517d19666e6b33add67351d8c5f69e999ca1e37931bc410a297428"]' -p eosio

 echo "Activating: FIX_LINKAUTH_RESTRICTION"
cleos push action eosio activate '["e0fb64b1085cc5538970158d05a009c24e276fb94e1a0bf6a528b48fbc4ff526"]' -p eosio

 echo "Activating: REPLACE_DEFERRED"
cleos push action eosio activate '["ef43112c6543b88db2283a2e077278c315ae2c84719a8b25f25cc88565fbea99"]' -p eosio

echo "Activating: NO_DUPLICATE_DEFERRED_ID"
cleos push action eosio activate '["4a90c00d55454dc5b059055ca213579c6ea856967712a56017487886a4d4cc0f"]' -p eosio

echo "Activating: ONLY_LINK_TO_EXISTING_PERMISSION"
cleos push action eosio activate '["1a99a59d87e06e09ec5b028a9cbb7749b4a5ad8819004365d02dc4379a8b7241"]' -p eosio

echo "Activating: RAM_RESTRICTIONS"
cleos push action eosio activate '["4e7bf348da00a945489b2a681749eb56f5de00b900014e137ddae39f48f69d67"]' -p eosio

echo "Activating: WEBAUTHN_KEY"
cleos push action eosio activate '["4fca8bd82bbd181e714e283f83e1b45d95ca5af40fb89ad3977b653c448f78c2"]' -p eosio

echo "Activating: WTMSIG_BLOCK_SIGNATURES"
cleos push action eosio activate '["299dcb6af692324b899b39f16d5a530a33062804e41f09dc97e9f156b4476707"]' -p eosio

echo "Activating: GET_CODE_HASH"
cleos push action eosio activate '["bcd2a26394b36614fd4894241d3c451ab0f6fd110958c3423073621a70826e99"]' -p eosio

echo "Activating: GET_BLOCK_NUM"
cleos push action eosio activate '["35c2186cc36f7bb4aeaf4487b36e57039ccf45a9136aa856a5d569ecca55ef2b"]' -p eosio

echo "Activating: CRYPTO_PRIMITIVES"
cleos push action eosio activate '["6bcb40a24e49c26d0a60513b6aeb8551d264e4717f306b81a37a5afb3b47cedc"]' -p eosio


echo ACTION_RETURN_VALUE
cleos push action eosio activate '["c3a6138c5061cf291310887c0b5c71fcaffeab90d5deb50d3b9e687cead45071"]' -p eosio

echo CONFIGURABLE_WASM_LIMITS2
cleos push action eosio activate '["d528b9f6e9693f45ed277af93474fd473ce7d831dae2180cca35d907bd10cb40"]' -p eosio

echo BLOCKCHAIN_PARAMETERS
cleos push action eosio activate '["5443fcf88330c586bc0e5f3dee10e7f63c76c00249c87fe4fbf7f38c082006b4"]' -p eosio



old_system_hash=$(cleos get code eosio)

echo "=== lamington: installing the new system contract after the other protocol feature activations ==="
until [[ $(cleos get code eosio) != $old_system_hash ]]
do
  echo "Attempting to install the new system contract..."
  cleos set contract eosio "$contracts_dir/eosio.system" -p eosio@active
  sleep 0.5s
done

echo "=== lamington: system contract successfully installed ==="

sleep 5s

echo "=== lamington: init system contract ==="
max_attempts=3
attempt=1
success=false

while [ $attempt -le $max_attempts ] && [ "$success" = false ]; do
  echo "Attempt $attempt of $max_attempts to initialize system contract..."
  if cleos push action eosio init '[0, "4,EOS"]' -p eosio@active; then
    echo "System contract initialized successfully."
    success=true
  else
    echo "Failed to initialize system contract (attempt $attempt of $max_attempts)."
    if [ $attempt -lt $max_attempts ]; then
      echo "Retrying in 2 seconds..."
      sleep 2
    fi
    attempt=$((attempt+1))
  fi
done

if [ "$success" = false ]; then
  echo "Failed to initialize system contract after $max_attempts attempts. Exiting with error."
  exit 1
fi

echo "=== lamington: Verifying rammarket table ==="
echo "Checking if the rammarket table has been properly initialized..."
ram_check=$(cleos get table eosio eosio rammarket)

# Check if the rammarket table has the expected data
if echo "$ram_check" | grep -q "RAMCORE" && 
   echo "$ram_check" | grep -q "RAM" && 
   echo "$ram_check" | grep -q "EOS"; then
  echo "Rammarket table successfully verified."
else
  echo "ERROR: Rammarket table verification failed. Table does not contain expected values."
  echo "Received: $ram_check"
  exit 1
fi

echo "=== lamington: Set eosio.msig to be privileged ==="
cleos push action eosio setpriv '["eosio.msig",1]' -p eosio



# put the background nodeos job to foreground for docker run
fg %1