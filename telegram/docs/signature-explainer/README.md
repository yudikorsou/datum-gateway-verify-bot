# Sign the Mini App message

[sign-the-message.mp4](sign-the-message.mp4) is a narrated walkthrough of the Telegram form: copy the sign text, sign it in a Blake2b wallet like Sparrow or Shrike, then paste the signature back.

It follows one example challenge through those screens:

1. In the Telegram popup, copy the exact sign text, including the line breaks, Telegram user id, nonce, and timestamp.
2. Sparrow or Shrike: **Tools → Sign/Verify Message**. For a `bc1q` address, use **Standard (Electrum)** or **BIP137**, then **Sign**.
3. Back in the Telegram popup, paste that signature into the field and submit.

`bc1p` Taproot addresses need a BIP322 signature. Legacy and SegWit addresses, including `bc1q`, use the classic Bitcoin signed message. Shrike’s `SIGHASH_UNIFIED` flag is for spending coins, not for this proof.

The signature shown in the video is a placeholder. Paste the signature your own wallet creates.

The Mini App embeds this file from `webapp/sign-the-message.mp4`. Rebuild with:

```bash
python3 -m venv .venv
.venv/bin/pip install edge-tts
npm install
npm run build
cp sign-the-message.mp4 ../../webapp/sign-the-message.mp4
```
