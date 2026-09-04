<p align="center">
    <img src="https://lamington.io/img/logo.svg" alt="Lamington Logo" width="300"/>
</p>

Inspired by the popular Truffle framework and developed in Typescript, Lamington makes smart contract development simple for any level of EOSIO developer.

[![Build Status](https://travis-ci.org/CoinageCrypto/lamington.svg?branch=master)](https://travis-ci.org/CoinageCrypto/lamington)
[![Supported by Coinage](https://coina.ge/assets/supported-by-coinage-badge.svg)](https://coina.ge)

## Features

The Lamington library includes CLI tools and JavaScript utilities to streamline the smart contract building, testing and deployment pipeline.

- Skill level agnostic
- TypeScript ready
- Containerized development
- Fast start-up by restoring blockchain snapshots
- Common JavaScript testing frameworks
- Multi-environment support
- Simple CLI commands
- Easily configurable

## Installation

### Prerequisites

Lamington requires Docker and NodeJS to be installed before it can be used.

- Docker: We recommend [installing Docker with the standard installer for your platform](https://www.docker.com/get-started).
- NodeJS: We recommend [installing NodeJS with NVM](https://github.com/creationix/nvm).

### Installing Lamington

Lamington includes command line tools and JavaScript utilities for EOSIO contract development. We recommend installing the framework as a development dependency within your project. This lets you run commands like `lamington test` in your project.

```
$ npm install --save-dev lamington
```

From there you just need to add node scripts to your `package.json` file that trigger `lamington` actions, for example:

```
{
  ...
  "scripts": {
    "build": "lamington build",
    "start": "lamington start eos",
    "stop": "lamington stop eos",
    "test": "lamington test"
  },
  ...
}
```

### Global Installation

If you'd like the convenience of using the `lamington` command without adding it as a project dependency, you can install it on your system globally, just be mindful that this can create trouble if you use `lamington` with multiple projects simultaneously and don't have them all ready for the same version.

To install globally, run:

```
$ npm install -g lamington
```

## Usage

Lamington is super simple! Whether you're migrating from Solidity, or a seasoned EOSIO developer deploying a complex decentralized application (dApp) you'll find yourself right at home in no time.

### Building

Compiling your smart contracts with Lamington is as simple as;

```
$ lamington build
```

Lamington automatically searches for all files with the `.cpp` file extension before batch compiling within a docker container. Compiling within a docker container with locked configuration ensures contracts compile consistently and clean every time.

#### Ignoring Files & Folders

Not every `.cpp` file is a contract, so we added an additional `exclude` to the configuration file `.lamingtonrc`. This `exclude` option takes an array of globular patterns as files and patterns you don't want added to your build process. We've added the command line method `lamington ignore` to generate a `.lamingtonrc` file with default settings.

#### Specifying Build Contracts

If you'd like to run builds on specific contracts, an additional contract `identifier` can be specified like so;

```
$ lamington build [identifier]
```

_Replace the `[identifier]` with the relative path to the contract with or without the .cpp extension._

### Testing

Lamington was built with testing in mind. We considered the most commonly used testing libraries like Mocha when developing the Lamington toolset. Running your test suit is as easy as;

```
$ lamington test
```

For a full list of available JavaScript utilities, please [visit the documentation here](https://docs.lamington.io/testing).

### Snapshots

Initializing a chain from scratch installs the EOSIO system contracts, which is
by far the slowest part of `lamington start` and `lamington test`. Lamington can
snapshot a fully initialized chain and restore it on subsequent runs instead of
repeating that work.

This is automatic and needs no configuration:

1. On the first run the chain initializes normally. Once the system contracts are
   confirmed installed, a snapshot is written to `.lamington/snapshots/`.
2. On later runs a compatible snapshot is restored instead of initializing.

On the small test chain used to develop this, a full initialization took about 22
seconds against about 6 seconds to restore. The saving grows with however much
work your project's initialization does, because restore time stays roughly flat.

#### What a snapshot contains

Only the block log (`blocks.log` and `blocks.index`). The state database,
reversible blocks and state history are deliberately excluded: they are memory
mapped or append-only files that cannot be safely copied out of a running node,
and nodeos rebuilds them by replaying the block log when the snapshot is
restored. This keeps archives small, typically around 100KB.

#### When a snapshot is ignored

Each snapshot records the `eos` version, the `contracts` version and a hash of
the `genesis.json` it was created under. If any of those differ from your current
configuration the snapshot is ignored, the chain initializes from scratch, and a
new snapshot is taken. A snapshot must also have been taken from a fully
initialized chain to be eligible.

This means you do not have to remember to clear snapshots after changing the
toolchain or genesis. Changing either invalidates them automatically.

#### Managing snapshots

```
$ lamington snapshots list
$ lamington snapshots create
$ lamington snapshots create --snapshot-name my-snapshot.tar.gz
$ lamington snapshots restore <name>
$ lamington snapshots delete <name>
$ lamington snapshots delete-all --force
```

`create` and `restore` act on the running container, so start the chain first.
`delete-all` refuses to run without `--force`.

#### Snapshot settings

| Setting | Default | Description |
| --- | --- | --- |
| `useSnapshots` | `true` | Restore a compatible snapshot instead of initializing from scratch |
| `autoCreateSnapshot` | `true` | Snapshot the chain automatically once it is fully initialized |
| `snapshotRetention` | `5` | Number of snapshots to keep. Older ones are removed after a new one is written |

Set `useSnapshots` to `false` if you want every run to initialize a fresh chain.

### Initialization

Initially setting up a project can be tedious and repetitive, so we've created a simple CLI method to setup a boilerplate EOSIO project with Lamington integration.

```
$ lamington init
```

This creates a `.lamingtonrc` file in your current directory with default Lamington settings.

```
$ lamington init [PROJECT_NAME]
```

Optionally you can provide and additional `PROJECT_NAME` to create a project directory and initialize a boilerplate project within.

## Configuration

Lamington ships with a default configuration to make getting started simple and setup free. However, as your project grows, so will your need for additional Lamington configuration. For example, deployment to a testnet or the live network will require environment setup. Additionally, you'll need customize your configuration if you'd like to control Lamington's fine grained settings. Fortunately we've made a simple tool to get you started, simply run `lamington init` in your project directory to create a default `.lamingtonrc` configuration file.

### Using a Configuration File

The `.lamingtonrc` file allows you to configure additional settings using JSON syntax. We're working on provide allot more settings, like defining multiple environments for each stage of your pipeline.

```
{
  ...
  "keepAlive":true,
  ...
}
```

The `keepAlive` setting prevents Lamington from stopping the EOSIO container between each build, allowing you to develop faster and compile often.

### Running more than one chain at a time

By default every project uses the container name `lamington` and the standard
ports, so two projects cannot run at once. Override the name and the host ports
to run a second chain alongside an existing one:

```
{
  "containerName": "my-project",
  "rpcPort": 8889,
  "stateHistoryPort": 18081,
  "p2pPort": 19876
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `containerName` | `lamington` | Name of the docker container running the chain |
| `rpcPort` | `8888` | Host port mapped to the chain's RPC port |
| `stateHistoryPort` | `8080` | Host port mapped to the state history port |
| `p2pPort` | `9876` | Host port mapped to the p2p port |

These are host-side ports only. Inside the container the chain always listens on
its standard ports, so no other configuration needs to change. Tests pick the
RPC port up automatically.

### Toolchain versions

Lamington ships with a pinned toolchain, so a new project works without
specifying versions:

```
{
  "cdt": "https://github.com/EOSIO/eosio.cdt/releases/download/v1.8.1/eosio.cdt_1.8.1-1-ubuntu-18.04_amd64.deb",
  "eos": "https://github.com/AntelopeIO/leap/releases/download/v5.0.3/leap_5.0.3_amd64.deb",
  "contracts": "v1.9.2"
}
```

The `eos` default is Leap rather than a legacy EOSIO release because the bundled
system contracts import host functions (`set_parameters_packed` and
`set_wasm_parameters_packed`) that were added after EOSIO 2.0. On an older
`nodeos` the system contract cannot be linked and installation fails, which in
turn means no snapshot is ever created. If you override `eos`, use a build that
is new enough for the system contracts you intend to install.

Changing any of these three values invalidates existing snapshots, since they no
longer describe the same chain.

## Contributing to Lamington

We welcome contributions of all types, even down to typo fixes. All help is very welcome!

If you're not sure where to start, the best resource for you is our [Contributing to Lamington guide](https://lamington.io/guides/contributing-to-lamington/), and if you're still stuck, please [reach out to us on Slack](https://forms.gle/yTjNA46oKywaD7FR6).

## Resources

You can find more information about the Lamington tool-set and join our growing community of developers by visiting any of the following links;

[Example Project](https://github.com/MitchPierias/Advanced-EOS-Examples)

[API Documentation](https://api.lamington.io)

[Slack Channel](https://forms.gle/yTjNA46oKywaD7FR6)

[Official Website](https://lamington.io)

## Roadmap

### LamingtonJS

Core Lamington front end toolset

### Lamington-React

React context management for LamingtonJS

### Lamington-Angular

## Contributors

- [Kevin Brown](https://github.com/thekevinbrown), Creator & Developer
- [Mitch Pierias](https://github.com/MitchPierias), Developer

## Supporters

<p align="center">
    <a href="https://coina.ge"><img src="https://coina.ge/assets/coinage-logo-light.svg" alt="Supported by Coinage" width="100"/></a>
</p>
<p align="center">
    This project is proudly supported by <a href="https://coina.ge">Coinage</a>.<br/>
</p>
