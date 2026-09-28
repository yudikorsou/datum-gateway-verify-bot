# Sign the verification message

[prove-your-address.mp4](prove-your-address.mp4) is a narrated walkthrough of Discord step 1: prove you own the payout address.

It follows one example challenge through the wallet screens:

1. Copy the exact text from the bot, including the line breaks, Discord user id, nonce, and timestamp.
2. Shrike (same screen as Sparrow): **Tools → Sign/Verify Message**. For a `bc1q` address, use **Standard (Electrum)** or **BIP137**, then **Sign**.
3. Bitcoin Core: **File → Sign message**.
4. Electrum: **Tools → Sign/verify message**.
5. Back in Discord, click **Submit signature** and paste the signature from the wallet.

`bc1p` Taproot addresses need a BIP322 signature. Legacy and SegWit addresses, including `bc1q`, use the classic Bitcoin signed message. Shrike’s `SIGHASH_UNIFIED` flag is for spending coins, not for this proof.

The signature shown in the video is a placeholder. Paste the signature your own wallet creates.
