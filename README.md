# SayLess

The privacy-friendly screen recorder with **transcript-based editing** 🎥✍️

_Record, transcribe on-device, then edit your video by editing the words — delete or mute parts just by selecting them in the transcript._

SayLess is a powerful, privacy-friendly screen recorder, annotation tool, and in-browser video editor. Record your screen, tab, region, or camera; annotate live; then trim, cut, and mute — including by transcript. Everything runs locally, no sign in needed.

> SayLess is a fork of [Screenity](https://github.com/alyssaxuu/screenity) (GPLv3) by [Alyssa X](https://alyssax.com), with cloud/Pro paths removed and a transcript-driven, non-destructive editing layer added. See [`docs/FORK_PLAN.md`](docs/FORK_PLAN.md) and [`docs/CAPABILITIES.md`](docs/CAPABILITIES.md).

## Table of contents
- [SayLess](#sayless)
	- [Table of contents](#table-of-contents)
	- [Features](#features)
	- [Self-hosting](#self-hosting)
	- [Creating a development version](#creating-a-development-version)
		- [Enabling Save to Google Drive](#enabling-save-to-google-drive)
	- [Acknowledgements](#acknowledgements)

## Features

🎥 Make unlimited recordings of your tab, a specific area, desktop, any application, or camera<br>
🎙️ Record your microphone or internal audio, and use features like push to talk<br>
✏️ Annotate by drawing anywhere on the screen, adding text, arrows, shapes, and more<br>
✨ Use AI-powered camera backgrounds or blur to enhance your recordings<br>
🔎 Zoom in smoothly in your recordings to focus on specific areas<br>
🪄 Blur out any sensitive content of any page to keep it private<br>
✂️ Remove or add audio, cut, trim, or crop your recordings with a comprehensive editor<br>
📝 Edit by transcript — transcribe on-device, then delete or mute parts by selecting the words<br>
👀 Highlight your clicks and cursor, and go in spotlight mode<br>
⏱️ Set up alarms to automatically stop your recording<br>
💾 Export as mp4, gif, and webm, or save the video directly to Google Drive to share a link<br>
⚙️ Set a countdown, hide parts of the UI, or move it anywhere<br>
🔒 Only you can see your videos — no data is collected. You can even go offline!<br>
💙 No limits, make as many videos as you want, for as long as you want — all for free & no sign in needed!

## Self-hosting
> 🛠️ Note: SayLess runs entirely in local-only mode. No API calls, sign-in flows, or platform features are enabled — nothing is sent anywhere.

You can run SayLess locally as an unpacked extension. Here's how:

1. Build the extension (see [Creating a development version](#creating-a-development-version)), or download a `Build.zip` from this repository's releases page if available.
2. Load the extension by pasting `chrome://extensions/` in the address bar, and [enabling developer mode](https://developer.chrome.com/docs/extensions/mv2/faq/#:~:text=You%20can%20start%20by%20turning,a%20packaged%20extension%2C%20and%20more.).
3. Click **Load unpacked** and select the `build` folder (unzip first if you downloaded a ZIP).
4. That's it. [Follow these instructions](#enabling-save-to-google-drive) to set up the Google Drive integration.

## Creating a development version

> ❗️ SayLess is licensed under [GPLv3](LICENSE), inherited from Screenity 3.0.0+. Make sure to read the license regarding intellectual property.

1. Check if your [Node.js](https://nodejs.org/) version is >= **14**.
2. Clone this repository.
3. Run `npm install` to install dependencies.
4. Run `npm start` to start the local development server.
5. Open `chrome://extensions/` in your browser and [enable developer mode](https://developer.chrome.com/docs/extensions/mv2/faq/#:~:text=You%20can%20start%20by%20turning,a%20packaged%20extension%2C%20and%20more.).
6. Click **Load unpacked** and select the `build` folder.
7. The extension should now be available locally.  
   To rebuild after code changes, run `npm run build`.

### Enabling Save to Google Drive

To enable the Google Drive Upload (authorization consent screen) you must change the client_id in the manifest.json file with your linked extension key.

You can create it accessing [Google Cloud Console](https://console.cloud.google.com/apis/credentials) and selecting Create Credential > OAuth Client ID > Chrome App. To create a persistent extension key, you can follow the steps detailed [here](https://developer.chrome.com/docs/extensions/reference/manifest/key).

## Acknowledgements

SayLess is built on [Screenity](https://github.com/alyssaxuu/screenity) by [Alyssa X](https://alyssax.com), licensed under GPLv3. Huge thanks to Alyssa and the Screenity contributors for the original work.
