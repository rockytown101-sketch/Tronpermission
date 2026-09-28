# TRON Permission Control Desktop

Mac / Windows desktop console for creating a TRON `AccountPermissionUpdateContract` that changes C's Owner Permission to A+B, threshold 2.

## Important capability boundary
This app deliberately does **not** claim to remotely force an arbitrary phone wallet to pop a signing dialog from only a TRON address. The wallet must accept a wallet-native request. TronLink and TokenPocket expose official mobile DeepLink signing flows; imToken's current public integration path is WalletConnect/DApp connection.

The app therefore:
- builds the permission-update transaction locally on the desktop;
- preserves existing Active Permissions;
- creates a signed-request payload for the wallet adapter;
- can launch official TronLink / TokenPocket DeepLinks from the desktop OS;
- does not store any C private key;
- does not broadcast unsigned transactions.

## Run from source
Node 20+ recommended.

```bash
npm install
npm start
```

## Build Windows
```bash
npm run dist:win
```

## Build macOS
Run on a Mac:
```bash
npm run dist:mac
```

## TRON API key
For mainnet, set `TRON_API_KEY` in the environment if your TronGrid endpoint requires it. `TRON_FULL_HOST` defaults to `https://api.trongrid.io`.

## Security
Test on Nile first. An AccountPermissionUpdateContract overwrites the permission structure. A malformed permission configuration can make the account unrecoverable. Never hard-code or upload C's private key.
