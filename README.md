# Zoom Recording Downloader

Capture Zoom recording links from your active tab and save files locally.

## What this extension does
- Detects Zoom recording links from the active browser tab.
- Lets you capture link first, then start download when you choose.
- Uses an optional desktop helper for direct local file saving when browser download is not reliable.

## How to use
1. Open your Zoom recording page.
2. Start playback for a few seconds.
3. Click **1. Capture Link**.
4. Click **2. Download**.

If browser cannot save file directly, install desktop helper from popup and verify it with refresh button.

## Desktop helper
Desktop helper runs locally on your device. It is used only for direct file saving when browser download path is blocked or unreliable.

Review source before install:
- extension source: https://github.com/henrynguyen6677/zoom-capture-extension
- helper source: https://github.com/henrynguyen6677/zoom-capture-extension/tree/master/native-host
- installer script: https://raw.githubusercontent.com/henrynguyen6677/zoom-capture-extension/master/install.sh

What to expect:
- no admin access needed
- local install only
- source code is public in this repository

## Why permissions are needed
- `tabs`: read active tab context when you capture from current page.
- `webRequest`: detect media requests related to Zoom recording playback.
- `downloads`: save files through browser when possible.
- `scripting`: inspect active tab for media elements when network capture alone is not enough.
- `cookies`: reuse your current browser session for recording links that require authentication.
- `nativeMessaging`: talk to optional desktop helper for direct local saving.
- `<all_urls>` host access: needed because media links and supporting requests may come from different hosts during playback.

## Privacy and security
- Extension works between browser and your local device.
- Desktop helper runs locally and saves files locally.
- Some Zoom recording links require your current signed-in browser session to access file.
- Source code is public for review.

## Known limitations
- Some recording links expire quickly.
- If download fails, refresh recording page, capture again, then retry.
- If browser opens link in new tab instead of saving file, install desktop helper for more reliable local saving.

## Install extension
1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

## Security verification
VirusTotal links will be added after upload finishes. Current release hashes:

- `zoom-native-host`: `a82ba40672ecd86d5767bcd07df95f1bd11062179723fab311e267422dc18c9a`
- `zoom-native-host-darwin-amd64`: `265582d13be9c78323601afeb15797594805150e8aef7761737d8bacaaeb3260`
- `zoom-native-host-darwin-arm64`: `6fd34aa06eea3357ff4c1f56381e1cbe67e7f7968b6901ed10a5a0ad9de19d82`
- `zoom-native-host-linux-amd64`: `f95fce2f8f6e50ce4287427a5471cb380bf26e6e65d03584094384f34591164c`
- `zoom-native-host-linux-arm64`: `254abbb2a09429d120879702c4e8d1c6413544e270c4e20ee70ccfcb9f72329f`
- `zoom-native-host-windows-amd64.exe`: `c4fe848cfe00507a13f37cf12f38923e3df3ce59b219640f140d9fb2f0c6c228`
- `zoom-native-host-windows-arm64.exe`: `cdba8fbf4248eced3d4630d59c04b5bb745da83836022b5f60a637070320b12c`

## Support
- Code and issues: https://github.com/henrynguyen6677/zoom-capture-extension
- Chat support: https://t.me/+OJRMPWOSwF9mZDU1
