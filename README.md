# Adil-Music

This repository contains the React Native (Expo) client and a small Express scraper server used by the app.

Deploying the server to Render
 - The server can be run on Render as a Web Service. Use the start command:
	 - `npm run server`  (this runs `node server.js`)
 - Example `render.yaml` environment variables:
	 - `PORT` (optional) - Render sets this automatically
	 - `APK_DOWNLOAD_URL` - public URL where the built APK is hosted (or leave empty to serve `./apks/app-release.apk` if you upload it)
	 - `APP_VERSION` - optional version string to advertise via `/update-info`
	 - `APP_RELEASE_NOTES` - optional release notes string for `/update-info`

Update checks from the mobile app
 - The mobile app checks an update URL that returns JSON with the following shape:
	 ```json
	 { "version": "1.2.3", "notes": "...", "url": "https://.../app-release.apk" }
	 ```
 - The server exposes `/update-info` which returns `{ version, notes, url }`. By default it returns `APP_VERSION` (or package.json version) and a `url` that points to `APK_DOWNLOAD_URL` or the server `/download-apk` endpoint.

Starting the server locally
 - Run the server locally with:
	 ```powershell
	 npm run server
	 # or
	 node server.js
	 ```

Using the Render-deployed server in the app
 - The app is preconfigured to use `https://adil-music-47rr.onrender.com/update-info` as the default update URL.
 - In the app Settings → Update you can change the update URL if you host the update JSON elsewhere.

