# KBW Fair checkout ledger

`contracts/KbwFairCheckout.sol` is a separate contract for the KBW physical-prize machine. It does not replace the football project's canonical `RenaissLuckyDraw` addresses or its Binance Oracle VRF flow. The existing mainnet and testnet football contracts have bytecode but do not expose Renaiss Fair's `merkleRoots(bytes32,uint256)` interface.

## Protocol boundary

- The constructor fixes one `packId` and one 32-byte ECVRF public key. The secret VRF key stays in the KBW application's ignored local file and must later be configured as a server secret. It is not the EVM deployment key.
- `commitSet` pins a root, manifest SHA-256, and slot count once per set ID. No checkout is possible before that commitment.
- `requestCheckout` assigns a unique, increasing checkout ID, records the transaction block number, and emits `CheckoutRequested`. The backend must use the **finalized hash of this same transaction's block** for the official `renaiss-gacha-v3-1` seed.
- The contract does not verify Ed25519 ECVRF proofs or transfer prizes. The public proof, remaining-pool replay, and prize delivery are separate checks. The KBW verifier checks the chain events and all finalized requests against published results.
- This independently deployed contract is not the official Renaiss Token Vending Machine. Deployment does not register the pack in the official Fair API or make it appear on the official verifier website.

## Current state

- Local contract compile and a local Hardhat checkout test passed. A local HTTP-chain smoke test proved that the KBW verifier accepts a real checkout and rejects a changed block hash. The temporary test files were removed after those runs.
- BSC mainnet chain 56 deployment succeeded at `0xA877d23Ed85C6b93f2251f45d3190d45570291A1`: [deployment transaction](https://bscscan.com/tx/0x5ed25bef1d847b80198eb10ad4f58ea4bb8946d72837c3ab0d6ca56ff0007772), block `123600920`. The owner and initial operator are both `0x88b620388698490764fd85CFA482B5E3a8AD63b5`.
- `setId=1` committed all 608 slots: [commitment transaction](https://bscscan.com/tx/0x92be7b6adaba21ea88a109b78478d84da33506b23bcd2681fa06f3b9ef1ceb59), block `123600961`. Root: `0xc00f3bbe87fd283fd4a8c629f6d5b2e0cd542ce21d362da2fea6484d1ccc4f7d`; manifest SHA-256: `0x1922373e7305798dfdc0e820ebabb9641337c9457cc50b9ec8c0bcdb15c11e31`.
- [Contract source is verified on BscScan](https://bscscan.com/address/0xA877d23Ed85C6b93f2251f45d3190d45570291A1#code). Runtime bytecode Keccak-256: `0x5ce36663ac44a8a141e25500e8bb7e2692dfee7aac308f7bf27e51af783fbf45`.
- The 608-slot manifest now has a KBW-specific price-free leaf that commits each unique ID, Tier, name and position. Its root can be honestly calculated without invented token IDs or prices. This is an independent KBW format, so the official Fair verifier cannot decode this root.
- The KBW project has a checkout backend and public proof endpoint. Verify its deployment and `drawEnabled` from the live service before event use; the deployment and on-chain commitment alone do not establish that the website is ready.
- `npm run contract:fair:access:check` queried the identified official Fair TVM on BSC mainnet at block 123579110. The existing deployer `0x88b620388698490764fd85CFA482B5E3a8AD63b5` held none of `GACHA_OPERATOR_ROLE`, `DEFAULT_ADMIN_ROLE`, `TRUSTED_CALLER_ROLE` or `TRUSTED_CHECKOUT_ORACLE_ROLE`; one member held the root operator role. The proxy implementation matched the previously observed `0x3272bd8b81ebb53254b4ed1d8b67fe832e6fb2c7`. This is a snapshot; rerun before an official integration decision.

## Official Fair access check

```sh
npm run contract:fair:access:check
```

The command is read-only. It derives the public wallet address from the ignored deployer key, checks chain 56, proxy bytecode, implementation and current root/caller/oracle roles, and prints no private key. Optional `--pack-id 0x... --set-id N` reads an existing root. Its role flags do not create a pack, satisfy Permit2 payment, supply an oracle signature, or register anything with the Fair API. The deployed official `permitFund` rejects `amountPerToken == 0`; an independent free checkout is a different protocol even when it uses the same ECVRF formula. A `false` role result must not be bypassed by deploying a separate contract if the acceptance criterion is official Fair visibility.

## Deployment preparation

The dry-run command reads the existing football deployer key from the selected ignored env file but prints only the derived public address. Supply the period's actual public key and intended operator address:

```sh
npm run contract:compile
node scripts/deploy-kbw-fair-checkout.mjs \
  --env-file config/draw-contract.env.local \
  --period-id k-vrf-2026-01-v2 \
  --vrf-public-key 0x2833dd04fa0e0015343de7a2784602796ac3da83539267d0c504af37c99d4dfa \
  --operator 0x88b620388698490764fd85CFA482B5E3a8AD63b5
```

The script needs both `--broadcast` and matching `--confirm-chain-id` / `--confirm-pack-id` to send a deployment. Do not use the football contract deployment command for KBW. An exact-network approval is required before any mainnet or testnet transaction.

After deployment, prepare the root in `/Users/gavin/Documents/ChatGPT/k_vrf` using `pnpm kbw:commitment:prepare`, then dry-run the separate commitment transaction:

```sh
node scripts/commit-kbw-fair-set.mjs \
  --env-file config/draw-contract.env.local \
  --period-id k-vrf-2026-01-v2 \
  --contract <newly-deployed-contract-address> \
  --set-id 1 \
  --total-slots 608 \
  --root <root-from-kbw-prepare> \
  --manifest-sha256 <digest-from-kbw-prepare>
```

The commitment script also requires `--broadcast`, matching `--confirm-chain-id` and `--confirm-root` before sending. The website's `KBW_COMMITMENT_BLOCK` is `123600961`; the deployment block is `123600920`. Set 1 cannot be recommitted on this contract.
